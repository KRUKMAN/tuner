// PURE. Turns noisy PitchFrames into a rock-steady DisplayState. Node-safe.
// Owns the full smoothing chain; timestamps are injected (never Date/performance).
// v2: adaptive noise-floor gate, dual clarity threshold + onset confirmation,
// target-aware octave snap, harmonicity gate, and a confidence (0..1) field that
// drives UI opacity. The Stabilizer remains the ONLY numeric smoother.

import {
  noteFromFrequency,
  centsBetween,
  frequencyFromMidi,
  nearestString,
  midiToName,
} from '../music/theory.js';
import { OneEuroFilter } from './one-euro.js';

/** @typedef {import('./mpm.js').PitchFrame} PitchFrame */

/**
 * What the stabilizer emits to the UI every frame. UI renders this and nothing else.
 * @typedef {Object} DisplayState
 * @property {'silent'|'rejected'|'active'|'hold'} status
 * @property {string|null} noteName   e.g. 'E', 'F#' (sharps only), null when blank.
 * @property {number|null} octave     Scientific pitch octave (A4 = 440 zone).
 * @property {number|null} midi       MIDI number of displayed note.
 * @property {number|null} cents      SMOOTHED cents offset vs. reference.
 * @property {number|null} frequency  Smoothed frequency in Hz (from smoothed cents).
 * @property {boolean} inTune         |cents| <= config.inTuneCents while active/hold.
 * @property {number|null} stringIndex Index into current tuning's strings (0 = lowest); null chromatic.
 * @property {number|null} targetMidi  MIDI of the target string when stringIndex !== null.
 * @property {number} confidence      0..1 combined clarity+level+harmonicity trust; decays in hold; 0 blank.
 * @property {number} noiseFloorDb    Adaptive noise-floor estimate (debug).
 * @property {number} rawFrequency    Last raw detector Hz (-1 if none) — debug.
 * @property {number} clarity         Last raw clarity — debug.
 * @property {number} rmsDb           Last raw RMS dBFS — debug.
 */

/** Median of an array (does not mutate input). @param {number[]} arr @returns {number} */
function median(arr) {
  const s = arr.slice().sort((a, b) => a - b);
  const n = s.length;
  const mid = n >> 1;
  return n % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }
function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

export class Stabilizer {
  /**
   * @param {Object} opts
   * @param {import('../config.js').TunerConfig} opts.config
   * @param {number} [opts.a4=440]
   * @param {number[]|null} [opts.tuning=null]
   * @param {number|null} [opts.lockedString=null]
   */
  constructor(opts) {
    this.config = opts.config;
    this.a4 = opts.a4 != null ? opts.a4 : 440;
    this.tuning = opts.tuning != null ? opts.tuning : null;
    this.lockedString = opts.lockedString != null ? opts.lockedString : null;

    const c = this.config;
    this.oneEuro = new OneEuroFilter({
      fcMin: c.oneEuroFcMin,
      beta: c.oneEuroBeta,
      dCutoff: c.oneEuroDCutoff,
    });

    this.reset();
  }

  /** Full reset (gate closed, floor + history cleared). */
  reset() {
    this.gateOpen = false;
    this.belowSince = null;

    // Adaptive noise floor.
    this.floorDb = this.config.noiseFloorInitDb != null ? this.config.noiseFloorInitDb : -70;
    this.lastFloorMs = null;

    // Consecutive accepted frames since the last streak break (onset confirmation).
    this.goodStreak = 0;

    this._resetSmoothing();

    this.lastGood = null;
    this.lastGoodMs = -Infinity;
  }

  /** Reset smoothing/reference machinery only (median, one-euro, hysteresis). */
  _resetSmoothing() {
    this.history = [];
    this.oneEuro.reset();
    this.displayedRef = null;
    this.switchKey = null;
    this.switchCount = 0;
    this._prevRefKey = null;
    this.refSinceMs = -Infinity;
    this.goodStreak = 0;
  }

  /** @param {number} a4 Clamped to [a4Min,a4Max]. */
  setA4(a4) {
    const c = this.config;
    this.a4 = clamp(a4, c.a4Min != null ? c.a4Min : 430, c.a4Max != null ? c.a4Max : 450);
    this._resetSmoothing();
    this.lastGood = null;
    this.lastGoodMs = -Infinity;
  }

  /** @param {number[]|null} midiArray null = chromatic mode. */
  setTuning(midiArray) {
    this.tuning = midiArray != null ? midiArray : null;
    if (this.tuning === null) this.lockedString = null;
    this._resetSmoothing();
    this.lastGood = null;
    this.lastGoodMs = -Infinity;
  }

