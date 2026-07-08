// PURE. Sample-domain pre-filtering. Node-safe, zero browser APIs.
// Direct Form II Transposed biquads, RBJ cookbook coefficients,
// Butterworth Q = Math.SQRT1_2. See architecture.md Section 2.4.

/**
 * First-order DC blocker: y[n] = x[n] - x[n-1] + r*y[n-1].
 * Removes DC / very-low-frequency offset while preserving the passband.
 */
export class DCBlocker {
  /** @param {number} [r=0.995] pole radius (closer to 1 = lower corner). */
  constructor(r = 0.995) {
    this.r = r;
    this.x1 = 0; // previous input  x[n-1]
    this.y1 = 0; // previous output y[n-1]
  }

  /**
   * In-place capable (output may be the same array as input).
   * @param {Float32Array} input
   * @param {Float32Array} output
   */
  process(input, output) {
    const r = this.r;
    let x1 = this.x1;
    let y1 = this.y1;
    const n = input.length;
    for (let i = 0; i < n; i++) {
      const x = input[i];
      const y = x - x1 + r * y1;
      output[i] = y;
      x1 = x;
      y1 = y;
    }
    this.x1 = x1;
    this.y1 = y1;
  }

  reset() {
    this.x1 = 0;
    this.y1 = 0;
  }
}

/**
 * Second-order IIR biquad in Direct Form II Transposed.
 * Construct via the static factories; coefficients are stored already
 * normalized by a0.
 */
export class Biquad {
  /**
   * Prefer Biquad.lowpass / Biquad.highpass. Coefficients are the
   * a0-normalized transfer-function terms.
   * @param {number} b0 @param {number} b1 @param {number} b2
   * @param {number} a1 @param {number} a2
   */
  constructor(b0, b1, b2, a1, a2) {
    this.b0 = b0;
    this.b1 = b1;
    this.b2 = b2;
    this.a1 = a1;
    this.a2 = a2;
    this.s1 = 0; // transposed-DF2 state
    this.s2 = 0;
  }

  /**
   * RBJ cookbook low-pass.
   * @param {number} sampleRate
   * @param {number} freq
   * @param {number} [q=Math.SQRT1_2]
   * @returns {Biquad}
   */
  static lowpass(sampleRate, freq, q = Math.SQRT1_2) {
    const w0 = (2 * Math.PI * freq) / sampleRate;
    const cosw0 = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * q);
    const b0 = (1 - cosw0) / 2;
    const b1 = 1 - cosw0;
    const b2 = (1 - cosw0) / 2;
    const a0 = 1 + alpha;
    const a1 = -2 * cosw0;
    const a2 = 1 - alpha;
    return new Biquad(b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0);
  }

  /**
   * RBJ cookbook high-pass.
   * @param {number} sampleRate
   * @param {number} freq
   * @param {number} [q=Math.SQRT1_2]
   * @returns {Biquad}
   */
  static highpass(sampleRate, freq, q = Math.SQRT1_2) {
    const w0 = (2 * Math.PI * freq) / sampleRate;
    const cosw0 = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * q);
    const b0 = (1 + cosw0) / 2;
    const b1 = -(1 + cosw0);
    const b2 = (1 + cosw0) / 2;
    const a0 = 1 + alpha;
    const a1 = -2 * cosw0;
    const a2 = 1 - alpha;
    return new Biquad(b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0);
  }

  /**
   * In-place capable (output may be the same array as input).
   * @param {Float32Array} input
   * @param {Float32Array} output
   */
  process(input, output) {
    const b0 = this.b0;
    const b1 = this.b1;
    const b2 = this.b2;
    const a1 = this.a1;
    const a2 = this.a2;
    let s1 = this.s1;
    let s2 = this.s2;
    const n = input.length;
    for (let i = 0; i < n; i++) {
      const x = input[i];
      const y = b0 * x + s1;
      s1 = b1 * x - a1 * y + s2;
      s2 = b2 * x - a2 * y;
      output[i] = y;
    }
    this.s1 = s1;
    this.s2 = s2;
  }

  reset() {
    this.s1 = 0;
    this.s2 = 0;
  }
}

/**
 * Builds the per-mode pre-filter chain.
 *   Guitar: DCBlocker -> HPF(hpfHz) -> LPF(lpfHz).
 *   Bass (hpfHz === null): DCBlocker -> LPF(lpfHz), NO high-pass.
 * Stages run in place: the first writes input -> output, each subsequent
 * stage filters output -> output.
 * @param {'guitar'|'bass'} mode
 * @param {number} sampleRate
 * @param {import('../config.js').ModeConfig} modeConfig  from CONFIG.modes[mode]
 * @param {number} [lpfHzOverride] if provided AND < modeConfig.lpfHz, use it for the LPF stage (strips buzz for known low tunings)
 * @returns {{ process(input: Float32Array, output: Float32Array): void, reset(): void }}
 */
export function createPreFilter(mode, sampleRate, modeConfig, lpfHzOverride) {
  /** @type {Array<{process: Function, reset: Function}>} */
  const stages = [];
  // Bass has no Butterworth high-pass, so its DC blocker must sit well below
  // B0 (30.87 Hz): r=0.999 -> ~7 Hz corner, <0.5 dB at B0. Guitar leans on the
  // 65 Hz HPF for low-end removal, so a tighter DC blocker (r=0.995) is fine.
  const dcR = mode === 'bass' ? 0.999 : 0.995;
  stages.push(new DCBlocker(dcR));
  if (modeConfig.hpfHz !== null && modeConfig.hpfHz !== undefined) {
    stages.push(Biquad.highpass(sampleRate, modeConfig.hpfHz));
  }
  const lpfHz =
    lpfHzOverride != null && lpfHzOverride < modeConfig.lpfHz
      ? lpfHzOverride
      : modeConfig.lpfHz;
  stages.push(Biquad.lowpass(sampleRate, lpfHz));

  return {
    process(input, output) {
      stages[0].process(input, output);
      for (let i = 1; i < stages.length; i++) {
        stages[i].process(output, output);
      }
    },
    reset() {
      for (let i = 0; i < stages.length; i++) stages[i].reset();
    },
  };
}
