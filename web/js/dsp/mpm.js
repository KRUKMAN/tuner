// PURE. McLeod Pitch Method (MPM) pitch detector.
// Per detect() call:
//   (a) autocorrelation r(tau) via FFT (zero-padded to 2*nextPow2(windowSize)),
//   (b) energy term m'(tau) computed incrementally,
//   (c) NSDF n(tau) = 2*r(tau)/m'(tau),
//   (d) key-maxima picking (first key max >= k*nMax),
//   (e) parabolic interpolation for fractional tau + refined peak height (clarity).
// All working buffers are preallocated in the constructor; detect() does not allocate.

import { FFT, nextPow2 } from './fft.js';

/**
 * Per-frame raw output of the pitch detector. Produced by MPMDetector.detect().
 * (Canonical typedef — lives here.)
 * @typedef {Object} PitchFrame
 * @property {number} frequency  Detected fundamental in Hz, or -1 if no acceptable peak.
 * @property {number} clarity    NSDF peak height in [-1, 1]; -1 when frequency === -1.
 * @property {number} harmonicity  Periodicity at 2x/3x the detected period, in [0,1]; 0 when frequency === -1.
 * @property {number} rmsDb      Frame RMS level in dBFS (20*log10(rms)), -Infinity for silence.
 */

export class MPMDetector {
  /**
   * @param {Object} opts
   * @param {number} opts.sampleRate  e.g. 44100 / 48000.
   * @param {number} opts.windowSize  Power of two (4096 or 2048).
   * @param {number} [opts.k=0.93]    Key-maxima relative threshold.
   * @param {number} [opts.fMin=25]   Hz. tauMax = floor(sampleRate/fMin), clamped to windowSize-1.
   * @param {number} [opts.fMax=1200] Hz. tauMin = ceil(sampleRate/fMax).
   */
  constructor(opts) {
    const {
      sampleRate,
      windowSize,
      k = 0.93,
      fMin = 25,
      fMax = 1200,
    } = opts;

    this._sr = sampleRate;
    this._N = windowSize;
    this._k = k;
    this._fMin = fMin;
    this._fMax = fMax;

    // tau search bounds (in samples).
    this._tauMin = Math.ceil(sampleRate / fMax);
    this._tauMax = Math.min(Math.floor(sampleRate / fMin), windowSize - 1);

    // FFT size: zero-pad the windowSize buffer to 2*nextPow2(windowSize) so the
    // circular autocorrelation from the FFT contains no time-aliasing wrap for
    // lags in [0, windowSize).
    const fftSize = 2 * nextPow2(windowSize);
    this._fftSize = fftSize;
    this._fft = new FFT(fftSize);

    // Preallocated working buffers (allocation-free detect()).
    this._padded = new Float32Array(fftSize); // real input, tail stays zero
    this._re = new Float32Array(fftSize);
    this._im = new Float32Array(fftSize);
    this._acf = new Float32Array(fftSize);    // inverse output; r(tau) in [0,N)
    this._nsdf = new Float32Array(windowSize);
    this._maxPositions = new Int32Array(windowSize);
  }

