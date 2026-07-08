// js/audio/capture.js — BROWSER ONLY
// Mic permission + AudioContext AnalyserNode wrapper. Pull API: readFrame() per rAF tick.
// One of only two modules permitted to touch Web Audio APIs.

/**
 * @typedef {'idle'|'running'|'stopped'|'error'} CaptureState
 */

export class MicCapture {
  /**
   * @param {Object} opts
   * @param {AudioContext} opts.audioContext  Shared context created by app.js.
   * @param {number} opts.windowSize          Sets analyser.fftSize (2048 or 4096).
   */
  constructor({ audioContext, windowSize }) {
    if (!audioContext) throw new Error('MicCapture: audioContext is required');
    /** @private */ this._ctx = audioContext;
    /** @private */ this._windowSize = windowSize;

    /** @private @type {AnalyserNode} */
    this._analyser = audioContext.createAnalyser();
    this._analyser.fftSize = windowSize;
    // Time-domain data is not affected by smoothing, but keep it at 0 to be explicit.
    this._analyser.smoothingTimeConstant = 0;

    /** @private @type {MediaStream|null} */ this._stream = null;
    /** @private @type {MediaStreamAudioSourceNode|null} */ this._source = null;
    /** @private @type {CaptureState} */ this._state = 'idle';
  }

  /**
   * getUserMedia -> MediaStreamAudioSourceNode -> AnalyserNode.
   * All browser audio processing (echoCancellation/noiseSuppression/autoGainControl)
   * MUST be disabled for tuning accuracy. Does NOT connect analyser to destination.
   * @returns {Promise<void>} resolves once stream is connected.
   *   Rejects with the original DOMException (NotAllowedError / NotFoundError).
   */
  async start() {
    // Idempotent-ish: if already running, do nothing.
    if (this._state === 'running') return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
        },
      });

      this._stream = stream;
      this._source = this._ctx.createMediaStreamSource(stream);
      this._source.connect(this._analyser);
      // Deliberately do NOT connect analyser -> destination (avoid feedback loop).

      this._state = 'running';
    } catch (err) {
      this._state = 'error';
      // Re-throw the original DOMException so the UI can map NotAllowedError etc.
      throw err;
    }
  }

  /**
   * Disconnects nodes and stops all MediaStream tracks. Idempotent.
   */
  stop() {
    if (this._source) {
      try { this._source.disconnect(); } catch (_) { /* already disconnected */ }
      this._source = null;
    }
    try { this._analyser.disconnect(); } catch (_) { /* not connected */ }

    if (this._stream) {
      for (const track of this._stream.getTracks()) {
        try { track.stop(); } catch (_) { /* ignore */ }
      }
      this._stream = null;
    }

    // Preserve an 'error' state; otherwise a successful stop lands in 'stopped'.
    if (this._state !== 'error') this._state = 'stopped';
  }

  /**
   * Copies latest windowSize samples via analyser.getFloatTimeDomainData.
   * @param {Float32Array} out length === windowSize
   * @returns {boolean} false if not running, true otherwise.
   */
  readFrame(out) {
    if (this._state !== 'running') return false;
    this._analyser.getFloatTimeDomainData(out);
    return true;
  }

  /**
   * Rebuild/reconfigure analyser with a new size (mode switch), keeping the
   * source connected.
   * @param {number} windowSize
   */
  setWindowSize(windowSize) {
    if (windowSize === this._windowSize) return;
    this._windowSize = windowSize;
    // fftSize is settable in place; the source connection is unaffected.
    this._analyser.fftSize = windowSize;
  }

  /** @returns {CaptureState} */
  get state() {
    return this._state;
  }

  /** @returns {number} audioContext.sampleRate */
  get sampleRate() {
    return this._ctx.sampleRate;
  }
}
