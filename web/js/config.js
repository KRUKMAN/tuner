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
  oneEuroFcMin: 1.0,
  oneEuroBeta: 0.007,
  oneEuroDCutoff: 1.0,
  noteSwitchFrames: 3,
  noteDeadBandCents: 60,
  holdMs: 400,
  inTuneCents: 5,
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
  claritySustain: 0.68,          // relaxed threshold once a note is locked (decaying bass strings)
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
  targetSnapCents: 45,           // tuning-mode octave snap window to a target string
  snapGuardCents: 50,            // only octave-snap a reading this far from EVERY string.
                                 // Within it the reading IS that string, merely out of
                                 // tune — relabeling would map a slightly-sharp B3 onto
                                 // E2, since B3 sits a near-exact twelfth (x3) above E2.

  // --- Package D: master gain bus -------------------------------------------
  masterGain: 0.9,                // master bus gain (headroom so tone + chime can't clip)

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
});