  /** @param {number|null} index null = auto string select. */
  setLockedString(index) {
    this.lockedString = index != null ? index : null;
  }

  /**
   * Feed one detector frame.
   * @param {PitchFrame} frame
   * @param {number} timestampMs
   * @returns {DisplayState}
   */
  update(frame, timestampMs) {
    const c = this.config;
    const harm = frame.harmonicity != null ? frame.harmonicity : 1;

    // --- Step 0: adaptive noise-floor tracker (every frame) -------------
    if (this.lastFloorMs === null) this.lastFloorMs = timestampMs;
    const dtF = Math.max(0, (timestampMs - this.lastFloorMs) / 1000);
    this.lastFloorMs = timestampMs;
    let rms = frame.rmsDb;
    if (!isFinite(rms)) rms = c.noiseFloorMinDb;
    if (rms <= this.floorDb) {
      this.floorDb = rms; // instant attack down
    } else if (frame.clarity < c.noiseFloorRiseClarityMax || rms <= this.floorDb + 3) {
      // Only broadband / low-clarity energy may drag the floor up (and slowly).
      this.floorDb = Math.min(rms, this.floorDb + c.noiseFloorRiseDbPerSec * dtF);
    }
    this.floorDb = clamp(this.floorDb, c.noiseFloorMinDb, c.noiseFloorMaxDb);

    // --- Step 1: RMS gate with hysteresis (adaptive thresholds) --------
    let openDb, closeDb;
    if (c.adaptiveGate) {
      openDb = clamp(this.floorDb + c.gateOpenAboveFloorDb, c.gateOpenDbMin, c.gateOpenDbMax);
      closeDb = openDb - c.gateHysteresisDb;
    } else {
      openDb = c.gateOpenDb;
      closeDb = c.gateCloseDb;
    }

    if (!this.gateOpen) {
      if (frame.rmsDb >= openDb) {
        this.gateOpen = true;
        this.belowSince = null;
      }
    } else if (frame.rmsDb < closeDb) {
      if (this.belowSince === null) this.belowSince = timestampMs;
      if (timestampMs - this.belowSince >= c.gateReleaseMs) {
        this.gateOpen = false;
        this.belowSince = null;
        this._resetSmoothing();
      }
    } else {
      this.belowSince = null;
    }

    if (!this.gateOpen) {
      this.goodStreak = 0;
      return this._noFresh(frame, timestampMs, false);
    }

    // --- Step 2: clarity gate (dual threshold) + harmonicity gate ------
    const locked =
      this.displayedRef !== null &&
      timestampMs - this.refSinceMs >= c.sustainLockMs &&
      timestampMs - this.lastGoodMs <= c.holdMs;
    const clThresh = locked ? c.claritySustain : c.clarityThreshold;

    if (frame.frequency === -1 || frame.clarity < clThresh || harm < c.harmonicityMin) {
      this.goodStreak = 0;
      return this._noFresh(frame, timestampMs, true);
    }

    // --- Step 3a: target-aware octave snap (tuning mode, no history) ----
    let f = frame.frequency;
    if (this.tuning) {
      // GUARD FIRST: only octave-correct a reading that is clearly not any string.
      // If f already lands within snapGuardCents of a string, that reading IS that
      // string -- merely out of tune -- and must never be relabeled. Without this,
      // a slightly-sharp B3 gets divided by 3 onto E2 (B3 sits a near-exact perfect
      // twelfth above E2: E2*3 = 247.23 Hz vs B3 = 246.94 Hz, ~2 cents apart), so the
      // tuner confidently displays the wrong string. Same trap for E4 (x3 above A2).
      const direct = nearestString(f, this.tuning, this.a4);
      if (Math.abs(direct.cents) > c.snapGuardCents) {
        // Snap to the octave of f that lands CLOSEST to a target string. Candidates
        // are ordered low->high so ties resolve toward the fundamental (weak-
        // fundamental bass strings octave-error UP: A1 55Hz read as A2 110Hz -> we
        // pull it back to A1). The generous window lets an out-of-tune string still
        // resolve to its intended string+octave while showing how far off it is.
        const cands = [f / 3, f / 2, f, f * 2];
        let bestF = f;
        let bestAbs = Infinity;
        for (let i = 0; i < cands.length; i++) {
          const cand = cands[i];
          if (cand < 1) continue;
          const a = Math.abs(nearestString(cand, this.tuning, this.a4).cents);
          if (a < bestAbs) { bestAbs = a; bestF = cand; }
        }
        // Snap only if it is a big WIN, not a marginal one. A genuine octave error
        // improves the fit by ~1100 cents; a string that is merely 60 cents sharp
        // "improves" by 2 (a sharp B3's f/3 sits 58 cents from E2 vs 60 to B3 itself),
        // and relabeling it would be the very bug snapGuardCents exists to stop. This
        // margin is what lets targetSnapCents be wide enough to rescue a badly-flat
        // string read at its 2nd harmonic -- the common case on a bass, whose
        // fundamental is weak. Applies to every instrument: one shared code path.
        if (bestAbs <= c.targetSnapCents && Math.abs(direct.cents) - bestAbs > c.snapImproveCents) {
          f = bestF;
        }
      }
    }

    // --- Step 3b: history-based octave sanity (second line of defense) --
    // A raw reading can err either way, by an INTEGER PERIOD FACTOR:
    //   * locking onto a harmonic reads too HIGH -> correct by dividing (f/2, f/3);
    //   * locking onto a subharmonic reads too LOW -> correct by multiplying.
    // The multiply side must reach x4. Deep in a real pluck's decay (around -65 dBFS)
    // MPM lands on FOUR times the period: a ringing B3 (244 Hz) reads as 60.9 Hz, which
    // is nearest the E2 string. Without an f*4 candidate this is uncorrectable, so a few
    // such frames poison the median, the reference flips to E2, and the tuner shows
    // "E, -525 cents" — then +1857 cents — while a B is plainly ringing.
    // Measured on real recordings: adding f*4 takes the wrong-note rate from 7.8% to 0,
    // note-flips from 5 to 0, and worst displayed |cents| from 2416 to 24, while
    // RAISING the usable frame count (it recovers those frames instead of discarding
    // them) and leaving clean notes and badly-flat strings untouched. f/4 is the mirror
    // case (locking onto the 4th harmonic); it never fired on real audio, so it is
    // deliberately not included. Candidates are ordered so f itself always wins a tie.
    if (this.history.length >= 3) {
      const h = median(this.history);
      if (Math.abs(centsBetween(f, h)) > c.octaveSanityCents) {
        const candidates = [f, f / 2, f / 3, f * 2, f * 3, f * 4];
        for (let i = 0; i < candidates.length; i++) {
          if (Math.abs(centsBetween(candidates[i], h)) <= c.octaveCheckCents) {
            f = candidates[i];
            break;
          }
        }
      }
    }

    // --- Step 4: median filter on frequency -----------------------------
    this.history.push(f);
    if (this.history.length > c.medianWindow) this.history.shift();
    const medF = median(this.history);

    // --- Step 4.5: onset confirmation ------------------------------------
    // Require attackConfirmFrames CONSECUTIVE accepted frames before the first display of
    // a note. Two reasons, both found on real audio:
    //   * A real pluck's attack is broadband and non-periodic. With fewer than 3 samples
    //     the median cannot reject it (of 2 it is just their mean), so the transient
    //     surfaced as a full-confidence WRONG note for ~50 ms.
    //   * Quasi-periodic room noise (voiced speech) clears the gates in short bursts.
    //     The streak must reset on every rejected frame, or sporadic bursts would
    //     accumulate across rejects and eventually display.
    // Gate on `displayedRef`, NOT `lastGood`: `lastGood` is never cleared, so it made this
    // check apply only to the very first note ever; `displayedRef` is cleared by
    // _resetSmoothing() whenever the gate closes, so every new note is confirmed afresh.
    // Once a note IS displayed, an isolated reject must not blank it — _noFresh holds it.
    this.goodStreak++;
    if (this.displayedRef === null && this.goodStreak < c.attackConfirmFrames) {
      return this._noFresh(frame, timestampMs, true);
    }

    // --- Step 5 + 7: reference selection with note-name hysteresis -------
    this._prevRefKey = this.displayedRef ? this._refKey(this.displayedRef) : null;
    this._resolveReference(medF);
    const ref = this.displayedRef;
    const refFreq = frequencyFromMidi(ref.midi, this.a4);
    const rawCents = centsBetween(medF, refFreq);

    // --- Step 6: One-Euro on CENTS (reset + reseed if reference changed) -
    const newRefKey = this._refKey(ref);
    if (newRefKey !== this._prevRefKey) {
      this.oneEuro.reset();
      this.refSinceMs = timestampMs; // start the sustain-lock timer for the new ref
    }
    const smoothCents = this.oneEuro.filter(rawCents, timestampMs);

    // --- Step 7.5: confidence -------------------------------------------
    const clarityTerm = clamp01(
      (frame.clarity - c.confidenceClarityLo) / (c.confidenceClarityHi - c.confidenceClarityLo)
    );
    const levelTerm = clamp01((frame.rmsDb - closeDb) / c.confidenceLevelRangeDb);
    const harmTerm = clamp01((harm - c.confidenceHarmLo) / (c.confidenceHarmHi - c.confidenceHarmLo));
    const confidence = clarityTerm * Math.sqrt(levelTerm) * (0.5 + 0.5 * harmTerm);

    // --- Step 8: build active DisplayState ------------------------------
    const smoothFreq = refFreq * Math.pow(2, smoothCents / 1200);
    const { name, octave } = midiToName(ref.midi);

    /** @type {DisplayState} */
    const ds = {
      status: 'active',
      noteName: name,
      octave,
      midi: ref.midi,
      cents: smoothCents,
      frequency: smoothFreq,
      inTune: Math.abs(smoothCents) <= c.inTuneCents,
      stringIndex: ref.stringIndex,
      targetMidi: ref.targetMidi,
      confidence,
      noiseFloorDb: this.floorDb,
      rawFrequency: frame.frequency,
      clarity: frame.clarity,
      rmsDb: frame.rmsDb,
    };

    this.lastGood = ds;
    this.lastGoodMs = timestampMs;
    return ds;
  }

