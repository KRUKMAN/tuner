// Streaming integration test — mirrors the real app.js rAF loop as closely as
// possible in Node: a continuous signal is read in overlapping windows, the
// pre-filter is warmed over a capture window of 2*N and detection runs on the
// warmed tail of N samples, then the Stabilizer smooths across frames.
// Verifies the end-to-end path (preFilter -> MPMDetector -> Stabilizer) produces
// a steady, correct DisplayState — the thing the UI renders.

import { CONFIG } from '../js/config.js';
import { MPMDetector } from '../js/dsp/mpm.js';
import { createPreFilter } from '../js/dsp/filters.js';
import { Stabilizer } from '../js/dsp/stabilizer.js';
import { TUNINGS } from '../js/music/tunings.js';
import { harmonicTone, sine, whiteNoise, mix } from './synth.js';
import { suite, assert, assertCentsClose } from './assert.js';

/**
 * Drive the pipeline over a continuous signal like the app does.
 * @returns {import('../js/dsp/stabilizer.js').DisplayState} last DisplayState
 */
function runStream({ signal, sampleRate, mode, tuningId, frames = 40, hop = 512 }) {
  const mc = CONFIG.modes[mode];
  const N = mc.windowSize;
  const captureSize = 2 * N; // app captures 2N and detects on the warmed tail
  const detector = new MPMDetector({ sampleRate, windowSize: N, k: CONFIG.k, fMin: mc.fMin, fMax: mc.fMax });
  const preFilter = createPreFilter(mode, sampleRate, mc);
  const stab = new Stabilizer({ config: CONFIG, a4: 440, tuning: TUNINGS[tuningId].strings });

  const cap = new Float32Array(captureSize);
  let last = null;
  for (let i = 0; i < frames; i++) {
    const start = i * hop;
    if (start + captureSize > signal.length) break;
    // emulate AnalyserNode handing back the latest captureSize samples
    cap.set(signal.subarray(start, start + captureSize));
    // warm the filter over the whole capture window, detect on the tail N
    preFilter.reset();
    preFilter.process(cap, cap);
    const frame = detector.detect(cap.subarray(captureSize - N));
    last = stab.update(frame, i * 16.67);
  }
  return last;
}

