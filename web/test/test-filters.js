// Node. Filter sanity — DC removal, guitar HPF stop/pass, bass pre-filter passband.
// Section 6: DCBlocker kills a 0.3 offset; guitar HPF attenuates 30 Hz by >12 dB and
// passes 110 Hz within ~1 dB; bass pre-filter passes 30.87 Hz within ~1 dB.

import { suite, assert } from './assert.js';
import { DCBlocker, Biquad, createPreFilter } from '../js/dsp/filters.js';
import { CONFIG } from '../js/config.js';
import { sine } from './synth.js';

/**
 * RMS of a buffer, ignoring a settling prefix.
 * @param {Float32Array} a
 * @param {number} start first index to include
 * @returns {number}
 */
function rms(a, start) {
  let s = 0;
  for (let i = start; i < a.length; i++) s += a[i] * a[i];
  return Math.sqrt(s / (a.length - start));
}

/** Gain in dB of output vs input over the same steady-state window. */
function gainDb(input, output, start) {
  return 20 * Math.log10(rms(output, start) / rms(input, start));
}

export default function run() {
  suite('filters: DCBlocker removes constant offset', () => {
    const N = 8192;
    const settle = 2000; // r=0.995 → time constant ≈ 200 samples; 2000 is ample.
    const x = new Float32Array(N).fill(0.3);
    const y = new Float32Array(N);
    const dc = new DCBlocker(0.995);
    dc.process(x, y);
    let mean = 0;
    for (let i = settle; i < N; i++) mean += y[i];
    mean /= N - settle;
    assert(Math.abs(mean) < 1e-3, `DCBlocker output mean ≈ 0 after settling (mean=${mean.toExponential(2)})`);
  });

  suite('filters: guitar HPF (65 Hz Butterworth)', () => {
    const sr = 44100;
    const N = 44100; // 1 s — enough periods for a clean 30 Hz measurement.
    const settle = 4410;
    const q = Math.SQRT1_2;

    // 30 Hz should be attenuated by > 12 dB.
    const in30 = sine(30, sr, N, 0.5);
    const out30 = new Float32Array(N);
    const hpfA = Biquad.highpass(sr, 65, q);
    hpfA.process(in30, out30);
    const att30 = gainDb(in30, out30, settle);
    assert(att30 < -12, `guitar HPF attenuates 30 Hz by > 12 dB (gain=${att30.toFixed(2)} dB)`);

    // 110 Hz should pass within ~1 dB.
    const in110 = sine(110, sr, N, 0.5);
    const out110 = new Float32Array(N);
    const hpfB = Biquad.highpass(sr, 65, q);
    hpfB.process(in110, out110);
    const g110 = gainDb(in110, out110, settle);
    assert(Math.abs(g110) <= 1, `guitar HPF passes 110 Hz within 1 dB (gain=${g110.toFixed(2)} dB)`);
  });

  suite('filters: bass pre-filter passband (no HPF)', () => {
    const sr = 44100;
    const N = 44100;
    const settle = 4410;
    const modeConfig = CONFIG.modes.bass; // hpfHz === null → DCBlocker + LPF only
    const pre = createPreFilter('bass', sr, modeConfig);

    const inB0 = sine(30.87, sr, N, 0.5); // B0 (lowest 5-string bass note)
    const outB0 = new Float32Array(N);
    pre.process(inB0, outB0);
    const g = gainDb(inB0, outB0, settle);
    // Section 6 asks for "within 1 dB". NOTE: this currently fails (~ -3.6 dB) —
    // it is a genuine CONTRACT INCONSISTENCY, not a test defect: the frozen
    // DCBlocker r = 0.995 (Section 4) has its −3 dB corner near ~35 Hz, so it
    // attenuates B0 (30.87 Hz) by ≈3.6 dB. Meeting Section 6 requires the source
    // to use a gentler DC blocker for bass (r ≈ 0.999 → corner ≈ 7 Hz). The
    // threshold is left at the contract's 1 dB so the harness surfaces the defect.
    assert(Math.abs(g) <= 1, `bass pre-filter passes 30.87 Hz within 1 dB (gain=${g.toFixed(2)} dB)`);
  });

  suite('filters: bass detection-LPF override (low tuning buzz rejection)', () => {
    const sr = 44100;
    const N = 44100;
    const settle = 4410;
    const modeConfig = CONFIG.modes.bass; // hpfHz === null → DCBlocker + LPF only
    const lpfHzOverride = 500; // detection LPF for known low tunings
    const pre = createPreFilter('bass', sr, modeConfig, lpfHzOverride);

    // (a) B0 (30.87 Hz) passes within ~1.5 dB.
    const inB0 = sine(30.87, sr, N, 0.5);
    const outB0 = new Float32Array(N);
    pre.process(inB0, outB0);
    const gB0 = gainDb(inB0, outB0, settle);
    assert(Math.abs(gB0) <= 1.5, `bass detection-LPF passes 30.87 Hz within 1.5 dB (gain=${gB0.toFixed(2)} dB)`);

    // (b) G2 (98 Hz, bass top string) passes within ~1.5 dB.
    pre.reset();
    const inG2 = sine(98, sr, N, 0.5);
    const outG2 = new Float32Array(N);
    pre.process(inG2, outG2);
    const gG2 = gainDb(inG2, outG2, settle);
    assert(Math.abs(gG2) <= 1.5, `bass detection-LPF passes 98 Hz within 1.5 dB (gain=${gG2.toFixed(2)} dB)`);

    // (c) 1200 Hz buzz attenuated by > 12 dB (2nd-order Butterworth ≈ −16 dB here).
    pre.reset();
    const inBuzz = sine(1200, sr, N, 0.5);
    const outBuzz = new Float32Array(N);
    pre.process(inBuzz, outBuzz);
    const gBuzz = gainDb(inBuzz, outBuzz, settle);
    assert(gBuzz < -12, `bass detection-LPF attenuates 1200 Hz buzz by > 12 dB (gain=${gBuzz.toFixed(2)} dB)`);
  });
}
