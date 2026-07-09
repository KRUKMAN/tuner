// BROWSER ONLY. Look-ahead scheduler ("A Tale of Two Clocks") + click synth.
// A setTimeout pump schedules every click whose sample-clock time falls within a
// short look-ahead window; beats are NEVER driven by setInterval/setTimeout timing.
// Absolute times accumulate in seconds from a fixed bar start (never += a rounded
// interval) → no drift. Each click is one short raised-cosine-shaped oscillator
// burst routed through the shared master gain bus; every node disconnect()s on end.
import { CONFIG } from '../config.js';
import { expandBar } from '../music/meter.js';
import { raisedCosineCurve } from './tone.js';

export class Metronome {
  /**
   * @param {Object} opts
   * @param {AudioContext} opts.audioContext  Shared context (created on a gesture).
   * @param {AudioNode} [opts.destination]    Master gain bus; defaults to ctx.destination.
   * @param {object} [opts.config]            CONFIG.metronome (injectable for tests).
   */
  constructor({ audioContext, destination, config = CONFIG.metronome } = {}) {
    if (!audioContext) throw new Error('Metronome: audioContext is required');
    /** @private */ this._ctx = audioContext;
    /** @private */ this._dest = destination || audioContext.destination;
    /** @private */ this._cfg = config;
    /** @private */ this._bpm = config.bpmDefault;
    /** @private @type {Array} */ this._bar = [];
    /** @private @type {Array|null} */ this._pendingBar = null;
    /** @private */ this._running = false;
    /** @private */ this._timer = null;
    /** @private @type {GainNode|null} */ this._master = null;

    // scheduling state
    /** @private */ this._events = [];
    /** @private */ this._evIdx = 0;
    /** @private */ this._barStartTime = 0;   // absolute ctx seconds of current bar's beat 0
    /** @private */ this._beatDur = config.bpmDefault > 0 ? 60 / config.bpmDefault : 0.5;
    /** @private */ this._barDurSec = 0;
    /** @private @type {{time:number, beatIndex:number}[]} */ this._beatQueue = [];
  }

  /** @param {number} bpm @returns {number} clamped, rounded bpm */
  setBpm(bpm) {
    const { bpmMin, bpmMax } = this._cfg;
    const n = Math.round(Number(bpm));
    this._bpm = Math.max(bpmMin, Math.min(bpmMax, Number.isFinite(n) ? n : bpmMin));
    return this._bpm;
  }

  /** @returns {number} */
  get bpm() { return this._bpm; }

  /** @returns {boolean} */
  get isRunning() { return this._running; }

  /**
   * Set the meter. While running it is staged and applied at the next bar boundary
   * (in _loadBar); while stopped it applies immediately.
   * @param {Array} bar
   */
  setBar(bar) {
    if (this._running) this._pendingBar = bar;
    else { this._bar = bar; this._pendingBar = null; }
  }

  start() {
    if (this._running) return;
    const ctx = this._ctx;
    if (!this._master) {
      this._master = ctx.createGain();
      this._master.gain.value = this._cfg.gain;
      this._master.connect(this._dest);
    }
    this._loadBar();                                   // expand current bar at current bpm
    this._evIdx = 0;
    this._beatQueue = [];
    this._barStartTime = ctx.currentTime + this._cfg.scheduleAheadSec; // brief lead-in
    this._running = true;
    this._pump();
  }

  stop() {
    this._running = false;
    if (this._timer != null) { clearTimeout(this._timer); this._timer = null; }
    this._beatQueue = [];
    // scheduled oscillators self-tear-down on ended; nothing else to release.
  }

  /**
   * Beat index whose scheduled time has now passed (for the UI highlight). Drains
   * past-due queue entries and returns the most recent one, or -1.
   * @param {number} nowSec  ctx.currentTime
   * @returns {number}
   */
  pollBeat(nowSec) {
    let bi = -1;
    while (this._beatQueue.length && this._beatQueue[0].time <= nowSec) {
      bi = this._beatQueue.shift().beatIndex;
    }
    return bi;
  }

  /** @private Apply any staged meter + current bpm, then (re)expand the bar. */
  _loadBar() {
    if (this._pendingBar) { this._bar = this._pendingBar; this._pendingBar = null; }
    this._events = expandBar(this._bar, this._bpm);
    this._beatDur = this._bpm > 0 ? 60 / this._bpm : 0.5;
    this._barDurSec = (this._bar ? this._bar.length : 0) * this._beatDur;
  }

  /** @private The pump: schedule every click within the look-ahead window, then re-arm. */
  _pump() {
    const cfg = this._cfg;
    const ctx = this._ctx;
    let guard = 0;
    while (this._running && guard++ < 10000) {
      const horizon = ctx.currentTime + cfg.scheduleAheadSec;
      if (this._evIdx < this._events.length) {
        const ev = this._events[this._evIdx];
        const when = this._barStartTime + ev.timeOffsetSec;
        if (when >= horizon) break;
        this._scheduleClick(when, ev.level);
        if (ev.level !== 'sub') {                       // beat-first click → highlightable beat
          this._beatQueue.push({ time: when, beatIndex: Math.round(ev.timeOffsetSec / this._beatDur) });
        }
        this._evIdx++;
      } else {
        // bar boundary — advance by the EXACT bar duration (no rounding → no drift),
        // then apply live meter/bpm edits. Handles all-rest bars (no events) too.
        const barEnd = this._barStartTime + this._barDurSec;
        if (this._barDurSec <= 0 || barEnd >= horizon) break;
        this._barStartTime = barEnd;
        this._evIdx = 0;
        this._loadBar();
      }
    }
    if (this._running) this._timer = setTimeout(() => this._pump(), cfg.lookaheadMs);
  }

  /**
   * @private One click: oscillator burst with a raised-cosine attack+release, routed
   * through the master gain. Disconnects both nodes on `ended` so long sessions don't
   * leak nodes.
   * @param {number} when  absolute ctx time
   * @param {'accent'|'normal'|'ghost'|'sub'} level
   */
  _scheduleClick(when, level) {
    const cfg = this._cfg;
    const ctx = this._ctx;
    const voice = cfg.levels[level] || cfg.levels.normal;

    const attack = Math.max(0.0005, cfg.clickAttackMs / 1000);
    const total = Math.max(attack + 0.001, cfg.clickMs / 1000);

    const osc = ctx.createOscillator();
    osc.type = cfg.clickType;
    osc.frequency.setValueAtTime(voice.freq, when);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, when);
    gain.gain.setValueCurveAtTime(raisedCosineCurve(voice.gain, true), when, attack);
    gain.gain.setValueCurveAtTime(raisedCosineCurve(voice.gain, false), when + attack, total - attack);

    osc.connect(gain);
    gain.connect(this._master);

    osc.onended = () => {
      try { osc.disconnect(); } catch (_) { /* ignore */ }
      try { gain.disconnect(); } catch (_) { /* ignore */ }
    };
    osc.start(when);
    osc.stop(when + total);
  }
}
