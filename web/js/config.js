// PURE. Single source of truth for every numeric parameter.
// Deep-frozen config objects; modules take a config in their constructor and
// never read globals. Values are the Section 4 "Frozen Defaults" table exactly.

/**
 * @typedef {Object} ModeConfig
 * @property {number} windowSize       Analysis window in samples (power of two).
 * @property {number} fMin             Lowest detectable Hz.
 * @property {number} fMax             Highest detectable Hz.
 * @property {number|null} hpfHz       Pre-filter high-pass cutoff, null = no HPF (bass).
 * @property {number} lpfHz            Pre-filter low-pass cutoff.
 */

/**
 * @typedef {Object} TunerConfig
 * @property {number} k                    MPM key-maxima relative threshold (0.93).
 * @property {number} clarityThreshold     Minimum clarity to accept a frame (0.90).
 * @property {number} gateOpenDb           RMS gate open threshold, dBFS (-45).
 * @property {number} gateCloseDb          RMS gate close threshold, dBFS (-55).
 * @property {number} gateReleaseMs        Gate close delay after level drops (400).
 * @property {number} medianWindow         Median filter length on cents (5).
 * @property {number} oneEuroFcMin         (1.0)
 * @property {number} oneEuroBeta          (0.007)
 * @property {number} oneEuroDCutoff       (1.0)
 * @property {number} noteSwitchFrames     Consistent frames before displayed note switches (3).
 * @property {number} noteDeadBandCents    Dead-band beyond +/-50c before switching note (60).
 * @property {number} holdMs               Hold last good reading on dropout (400).
 * @property {number} inTuneCents          In-tune indicator threshold (5).
 * @property {number} octaveCheckCents     Max cents deviation for f/2 or f/3 to match history (40).
 * @property {number} a4Default            440
 * @property {number} a4Min                430
 * @property {number} a4Max                450
 * @property {Object.<'guitar'|'bass', ModeConfig>} modes
 */

/**
 * Recursively freeze an object and all of its (object) properties.
 * @template T
 * @param {T} obj
 * @returns {T}
 */
function deepFreeze(obj) {
  if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    for (const key of Object.keys(obj)) {
      deepFreeze(obj[key]);
    }
  }
  return obj;
}