  // --- helpers ----------------------------------------------------------

  _refKey(ref) {
    return ref.stringIndex === null ? 'n' + ref.midi : 's' + ref.stringIndex;
  }

  _resolveReference(medF) {
    const t = this.tuning;
    if (t === null) {
      const ni = noteFromFrequency(medF, this.a4);
      this._hysteresis({ midi: ni.midi, stringIndex: null, targetMidi: null }, medF);
      return;
    }

    const locked =
      this.lockedString !== null &&
      this.lockedString >= 0 &&
      this.lockedString < t.length;

    if (locked) {
      const midi = t[this.lockedString];
      this.displayedRef = { midi, stringIndex: this.lockedString, targetMidi: midi };
      this.switchKey = null;
      this.switchCount = 0;
      return;
    }

    const ns = nearestString(medF, t, this.a4);
    this._hysteresis({ midi: ns.midi, stringIndex: ns.index, targetMidi: ns.midi }, medF);
  }

  _hysteresis(candidate, medF) {
    const c = this.config;

    if (this.displayedRef === null) {
      this.displayedRef = candidate;
      this.switchKey = null;
      this.switchCount = 0;
      return;
    }

    const candKey = this._refKey(candidate);
    const dispKey = this._refKey(this.displayedRef);

    if (candKey === dispKey) {
      this.switchKey = null;
      this.switchCount = 0;
      return;
    }

    const dispRefFreq = frequencyFromMidi(this.displayedRef.midi, this.a4);
    const centsVsDisplayed = centsBetween(medF, dispRefFreq);
    if (Math.abs(centsVsDisplayed) > c.noteDeadBandCents) {
      if (this.switchKey === candKey) {
        this.switchCount++;
      } else {
        this.switchKey = candKey;
        this.switchCount = 1;
      }
      if (this.switchCount >= c.noteSwitchFrames) {
        this.displayedRef = candidate;
        this.switchKey = null;
        this.switchCount = 0;
      }
    } else {
      this.switchKey = null;
      this.switchCount = 0;
    }
  }