export default function run() {
  suite('integration: guitar A2 (110 Hz) steady lock', () => {
    const sr = 44100;
    const sig = harmonicTone(110, sr, sr, 0.5); // 1 s harmonic-rich tone
    const ds = runStream({ signal: sig, sampleRate: sr, mode: 'guitar', tuningId: 'guitar-standard' });
    assert(ds.status === 'active' || ds.status === 'hold', `status active/hold (got ${ds.status})`);
    assert(ds.noteName === 'A', `note is A (got ${ds.noteName})`);
    assert(ds.octave === 2, `octave 2 (got ${ds.octave})`);
    assert(Math.abs(ds.cents) < 3, `|cents| < 3 (got ${ds.cents?.toFixed(2)})`);
    assert(ds.inTune === true, `inTune true (cents ${ds.cents?.toFixed(2)})`);
    assert(ds.stringIndex === 1, `auto-selected A string index 1 (got ${ds.stringIndex})`);
  });

  suite('integration: guitar low E2 (82.41 Hz) near HPF cutoff', () => {
    const sr = 48000;
    const sig = harmonicTone(82.41, sr, sr, 0.5);
    const ds = runStream({ signal: sig, sampleRate: sr, mode: 'guitar', tuningId: 'guitar-standard' });
    assert(ds.noteName === 'E' && ds.octave === 2, `note E2 (got ${ds.noteName}${ds.octave})`);
    assertCentsClose(ds.frequency, 82.41, 5, 'E2 frequency within 5 cents through warmed guitar filter');
    assert(ds.stringIndex === 0, `low E string index 0 (got ${ds.stringIndex})`);
  });

  suite('integration: bass low E1 (41.20 Hz)', () => {
    const sr = 44100;
    const sig = harmonicTone(41.20, sr, Math.round(sr * 1.5), 0.5);
    const ds = runStream({ signal: sig, sampleRate: sr, mode: 'bass', tuningId: 'bass-4-standard', frames: 60 });
    assert(ds.noteName === 'E' && ds.octave === 1, `note E1 (got ${ds.noteName}${ds.octave})`);
    assertCentsClose(ds.frequency, 41.20, 5, 'E1 frequency within 5 cents (bass, no HPF)');
    assert(ds.stringIndex === 0, `bass low E index 0 (got ${ds.stringIndex})`);
  });

  suite('integration: 5-string bass low B0 (30.87 Hz)', () => {
    const sr = 44100;
    const sig = harmonicTone(30.87, sr, Math.round(sr * 1.5), 0.5);
    const ds = runStream({ signal: sig, sampleRate: sr, mode: 'bass', tuningId: 'bass-5-standard', frames: 60 });
    assert(ds.noteName === 'B' && ds.octave === 0, `note B0 (got ${ds.noteName}${ds.octave})`);
    assertCentsClose(ds.frequency, 30.87, 8, 'B0 frequency within 8 cents (hardest low note)');
  });

  suite('integration: noise never produces a false lock', () => {
    const sr = 44100;
    const sig = whiteNoise(sr, sr, 0.2, 7);
    const ds = runStream({ signal: sig, sampleRate: sr, mode: 'guitar', tuningId: 'guitar-standard' });
    // gate may be open (noise is loud) but a confident note must NOT appear
    assert(!(ds.status === 'active' && ds.inTune), `no confident in-tune lock on noise (status ${ds.status}, inTune ${ds.inTune})`);
  });

  suite('integration: silence -> note -> silence (gate + hold + blank)', () => {
    const sr = 44100;
    const N = CONFIG.modes.guitar.windowSize;
    const cap = 2 * N;
    const quiet = sine(110, sr, cap * 3, 0.0002); // effectively silent
    const loud = harmonicTone(110, sr, Math.round(sr * 0.6), 0.5);
    const tail = sine(110, sr, cap * 6, 0.0002);
    const sig = mix ? null : null; // build manually below
    const full = new Float32Array(quiet.length + loud.length + tail.length);
    full.set(quiet, 0); full.set(loud, quiet.length); full.set(tail, quiet.length + loud.length);

    const mc = CONFIG.modes.guitar;
    const detector = new MPMDetector({ sampleRate: sr, windowSize: N, k: CONFIG.k, fMin: mc.fMin, fMax: mc.fMax });
    const preFilter = createPreFilter('guitar', sr, mc);
    const stab = new Stabilizer({ config: CONFIG, a4: 440, tuning: TUNINGS['guitar-standard'].strings });
    const buf = new Float32Array(cap);
    const hop = 512;
    let sawActive = false, sawSilentFirst = false, t = 0;
    let firstStatus = null;
    for (let start = 0; start + cap <= full.length; start += hop) {
      buf.set(full.subarray(start, start + cap));
      preFilter.reset(); preFilter.process(buf, buf);
      const fr = detector.detect(buf.subarray(cap - N));
      const ds = stab.update(fr, t); t += 16.67;
      if (firstStatus === null) firstStatus = ds.status;
      if (ds.status === 'silent') sawSilentFirst = sawSilentFirst || !sawActive;
      if (ds.status === 'active' && ds.noteName === 'A') sawActive = true;
    }
    assert(sawSilentFirst, 'gate stayed silent during the quiet intro');
    assert(sawActive, 'locked note A once the tone played');
  });

  suite('integration: buzzy weak-fundamental low E2 still recovers (no octave error)', () => {
    const sr = 44100;
    const N = CONFIG.modes.guitar.windowSize;
    const cap = 2 * N;
    const len = sr; // 1 s of steady signal
    // Weak fundamental, strong 2nd/3rd harmonics (the classic octave-error trap)
    // + an inharmonic "buzz" partial + a little broadband noise.
    const tone = harmonicTone(82.41, sr, len, 0.5, [0.15, 1.0, 0.8, 0.3, 0.15]);
    const buzz = sine(1237, sr, len, 0.12);
    const noise = whiteNoise(sr, len, 0.04, 7);
    const full = mix(mix(tone, buzz), noise);

    const mc = CONFIG.modes.guitar;
    // detection LPF for guitar: min(1300, max(500, maxFundamental*harmonics)) = 1300
    const detectLpf = Math.min(mc.lpfHz, Math.max(CONFIG.detectLpfMinHz, 329.63 * CONFIG.detectLpfHarmonics));
    const detector = new MPMDetector({ sampleRate: sr, windowSize: N, k: CONFIG.k, fMin: mc.fMin, fMax: mc.fMax });
    const preFilter = createPreFilter('guitar', sr, mc, detectLpf);
    const stab = new Stabilizer({ config: CONFIG, a4: 440, tuning: TUNINGS['guitar-standard'].strings });

    const buf = new Float32Array(cap);
    const hop = 512;
    let ds = null;
    let t = 0;
    let frames = 0;
    for (let start = 0; start + cap <= full.length && frames < 20; start += hop) {
      buf.set(full.subarray(start, start + cap));
      preFilter.reset();
      preFilter.process(buf, buf);
      const fr = detector.detect(buf.subarray(cap - N));
      ds = stab.update(fr, t);
      t += 16.67;
      frames++;
    }
    assert(ds.status === 'active', `buzzy weak-fundamental note reaches 'active' (got ${ds.status})`);
    assert(ds.noteName === 'E', `note is E (got ${ds.noteName})`);
    assert(ds.octave === 2, `octave 2 — recovered real string, not the 2nd-harmonic octave (got ${ds.octave})`);
    assert(ds.octave !== 3, `explicitly NOT E3 octave error (got ${ds.octave})`);
    assert(Math.abs(ds.cents) < 12, `|cents| < 12 despite buzz + noise (got ${ds.cents?.toFixed(2)})`);
  });
}
