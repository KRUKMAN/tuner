// PURE. Casiez "One-Euro" adaptive low-pass filter. Node-safe, zero browser APIs.
// Timestamps are injected in milliseconds; the filter never reads a clock itself.
// See architecture.md Section 2.5.

/**
 * @param {number} cutoff cutoff frequency in Hz
 * @param {number} Te     sample period in seconds
 * @returns {number} smoothing factor alpha in (0, 1)
 */
function alphaFor(cutoff, Te) {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / Te);
}

export class OneEuroFilter {
  /**
   * @param {Object} [opts]
   * @param {number} [opts.fcMin=1.0]  Minimum cutoff Hz.
   * @param {number} [opts.beta=0.007] Speed coefficient.
   * @param {number} [opts.dCutoff=1.0] Derivative cutoff Hz.
   */
  constructor(opts = {}) {
    this.fcMin = opts.fcMin != null ? opts.fcMin : 1.0;
    this.beta = opts.beta != null ? opts.beta : 0.007;
    this.dCutoff = opts.dCutoff != null ? opts.dCutoff : 1.0;
    this.reset();
  }

  /**
   * @param {number} value       Sample to filter (we feed CENTS, never raw Hz).
   * @param {number} timestampMs Monotonic ms from the caller.
   * @returns {number} filtered value. First call returns value unchanged.
   */
  filter(value, timestampMs) {
    if (!this._initialized) {
      this._initialized = true;
      this._xPrev = value;
      this._xHatPrev = value;
      this._dxHatPrev = 0;
      this._tPrev = timestampMs;
      return value;
    }

    const Te = (timestampMs - this._tPrev) / 1000;
    if (Te <= 0) {
      // Guard against non-monotonic / duplicate timestamps: hold last output.
      return this._xHatPrev;
    }

    // Derivative of the signal, low-passed at dCutoff.
    const dx = (value - this._xPrev) / Te;
    const aD = alphaFor(this.dCutoff, Te);
    const edx = aD * dx + (1 - aD) * this._dxHatPrev;

    // Adaptive cutoff: faster motion -> higher cutoff -> less lag.
    const cutoff = this.fcMin + this.beta * Math.abs(edx);
    const a = alphaFor(cutoff, Te);
    const xHat = a * value + (1 - a) * this._xHatPrev;

    this._xPrev = value;
    this._xHatPrev = xHat;
    this._dxHatPrev = edx;
    this._tPrev = timestampMs;
    return xHat;
  }

  reset() {
    this._initialized = false;
    this._xPrev = 0;
    this._xHatPrev = 0;
    this._dxHatPrev = 0;
    this._tPrev = 0;
  }
}
