// PURE. Deterministic signal synthesis for the Node test harness. No browser APIs.
// Everything returns Float32Array so buffers drop straight into the DSP pipeline.

/**
 * Pure sine wave.
 * @param {number} freq        Hz
 * @param {number} sampleRate  Hz
 * @param {number} n           number of samples
 * @param {number} [amp=0.5]   peak amplitude
 * @param {number} [phase=0]   radians
 * @returns {Float32Array}
 */
export function sine(freq, sampleRate, n, amp = 0.5, phase = 0) {
  const out = new Float32Array(n);
  const w = (2 * Math.PI * freq) / sampleRate;
  for (let i = 0; i < n; i++) {
    out[i] = amp * Math.sin(w * i + phase);
  }
  return out;
}

/**
 * Harmonic-rich tone: sum of partials k*freq (k = 1..harmonicAmps.length) with the
 * given relative amplitudes, then normalized so the peak sample ≈ amp.
 * @param {number} freq
 * @param {number} sampleRate
 * @param {number} n
 * @param {number} [amp=0.5]
 * @param {number[]} [harmonicAmps=[1,0.5,0.3,0.2,0.1]]
 * @returns {Float32Array}
 */
export function harmonicTone(freq, sampleRate, n, amp = 0.5, harmonicAmps = [1, 0.5, 0.3, 0.2, 0.1]) {
  const out = new Float32Array(n);
  const w = (2 * Math.PI * freq) / sampleRate;
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = 0; k < harmonicAmps.length; k++) {
      s += harmonicAmps[k] * Math.sin(w * (k + 1) * i);
    }
    out[i] = s;
  }
  // Normalize so the observed peak equals amp.
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.abs(out[i]);
    if (a > peak) peak = a;
  }
  if (peak > 0) {
    const g = amp / peak;
    for (let i = 0; i < n; i++) out[i] *= g;
  }
  return out;
}

/**
 * Deterministic white noise via the mulberry32 PRNG (fixed seed → repeatable).
 * @param {number} sampleRate   (unused; kept for signature symmetry)
 * @param {number} n
 * @param {number} [amp=0.5]
 * @param {number} [seed=1]
 * @returns {Float32Array}  samples uniform in [-amp, amp]
 */
export function whiteNoise(sampleRate, n, amp = 0.5, seed = 1) {
  const rng = mulberry32(seed >>> 0);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = amp * (rng() * 2 - 1);
  }
  return out;
}

/**
 * Element-wise sum of two equal-length buffers (truncates to the shorter one).
 * @param {Float32Array} a
 * @param {Float32Array} b
 * @returns {Float32Array}
 */
export function mix(a, b) {
  const n = Math.min(a.length, b.length);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = a[i] + b[i];
  return out;
}

/**
 * mulberry32 — small, fast, deterministic 32-bit PRNG.
 * @param {number} a seed
 * @returns {() => number} generator yielding floats in [0, 1)
 */
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
