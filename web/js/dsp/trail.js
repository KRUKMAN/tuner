// PURE (Node-safe, zero browser APIs). Fixed-capacity ring buffer of recent
// pitch readings for a cents-over-time graph. Allocation-free O(1) push.

const FLAG_IN_TUNE = 1; // bit0

export class TrailBuffer {
  /**
   * @param {Object} [opts]
   * @param {number} [opts.capacity=1024] max samples retained
   * @param {number} [opts.windowMs=5000] nominal visible time window; forEach() trims to it
   */
  constructor(opts = {}) {
    const capacity = opts.capacity ?? 1024;
    this.capacity = capacity;
    this.windowMs = opts.windowMs ?? 5000;
    // Four preallocated parallel arrays.
    this._tMs = new Float64Array(capacity);
    this._cents = new Float32Array(capacity);
    this._conf = new Float32Array(capacity);
    this._flags = new Uint8Array(capacity);
    // Index just past the newest sample (next write position).
    this._head = 0;
    // Number of valid samples currently stored (<= capacity).
    this._count = 0;
  }

  /** @returns {number} number of samples currently retained */
  get count() {
    return this._count;
  }

  /**
   * Push one sample per stabilizer frame. Overwrites the oldest when full.
   * O(1), allocation-free.
   * @param {number} tMs        monotonic ms (same clock as stabilizer.update)
   * @param {number} cents      smoothed cents, or NaN when silent/rejected (a gap)
   * @param {number} confidence 0..1
   * @param {boolean} inTune
   */
  push(tMs, cents, confidence, inTune) {
    const i = this._head;
    this._tMs[i] = tMs;
    this._cents[i] = cents;
    this._conf[i] = confidence;
    this._flags[i] = inTune ? FLAG_IN_TUNE : 0;
    this._head = (i + 1) % this.capacity;
    if (this._count < this.capacity) this._count++;
  }

  /**
   * Iterate samples newer than (nowMs - windowMs), oldest -> newest.
   * NaN cents values are preserved (they mark gaps in the line).
   * @param {number} nowMs
   * @param {(tMs:number, cents:number, confidence:number, inTune:boolean) => void} cb
   */
  forEach(nowMs, cb) {
    const cutoff = nowMs - this.windowMs;
    const cap = this.capacity;
    // Oldest sample index: head - count, wrapped into [0, cap).
    const start = (this._head - this._count + cap) % cap;
    for (let n = 0; n < this._count; n++) {
      const i = (start + n) % cap;
      const t = this._tMs[i];
      if (t <= cutoff) continue;
      cb(t, this._cents[i], this._conf[i], (this._flags[i] & FLAG_IN_TUNE) !== 0);
    }
  }

  /** Reset count/head, discarding all samples. */
  clear() {
    this._head = 0;
    this._count = 0;
  }
}
