// js/audio/tone.js — BROWSER ONLY
// Reference sine with a raised-cosine (Hann-shaped) amplitude envelope.
// One of only two modules permitted to touch Web Audio APIs.

/**
 * Build a raised-cosine ramp curve, scaled by `peak`.
 *   rising  (0 -> peak): peak * (0.5 - 0.5*cos(pi * t/T))
 *   falling (peak -> 0):  peak * (0.5 + 0.5*cos(pi * t/T))
 * @param {number} peak
 * @param {boolean} rising
 * @param {number} [points=64]
 * @returns {Float32Array}
 */
function raisedCosineCurve(peak, rising, points = 64) {
  const n = Math.max(2, points | 0);
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const phase = (Math.PI * i) / (n - 1); // 0 .. pi
    const shape = rising ? 0.5 - 0.5 * Math.cos(phase) : 0.5 + 0.5 * Math.cos(phase);
    curve[i] = peak * shape;
  }
  return curve;
}

export class ReferenceTone {
  /**
   * @param {Object} opts
   * @param {AudioContext} opts.audioContext Shared context.
   * @param {number} [opts.amplitude=0.25]
   * @param {number} [opts.fadeInMs=10]
   * @param {number} [opts.fadeOutMs=20]
   */
  constructor({ audioContext, amplitude = 0.25, fadeInMs = 10, fadeOutMs = 20 }) {
    if (!audioContext) throw new Error('ReferenceTone: audioContext is required');
    /** @private */ this._ctx = audioContext;
    /** @private */ this._amplitude = amplitude;
    /** @private */ this._fadeInMs = fadeInMs;
    /** @private */ this._fadeOutMs = fadeOutMs;

    /** @private @type {OscillatorNode|null} */ this._osc = null;
    /** @private @type {GainNode|null} */ this._gain = null;
    /** @private */ this._playing = false;
    /** @private @type {number|null} */ this._frequency = null;
  }

  /**
   * Starts (or retargets, if already playing) a sine at `frequency`.
   * Fresh start: gain ramps 0 -> amplitude over fadeInMs via a raised-cosine curve.
   * Already playing: oscillator.frequency.setTargetAtTime(frequency, now, 0.02).
   * @param {number} frequency Hz
   */
  play(frequency) {
    const ctx = this._ctx;
    const now = ctx.currentTime;

    if (this._playing && this._osc) {
      // Retarget the running oscillator smoothly.
      this._osc.frequency.setTargetAtTime(frequency, now, 0.02);
      this._frequency = frequency;
      return;
    }

    // Fresh start: build oscillator -> gain -> destination.
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(frequency, now);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);

    osc.connect(gain);
    gain.connect(ctx.destination);

    // Raised-cosine fade-in 0 -> amplitude over fadeInMs.
    const fadeIn = Math.max(0.0005, this._fadeInMs / 1000);
    const curve = raisedCosineCurve(this._amplitude, true);
    gain.gain.setValueCurveAtTime(curve, now, fadeIn);

    osc.start(now);

    this._osc = osc;
    this._gain = gain;
    this._frequency = frequency;
    this._playing = true;
  }

  /**
   * Raised-cosine fade to 0 over fadeOutMs, then oscillator.stop() scheduled after
   * the fade. Idempotent.
   */
  stop() {
    if (!this._playing || !this._osc || !this._gain) return;

    const ctx = this._ctx;
    const now = ctx.currentTime;
    const osc = this._osc;
    const gain = this._gain;

    const fadeOut = Math.max(0.0005, this._fadeOutMs / 1000);

    // Clear any pending automation (e.g. an in-flight fade-in) so the fade-out
    // curve can be scheduled without overlap, then fall from amplitude -> 0.
    // Start the fall from the CURRENT gain (not always the peak), so stopping
    // mid fade-in doesn't jump up to amplitude first and click.
    const startVal = Math.max(0, Math.min(this._amplitude, gain.gain.value || this._amplitude));
    try {
      gain.gain.cancelScheduledValues(now);
      const curve = raisedCosineCurve(startVal, false);
      gain.gain.setValueCurveAtTime(curve, now, fadeOut);
    } catch (_) {
      // Fallback if the curve schedule is rejected for any reason.
      try { gain.gain.setValueAtTime(gain.gain.value, now); } catch (_2) { /* ignore */ }
      gain.gain.linearRampToValueAtTime(0, now + fadeOut);
    }

    // Stop the oscillator just after the fade completes, then tear down the graph.
    const stopAt = now + fadeOut;
    osc.onended = () => {
      try { osc.disconnect(); } catch (_) { /* ignore */ }
      try { gain.disconnect(); } catch (_) { /* ignore */ }
    };
    try { osc.stop(stopAt); } catch (_) { /* already stopped */ }

    this._osc = null;
    this._gain = null;
    this._playing = false;
    this._frequency = null;
  }

  /** @returns {boolean} */
  get isPlaying() {
    return this._playing;
  }

  /** @returns {number|null} current frequency or null */
  get frequency() {
    return this._frequency;
  }
}