  /**
   * @param {Float32Array} buffer  length === windowSize, pre-filtered time-domain samples.
   * @returns {PitchFrame}
   */
  detect(buffer) {
    const N = this._N;
    const x = buffer;

    // --- Sum of squares (also gives m'(0)/2 and thus RMS, for free). ---
    let sumSq = 0;
    for (let i = 0; i < N; i++) {
      const v = x[i];
      sumSq += v * v;
    }

    const rms = Math.sqrt(sumSq / N);
    const rmsDb = rms > 0 ? 20 * Math.log10(rms) : -Infinity;

    // Silence: nothing to detect.
    if (sumSq <= 0) {
      return { frequency: -1, clarity: -1, harmonicity: 0, rmsDb };
    }

    // --- (a) Autocorrelation r(tau) via FFT. ---
    const padded = this._padded;
    // Copy window into the head; tail is already (and stays) zero.
    for (let i = 0; i < N; i++) padded[i] = x[i];

    const re = this._re;
    const im = this._im;
    this._fft.forward(padded, re, im);

    // Power spectrum: re := re^2 + im^2, im := 0.
    const M = this._fftSize;
    for (let i = 0; i < M; i++) {
      re[i] = re[i] * re[i] + im[i] * im[i];
      im[i] = 0;
    }

    // Inverse FFT -> autocorrelation. r(tau) = acf[tau] for tau in [0, N).
    const acf = this._acf;
    this._fft.inverse(re, im, acf);

    // --- (b)+(c) Incremental m'(tau) and NSDF n(tau). ---
    const nsdf = this._nsdf;
    let mPrime = 2 * sumSq; // m'(0)
    // n(0) = 2*r(0)/m'(0) = 1 (guarded).
    nsdf[0] = mPrime > 0 ? (2 * acf[0]) / mPrime : 0;
    for (let tau = 1; tau < N; tau++) {
      // m'(tau) = m'(tau-1) - x[tau-1]^2 - x[N-tau]^2
      const a = x[tau - 1];
      const b = x[N - tau];
      mPrime -= a * a + b * b;
      nsdf[tau] = mPrime > 1e-12 ? (2 * acf[tau]) / mPrime : 0;
    }

    // --- (d) Key-maxima picking within [tauMin, tauMax]. ---
    const tauMin = this._tauMin;
    const tauMax = Math.min(this._tauMax, N - 2); // keep tau+1 in range for interp
    const maxPositions = this._maxPositions;
    let count = 0;

    // Collect the highest local maximum inside each positive region bounded by a
    // positive-going zero crossing (<=0 -> >0) on the left and a negative-going
    // zero crossing (>0 -> <=0) on the right. Starting already-positive without a
    // preceding positive-going crossing (the central lobe near tau=0) is skipped.
    let inPositive = false;
    let curMaxPos = -1;
    let curMaxVal = -Infinity;
    let prev = nsdf[tauMin];
    for (let tau = tauMin + 1; tau <= tauMax; tau++) {
      const v = nsdf[tau];
      if (prev <= 0 && v > 0) {
        // positive-going crossing: begin a validated positive region
        inPositive = true;
        curMaxPos = -1;
        curMaxVal = -Infinity;
      } else if (prev > 0 && v <= 0) {
        // negative-going crossing: close the region
        if (inPositive && curMaxPos >= 0) {
          maxPositions[count++] = curMaxPos;
        }
        inPositive = false;
        curMaxPos = -1;
        curMaxVal = -Infinity;
      }
      if (inPositive && v > curMaxVal) {
        curMaxVal = v;
        curMaxPos = tau;
      }
      prev = v;
    }
    // Region still open at the end of the search window (peak near tauMax).
    if (inPositive && curMaxPos >= 0) {
      maxPositions[count++] = curMaxPos;
    }

    if (count === 0) {
      return { frequency: -1, clarity: -1, harmonicity: 0, rmsDb };
    }

    // Global max key-maximum height.
    let nMax = -Infinity;
    for (let i = 0; i < count; i++) {
      const h = nsdf[maxPositions[i]];
      if (h > nMax) nMax = h;
    }

    // First key maximum with height >= k*nMax.
    const threshold = this._k * nMax;
    let chosen = -1;
    for (let i = 0; i < count; i++) {
      const pos = maxPositions[i];
      if (nsdf[pos] >= threshold) {
        chosen = pos;
        break;
      }
    }
    if (chosen < 0) {
      return { frequency: -1, clarity: -1, harmonicity: 0, rmsDb };
    }

    // --- (e) Parabolic interpolation through the 3 NSDF samples around chosen. ---
    let tauInterp = chosen;
    let clarity = nsdf[chosen];
    if (chosen > 0 && chosen < N - 1) {
      const y1 = nsdf[chosen - 1];
      const y2 = nsdf[chosen];
      const y3 = nsdf[chosen + 1];
      const denom = y1 - 2 * y2 + y3;
      if (denom !== 0) {
        // Vertex offset of the fitted parabola relative to the center sample.
        let delta = (0.5 * (y1 - y3)) / denom;
        if (delta > 1) delta = 1;
        else if (delta < -1) delta = -1;
        tauInterp = chosen + delta;
        // Refined peak height.
        clarity = y2 - 0.25 * (y1 - y3) * delta;
      }
    }

    const frequency = this._sr / tauInterp;

    // Reject if outside the configured band.
    if (frequency < this._fMin || frequency > this._fMax) {
      return { frequency: -1, clarity: -1, harmonicity: 0, rmsDb };
    }

    // --- Harmonicity: NSDF periodicity at 2x/3x the detected period. ---
    // Broadband noise / fret buzz has weak periodicity at period multiples;
    // a genuinely periodic (even weak-fundamental) note scores high.
    // Renormalize over the multiples that actually FIT inside the window. For the
    // lowest bass notes 3*p exceeds N (B0 at 48 kHz: p ~= 1555, 3*p = 4665 > 4096),
    // so a fixed 0.6/0.4 blend would hard-cap harmonicity at 0.6 -- barely above the
    // harmonicityMin reject gate -- starving the lowest, hardest-to-tune string of
    // any headroom. An unavailable term must not drag the score down.
    const p = Math.round(chosen);            // integer period in samples
    const h2 = (2 * p < N) ? Math.max(0, nsdf[2 * p]) : -1;   // -1 === unavailable
    const h3 = (3 * p < N) ? Math.max(0, nsdf[3 * p]) : -1;

    let harmonicity;
    if (h2 >= 0 && h3 >= 0) harmonicity = 0.6 * h2 + 0.4 * h3;
    else if (h2 >= 0) harmonicity = h2;
    else if (h3 >= 0) harmonicity = h3;
    else harmonicity = 0;
    harmonicity = Math.max(0, Math.min(1, harmonicity));

    return { frequency, clarity, harmonicity, rmsDb };
  }
}