  /**
   * No fresh accepted reading: hold last good within holdMs (confidence decays),
   * else blank. Does NOT touch goodStreak (callers manage streak breaks).
   * @param {PitchFrame} frame @param {number} timestampMs @param {boolean} gateOpen
   * @returns {DisplayState}
   */
  _noFresh(frame, timestampMs, gateOpen) {
    const c = this.config;
    if (this.lastGood !== null && timestampMs - this.lastGoodMs <= c.holdMs) {
      const heldConf =
        this.lastGood.confidence * Math.exp(-(timestampMs - this.lastGoodMs) / c.confidenceDecayMs);
      return {
        status: 'hold',
        noteName: this.lastGood.noteName,
        octave: this.lastGood.octave,
        midi: this.lastGood.midi,
        cents: this.lastGood.cents,
        frequency: this.lastGood.frequency,
        inTune: this.lastGood.inTune,
        stringIndex: this.lastGood.stringIndex,
        targetMidi: this.lastGood.targetMidi,
        confidence: heldConf,
        noiseFloorDb: this.floorDb,
        rawFrequency: frame.frequency,
        clarity: frame.clarity,
        rmsDb: frame.rmsDb,
      };
    }
    return this._blank(gateOpen ? 'rejected' : 'silent', frame);
  }

  _blank(status, frame) {
    return {
      status,
      noteName: null,
      octave: null,
      midi: null,
      cents: null,
      frequency: null,
      inTune: false,
      stringIndex: null,
      targetMidi: null,
      confidence: 0,
      noiseFloorDb: this.floorDb,
      rawFrequency: frame.frequency,
      clarity: frame.clarity,
      rmsDb: frame.rmsDb,
    };
  }
}