/** @type {TunerConfig} */
export const CONFIG = deepFreeze({
  k: 0.93,
  clarityThreshold: 0.80,   // v2: catch buzzy/weak/inharmonic (bass) notes; harmonicity+snap guard them
  gateOpenDb: -45,          // legacy fixed gate (used when adaptiveGate === false)
  gateCloseDb: -55,
  gateReleaseMs: 400,
  medianWindow: 5,
  oneEuroFcMin: 0.3,            // smoothing at REST. Lowered from 1.0: on a real held note this
                                 // halves needle motion (0.38 -> 0.19 deg/frame mean, 4.35 -> 2.12
                                 // max) for ~0.6 cents of extra lag while a peg is actually turning,
                                 // which is nothing against the tens of cents you move it. beta keeps
                                 // it responsive when the pitch IS moving -- that is the whole point
                                 // of the one-euro filter. A display-side ease inside the in-tune band
                                 // was tried first and REJECTED: any curve continuous at the band edge
                                 // must have slope > 1 somewhere, so it amplified jitter exactly where
                                 // the needle sits (max/frame got worse, 4.35 -> 5.67 deg).
  oneEuroBeta: 0.007,
  oneEuroDCutoff: 1.0,
  noteSwitchFrames: 3,
  noteDeadBandCents: 60,
  holdMs: 800,                   // hold the last good reading through a dropout. Raised from
                                 // 400: on real recordings this alone lifts on-screen tracking
                                 // several points with zero wrong-note or wild frames, and it is
                                 // what stops the readout blinking out mid-decay. Not raised
                                 // further (1200 tracks better still) because a stale note would
                                 // linger over a second after you stop playing.
  inTuneCents: 5,
  centsReadoutDeadband: 0.4,     // hysteresis on the INTEGER cents readout only (not the
                                 // needle, which is already smooth: ~0.2 deg/frame). A
                                 // decaying string's pitch genuinely drifts, so rounding
                                 // every frame made the last digit churn ~5x/sec while the
                                 // dial sat still — read as "jittery when you try to be
                                 // precise". The new integer must clear the midpoint by
                                 // this much before it is accepted.
  octaveCheckCents: 40,
  a4Default: 440,
  a4Min: 430,
  a4Max: 450,

  // --- v2: adaptive noise gate -----------------------------------------
  adaptiveGate: true,            // false = legacy fixed -45/-55 behavior
  noiseFloorInitDb: -70,         // floor estimate before any audio seen
  noiseFloorMinDb: -90,          // clamp: quietest floor we ever assume
  noiseFloorMaxDb: -35,          // clamp: loudest floor (defensive)
  noiseFloorRiseDbPerSec: 3,     // upward drift rate of the floor estimate
  noiseFloorRiseClarityMax: 0.6, // floor may only rise on frames below this clarity
  gateOpenAboveFloorDb: 14,      // gate opens at floor + 14 dB
  gateHysteresisDb: 8,           // gate closes at (open - 8) dB
  gateOpenDbMin: -60,            // clamp on computed open threshold (quiet rooms)
  gateOpenDbMax: -35,            //   "        "        "         (loud rooms)

  // --- v2: smarter clarity / onset -------------------------------------
  claritySustain: 0.55,          // relaxed threshold once a note is LOCKED (decaying strings).
                                 // Acquisition still needs clarityThreshold (0.80), so relaxing
                                 // this cannot make noise false-lock -- verified against real
                                 // cafe/cathedral/AC recordings: 0 active frames at any value.
                                 // What it buys is tracking a note further into its decay, which
                                 // is what makes a phone tuner feel like it "holds on" longer.
  sustainLockMs: 250,            // ref must be stable this long before relaxing
  attackConfirmFrames: 3,        // median samples required before ANY display. Must be >= 3:
                                 // median() of 1-2 samples cannot reject an outlier (of 2 it
                                 // is just their mean), so a pluck's broadband attack transient
                                 // -- or a frame or two of quasi-periodic room noise -- would
                                 // otherwise be shown as a full-confidence wrong note.
  octaveSanityCents: 150,        // history-vs-reading gap that triggers the octave sanity check

  // --- v2: confidence (0..1) -------------------------------------------
  confidenceClarityLo: 0.75,     // clarity mapping: 0.75 -> 0
  confidenceClarityHi: 0.97,     //                  0.97 -> 1
  confidenceLevelRangeDb: 20,    // level mapping: closeDb -> 0, closeDb+20 -> 1
  confidenceDecayMs: 200,        // exp decay time constant during hold
  confidenceHarmLo: 0.50,        // harmonicity -> confidence: 0.50 -> 0
  confidenceHarmHi: 0.90,        //                            0.90 -> 1

  // --- v2: buzz / timbre robustness ------------------------------------
  detectLpfHarmonics: 5,         // detection LPF = maxTargetFundamental * this
  detectLpfMinHz: 500,           // floor so high strings keep enough harmonics
  harmonicityMin: 0.55,          // reject frames below this (broadband buzz/noise)
  targetSnapCents: 100,          // tuning-mode octave snap: how close a candidate octave of
                                 // the reading must land to a target string. Must exceed how
                                 // far out of tune a string can be WHILE YOU TUNE IT: a bass
                                 // G2 read at its 2nd harmonic only snaps back if half of it
                                 // still lands inside this window. Safe to widen only because
                                 // of snapImproveCents below.
  snapGuardCents: 50,            // only octave-snap a reading this far from EVERY string.
                                 // Within it the reading IS that string, merely out of
                                 // tune — relabeling would map a slightly-sharp B3 onto
                                 // E2, since B3 sits a near-exact twelfth (x3) above E2.
  snapImproveCents: 150,         // ...and only if the snap IMPROVES the fit by more than this.
                                 // A true octave error improves by ~1100 cents; a B3 that is
                                 // merely 60 cents sharp improves by 2 (its f/3 sits 58 cents
                                 // from E2). Without this margin, a window wide enough to
                                 // rescue a badly-flat string's 2nd harmonic also relabels
                                 // every sharp top string. 150 is the ceiling: the genuine
                                 // "A1 detected as A2" rescue improves by exactly 200.

  // --- Package D: master gain bus -------------------------------------------
  masterGain: 0.9,                // master bus gain (headroom so tone + chime can't clip)

  // --- Package D: strobe display ---------------------------------------------
  strobeVelocityScale: 1.2,       // px/sec phase drift per cent of mistuning, outside the dead-band
  strobeStripeCount: 12,          // stripes across the band at rest
  strobeBandHeightFrac: 0.22,     // stripe band height as a fraction of the canvas size
  displayModeDefault: 'dial',     // 'dial' | 'strobe'

  // --- Package D: in-tune feedback (haptic / dial snap / chime) --------------
  inTuneFeedbackDebounceMs: 80,   // ds.inTune must hold this long before feedback fires
  hapticVibrateMs: 30,
  hapticDefaultOn: true,
  chimeDefaultOn: false,
  chimeFrequencyHz: 1046.5,       // C6 — soft, distinct from any tuning target
  chimeGain: 0.18,                // peak linear gain of the chime envelope
  chimeAttackMs: 15,
  chimeReleaseMs: 220,

  modes: {
    guitar: {
      windowSize: 2048,
      fMin: 60,
      fMax: 1200,
      hpfHz: 65,
      lpfHz: 1300,
    },
    bass: {
      windowSize: 4096,
      fMin: 25,
      fMax: 500,
      hpfHz: null,
      lpfHz: 1000,
    },
  },

  // --- Package E: metronome ------------------------------------------------
  // Every metronome numeric parameter lives here (spec §1.3, §7.5). No inline
  // literals in meter.js / metronome.js / metronome-view.js.
  metronome: {
    bpmMin: 30,
    bpmMax: 300,
    bpmDefault: 120,
    beatCountMin: 1,             // a bar is an array of beats; 1..16 beats
    beatCountMax: 16,
    subdivisions: [1, 2, 3, 4],  // clicks per beat; first = beat accent, rest = 'sub'

    // tap tempo (pure helper meter.tapTempoBpm)
    tapResetMs: 2000,            // a gap longer than this starts a fresh tap set
    tapMaxTaps: 4,              // average at most the last N taps

    // look-ahead scheduler ("A Tale of Two Clocks"). scheduleAheadSec MUST exceed
    // lookaheadMs/1000 (guarded in test-config) so no click slips between pumps.
    lookaheadMs: 25,            // setTimeout pump period
    scheduleAheadSec: 0.1,      // schedule any click within this window of ctx.currentTime
    maxEventsPerPump: 10000,    // runaway-loop guard: hard cap on iterations per pump pass

    // click synth (one short oscillator burst per click, raised-cosine shaped).
    // sine is weak on phone speakers → triangle default.
    clickType: 'triangle',
    clickMs: 30,               // total burst length (attack + release)
    clickAttackMs: 2,          // raised-cosine rise before the fall

    // per-accent-level voice: oscillator freq (Hz) + peak gain (0..1).
    // accent loudest/brightest, ghost quietest, 'sub' = subdivision filler click.
    levels: {
      accent: { freq: 2000, gain: 1.0 },
      normal: { freq: 1000, gain: 0.6 },
      ghost:  { freq: 1000, gain: 0.25 },
      sub:    { freq: 1500, gain: 0.4 },
    },

    gain: 0.9,                 // metronome master gain into the shared bus
  },
});
