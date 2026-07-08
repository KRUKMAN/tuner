// Node. MPM accuracy matrix (Section 6). Buffers are run through the real
// createPreFilter chain first, then MPMDetector.detect — proving the whole
// front-end pipeline (bass path preserves B0/E1, guitar HPF doesn't break E2).
//
// Buffers are EXACTLY windowSize samples (the MPM analysis window length).

import { suite, assert, assertCentsClose } from './assert.js';
import { MPMDetector } from '../js/dsp/mpm.js';
import { createPreFilter } from '../js/dsp/filters.js';
import { CONFIG } from '../js/config.js';
import { sine, harmonicTone, whiteNoise, mix } from './synth.js';

const SAMPLE_RATES = [44100, 48000];
const FREQS = [30.87, 41.2, 82.41, 110, 146.83, 196, 246.94, 329.63];

// Pre-roll samples used to WARM the pre-filter before the measured window.
// In the running tuner the pre-filter is persistent across rAF frames, so by the
// time any window is analysed the biquads/DC-blocker are in steady state. A
// single-shot test with a cold filter would instead inject a startup transient
// into the (short) analysis window and bias the MPM period estimate — even though
// a linear filter cannot actually shift a steady sine's frequency. Warming with a
// generous pre-roll reproduces the real, steady-state pipeline. The buffer handed
// to detect() is still EXACTLY windowSize samples.
const PREROLL = 8192;

/** Build a fresh detector for a given sample rate + mode config. */
function makeDetector(sampleRate, mode) {
  const mc = CONFIG.modes[mode];
  return new MPMDetector({
    sampleRate,
    windowSize: mc.windowSize,
    k: CONFIG.k,
    fMin: mc.fMin,
    fMax: mc.fMax,
  });
}

/**
 * Generate PREROLL+windowSize samples, filter the whole run through a fresh
 * pre-filter chain, then detect on the final windowSize (steady-state) samples.
 * @param {number} sampleRate
 * @param {'guitar'|'bass'} mode
 * @param {(total: number) => Float32Array} gen  produces a buffer of the given length
 * @returns {import('../js/dsp/mpm.js').PitchFrame}
 */
function detectThroughPipeline(sampleRate, mode, gen) {
  const mc = CONFIG.modes[mode];
  const N = mc.windowSize;
  const total = N + PREROLL;
  const full = gen(total);
  const pre = createPreFilter(mode, sampleRate, mc);
  pre.process(full, full);
  const window = full.subarray(total - N); // length === windowSize, warmed
  return makeDetector(sampleRate, mode).detect(window);
}

/**
 * Run the clean / harmonic / noise assertions for one (sampleRate, freq, mode).
 * @param {number} sampleRate
 * @param {number} freq
 * @param {'guitar'|'bass'} mode
 * @param {{clean?:boolean, harmonic?:boolean, noise?:boolean}} which
 * @param {number} seed noise seed for reproducibility
 */
function runFreqCases(sampleRate, freq, mode, which, seed) {
  const tag = `${mode} sr=${sampleRate} f=${freq}Hz`;

  if (which.clean) {
    const frame = detectThroughPipeline(sampleRate, mode, (t) => sine(freq, sampleRate, t, 0.5));
    assertCentsClose(frame.frequency, freq, 2, `[clean] ${tag}: within ±2 cents`);
    assert(frame.clarity > 0.95, `[clean] ${tag}: clarity > 0.95 (clarity=${num(frame.clarity)})`);
  }

  if (which.harmonic) {
    const frame = detectThroughPipeline(sampleRate, mode, (t) => harmonicTone(freq, sampleRate, t, 0.5));
    assertCentsClose(frame.frequency, freq, 5, `[harmonic] ${tag}: within ±5 cents`);
    // Explicitly reject octave errors: ratio must be near 1.0, not 2.0 or 0.5.
    const ratio = frame.frequency / freq;
    assert(
      Math.abs(ratio - 2.0) > 0.1 && Math.abs(ratio - 0.5) > 0.05,
      `[harmonic] ${tag}: not an octave off (ratio=${num(ratio)})`,
    );
    assert(frame.clarity > 0.9, `[harmonic] ${tag}: clarity > 0.9 (clarity=${num(frame.clarity)})`);
  }

  if (which.noise) {
    const frame = detectThroughPipeline(sampleRate, mode, (t) =>
      mix(sine(freq, sampleRate, t, 0.5), whiteNoise(sampleRate, t, 0.05, seed)),
    );
    assertCentsClose(frame.frequency, freq, 5, `[noise] ${tag}: within ±5 cents (SNR≈20 dB)`);
    assert(frame.clarity > 0.85, `[noise] ${tag}: clarity > 0.85 (clarity=${num(frame.clarity)})`);
  }
}

/** Pure white noise → no confident pitch. */
function runPureNoiseCase(sampleRate, mode, seed) {
  const frame = detectThroughPipeline(sampleRate, mode, (t) => whiteNoise(sampleRate, t, 0.3, seed));
  assert(
    frame.clarity < 0.6 || frame.frequency === -1,
    `[pure-noise] ${mode} sr=${sampleRate}: clarity < 0.6 or freq === -1 (clarity=${num(frame.clarity)}, f=${num(frame.frequency)})`,
  );
}

export default function run() {
  let seed = 1000;
  for (const sr of SAMPLE_RATES) {
    suite(`pitch: MPM accuracy @ ${sr} Hz`, () => {
      for (const freq of FREQS) {
        const primary = freq < 100 ? 'bass' : 'guitar';
        runFreqCases(sr, freq, primary, { clean: true, harmonic: true, noise: true }, seed++);

        // Also exercise the bass path for the low guitar range (freq >= 100 and
        // comfortably under the bass fMax of 500) — proves the no-HPF bass chain
        // resolves these too. Clean sine only, to stay "where sensible".
        if (freq >= 100 && freq < CONFIG.modes.bass.fMax * 0.9) {
          runFreqCases(sr, freq, 'bass', { clean: true }, seed++);
        }
      }
      // Pure noise, once per mode/config at this sample rate.
      runPureNoiseCase(sr, 'bass', seed++);
      runPureNoiseCase(sr, 'guitar', seed++);
    });
  }
}

/** @param {number} x @returns {string} */
function num(x) {
  return Number.isFinite(x) ? x.toFixed(4) : String(x);
}
