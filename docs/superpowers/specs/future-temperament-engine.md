# Future spec — Temperament engine + per-string cent offsets

**Status:** Deferred (designed, not scheduled). Extracted from the 2026-07-09 tuner feature
roadmap at the user's request ("skip temperament, document for later"). Promote to an active
spec + implementation plan when picked up.

## Goal

Make target pitches flexible beyond hardcoded 12-tone equal temperament: alternate
temperaments (just, historical/well), user-editable per-string cent offsets, and sweetened
(Buzz-Feiten-style) presets — genuine pro/intonation features consumer tuners rarely offer.

## Why it was deferred cleanly

Capo/transpose and A4 calibration (built in roadmap Package C) do **not** need this work:
capo is a pure MIDI shift and calibration is range/precision only. Temperament + per-string
offsets are the *only* features that require threading a precomputed **targets array**
through the Stabilizer, so deferring them keeps Package C small and low-risk. This doc
captures that threading design for later.

## Design

### The single choke point
Every target today is `frequencyFromMidi(midi, a4)` inside the Stabilizer and
`nearestString` / `noteFromFrequency`. The temperament work precomputes a **targets array**
(one Hz value per string) at engine-build / `setTuning` time and threads it through the
Stabilizer instead of recomputing from MIDI inline.

### `js/music/temperament.js` (pure, Node-tested)
A temperament is a function `centsOffset(pitchClass, rootPitchClass) → cents` giving
deviation from 12-TET. Ship:
- **Equal (12-TET)** — default, returns 0 everywhere (fully backward compatible).
- **Just intonation (major)** — relative to a chosen root.
- **Werckmeister III** — one historical well temperament, relative to root.

Plus **per-string cent offsets** (advanced) and a **"Sweetened (electric guitar)"** preset
that is really a per-string offset set. Non-equal temperaments require a **root/key
selector** (defaults to the tuning's lowest note's pitch class).

### Tuning model extension
`Tuning` gains optional `centOffsets: number[]` (fractional cents, per string).
`validateTuningStrings` is relaxed to carry offsets. Target for string *i* =
`frequencyFromMidi(midi_i + capo, a4) * 2^((temperamentCents(pc_i, root) + centOffsets_i) / 1200)`.

### Stabilizer threading
`setTuning` accepts the precomputed targets (or the params to compute them);
`_resolveReference`, the octave-snap candidate scan, and `refFreq` / `rawCents` use target Hz
rather than `frequencyFromMidi(ref.midi, a4)`. Chromatic mode (tuning = null) stays 12-TET
(temperament needs a key; chromatic has none).

**Audit:** octave-snap thresholds (`targetSnapCents`, the 150c history window) and cents
display rounding against fractional targets.

### UI
Temperament, root, and per-string offsets live behind an "Advanced" disclosure so the
default surface stays one-tap 12-TET.

## Tests
- `test-temperament`: known-value checks (JI major third ≈ −13.7c; Werckmeister fifths).
- Extend `test-stabilizer`: **exact-equality regression** — with temperament=Equal, capo=0,
  offsets=0 the Stabilizer output must equal the pre-temperament implementation byte-for-byte.
  Then octave-snap correct with a −5c per-string offset.

## Risks
- Fractional targets ripple into octave-snap heuristics → the Equal/capo0/offset0 fast-path
  must equal current output exactly; targeted offset tests around the snap window.
- Keep the default simple: advanced disclosure only.

## Dependencies / sequencing when resumed
- Builds on roadmap Package B (instrument registry) and Package C (capo shift feeds the
  `midi_i + capo` term). Slots after the roadmap, or between C and D if reprioritised.
