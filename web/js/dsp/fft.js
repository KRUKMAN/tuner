// PURE. Fixed-size radix-2 complex FFT with preallocated tables.
// Iterative in-place Cooley-Tukey (decimation-in-time). No allocation in
// forward()/inverse(); all scratch/twiddle/bit-reversal tables built in ctor.

/**
 * @param {number} n
 * @returns {number} smallest power of two >= n
 */
export function nextPow2(n) {
  if (n <= 1) return 1;
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

export class FFT {
  /** @param {number} size Power of two. Throws if not. */
  constructor(size) {
    if (!Number.isInteger(size) || size < 2 || (size & (size - 1)) !== 0) {
      throw new Error(`FFT size must be a power of two >= 2, got ${size}`);
    }
    this._size = size;

    // Precompute bit-reversal permutation indices.
    const bits = Math.log2(size);
    this._rev = new Uint32Array(size);
    for (let i = 0; i < size; i++) {
      let x = i;
      let r = 0;
      for (let b = 0; b < bits; b++) {
        r = (r << 1) | (x & 1);
        x >>= 1;
      }
      this._rev[i] = r >>> 0;
    }

    // Precompute twiddle factors for a forward transform (sign = -1):
    // W_k = exp(-2*pi*i*k/size) for k in [0, size/2).
    const half = size >> 1;
    this._cosTable = new Float64Array(half);
    this._sinTable = new Float64Array(half);
    for (let k = 0; k < half; k++) {
      const ang = (-2 * Math.PI * k) / size;
      this._cosTable[k] = Math.cos(ang);
      this._sinTable[k] = Math.sin(ang);
    }

    // Scratch real/imag work buffers (allocation-free transforms).
    this._re = new Float64Array(size);
    this._im = new Float64Array(size);
  }

  /** @returns {number} */
  get size() {
    return this._size;
  }

  /**
   * In-place iterative radix-2 FFT over the internal work buffers.
   * @param {number} sign -1 for forward, +1 for inverse (twiddle conjugated).
   * @private
   */
  _transform(sign) {
    const n = this._size;
    const re = this._re;
    const im = this._im;
    const rev = this._rev;
    const cosT = this._cosTable;
    const sinT = this._sinTable;

    // Bit-reversal reordering (in place, swap once per pair).
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }

    // Butterfly stages. len = current sub-FFT size.
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1;
      // Table stride: twiddle index for position j within the half is
      // j * (n / len).
      const step = n / len;
      for (let start = 0; start < n; start += len) {
        for (let j = 0; j < half; j++) {
          const tIdx = j * step;
          const wr = cosT[tIdx];
          // Forward uses stored (negative-angle) sin; inverse flips the sign.
          const wi = sign < 0 ? sinT[tIdx] : -sinT[tIdx];

          const a = start + j;
          const b = a + half;
          const xr = re[b];
          const xi = im[b];
          // twiddle * lower half
          const tr = wr * xr - wi * xi;
          const ti = wr * xi + wi * xr;

          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] = re[a] + tr;
          im[a] = im[a] + ti;
        }
      }
    }
  }

  /**
   * Forward FFT of a real signal (imag assumed 0).
   * @param {Float32Array} realIn  length === size
   * @param {Float32Array} reOut   length === size (caller-allocated)
   * @param {Float32Array} imOut   length === size (caller-allocated)
   */
  forward(realIn, reOut, imOut) {
    const n = this._size;
    const re = this._re;
    const im = this._im;
    for (let i = 0; i < n; i++) {
      re[i] = realIn[i];
      im[i] = 0;
    }
    this._transform(-1);
    for (let i = 0; i < n; i++) {
      reOut[i] = re[i];
      imOut[i] = im[i];
    }
  }

  /**
   * Inverse FFT, returning real part only (normalized by 1/size).
   * @param {Float32Array} reIn
   * @param {Float32Array} imIn
   * @param {Float32Array} realOut length === size
   */
  inverse(reIn, imIn, realOut) {
    const n = this._size;
    const re = this._re;
    const im = this._im;
    for (let i = 0; i < n; i++) {
      re[i] = reIn[i];
      im[i] = imIn[i];
    }
    this._transform(1);
    const invN = 1 / n;
    for (let i = 0; i < n; i++) {
      realOut[i] = re[i] * invN;
    }
  }
}
