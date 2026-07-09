# Package B — Instrument registry + custom-tuning fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded `'guitar'|'bass'` union with a data-driven instrument registry so instruments become table rows; add ukulele (reentrant + low-G), mandolin, violin, banjo, and baritone guitar as tuning presets; turn the two-button instrument segmented control into a scrollable chip row rendered from the registry; and repair the custom-tuning editor's real defects (misclassification, dead edit-in-place, fixed 4–7 string count, no note picker, focus-destroying re-render).

**Architecture:** A new pure `js/music/instruments.js` holds a frozen `INSTRUMENTS` registry (`{id,label,defaultTuningId,order}`) plus two tiny lookup helpers. `tunings.js` gains six presets tagged with their new instrument ids (stored strictly ascending — reentrant instruments are flattened to pitch order, a documented simplification). The **DSP profile is still frequency-derived** by the existing `engineModeFor()` (lowest string < 70 Hz → bass engine), so new instruments need only a registry row + presets — no `CONFIG.modes` change. `app.js` drops its `DEFAULT_TUNING` map for `defaultTuningIdFor()` and forwards an `instrument` argument through `saveCustom → makeCustomTuning`. `controls.js` renders the instrument chip row from the registry and rebuilds the custom editor so the name input survives per-string edits, wires the previously-dead `_editId` for edit-in-place, offers a 1–8 string stepper, and adds a note+octave picker per string.

**Tech Stack:** Vanilla ES modules (no build step), the repo's zero-dependency Node test harness (`web/test/assert.js` + `run-all.js`), Service Worker + Cache API (precache list discipline).

## Global Constraints

- **No build step.** Static ES modules served as-is. No bundler, no transpile, no npm runtime deps. New code is hand-authored ESM. (verbatim from spec §1.1)
- **Pure vs. browser module split.** `js/config.js`, `js/music/*`, and `js/dsp/*` are pure and Node-safe (no `window`, `document`, `AudioContext`, `performance`, `Date`). They are unit-tested in Node via `web/test/run-all.js`. Only `js/audio/*`, `js/ui/*`, and `js/app.js` touch browser APIs. **`js/music/instruments.js` must stay pure and Node-testable.** (spec §1.2)
- **`CONFIG` is the single source of truth**, deep-frozen. All new numeric parameters go into `CONFIG`, never inline literals or globals. Package B adds no new numeric config — instruments/tunings are data, not tuner parameters. (spec §1.3)
- **localStorage access is always wrapped in try/catch** and tolerant of absence. (spec §1.7)
- **Cache-list discipline:** `CORE_ASSETS` in `sw.js` is hand-maintained; **any file added MUST be added to it AND `CACHE` bumped per released package** (`'tuner-cache-v2'` → `'tuner-cache-v3'`). `test-sw-assets` enforces coverage over every shipped `.html .css .js .webmanifest .woff2 .png .svg .ico .json` file (excluding `web/test/`, `sw.js`, `package.json`). (spec §3, spec §11)
- **Reentrant pitch-order simplification (spec §4.1):** the tuning model orders strings low→high by pitch (index 0 = lowest). Reentrant instruments (ukulele high-G, banjo 5th drone) are stored in **pitch order**, not physical string order. Physical string-layout labelling is a known, documented simplification — acceptable for a tuner, not solved this round.
- Test harness idiom: each suite file default-exports a `run()` that calls `suite(name, fn)` + `assert`/`assertClose`, and is registered in `web/test/run-all.js`. Full suite is `node web/test/run-all.js` (exit 1 on any failure).
- **Shared-file discipline (B is integrated first; D, E, F layer on top):** each shared file is touched by exactly the tasks noted below and nowhere else — `app.js` → Task 3 only; `index.html` → Task 4 only; `sw.js` → Task 2 only; `controls.js` → Tasks 4 (chips) + 5 (editor), non-overlapping regions; `styles.css` → Tasks 4 (chips) + 5 (editor), distinct appended blocks.

---

## File Structure

- `web/js/music/instruments.js` **(new)** — pure `INSTRUMENTS` registry + `instrumentById`/`defaultTuningIdFor`; Node-safe.
- `web/test/test-instruments.js` **(new)** — registry integrity, `defaultTuningId` resolution, `makeCustomTuning` instrument-override, clamp ceiling.
- `web/js/music/tunings.js` **(modify)** — six new presets (ukulele ×2, mandolin, violin, banjo, baritone); widen `instrument` typedef to `string`.
- `web/test/test-theory.js` **(modify)** — new suite asserting the six presets' note math + ascending storage.
- `web/test/run-all.js` **(modify)** — register `test-instruments`.
- `web/js/app.js` **(modify)** — import `defaultTuningIdFor`; drop `DEFAULT_TUNING`; `saveCustom` forwards `instrument`.
- `web/js/ui/controls.js` **(modify)** — instrument chip row from registry (Task 4); custom-editor rebuild + edit-in-place + 1–8 stepper + note picker (Task 5).
- `web/index.html` **(modify)** — replace the two-button `.seg` with an empty `.chip-row` container.
- `web/css/styles.css` **(modify)** — `.chip-row`/`.chip` (Task 4); editor note picker + count stepper + `.tuning-edit` (Task 5).
- `web/sw.js` **(modify)** — add `./js/music/instruments.js` to `CORE_ASSETS`; bump `CACHE` `v2`→`v3`.

**Verified MIDI table (a4=440; all strictly ascending, index 0 = lowest):**

| Tuning id | Strings (MIDI) | Notes | low Hz → engine | high Hz | fits clamp≤76 / fMax<1200 |
|---|---|---|---|---|---|
| `ukulele-standard` (reentrant) | `60,64,67,69` | C4 E4 G4 A4 (physical gCEA) | 261.63 → guitar | 440.00 | ✓ / ✓ |
| `ukulele-low-g` | `55,60,64,69` | G3 C4 E4 A4 | 196.00 → guitar | 440.00 | ✓ / ✓ |
| `mandolin-standard` | `55,62,69,76` | G3 D4 A4 E5 | 196.00 → guitar | 659.26 | ✓ (76 = ceiling) / ✓ |
| `violin-standard` | `55,62,69,76` | G3 D4 A4 E5 | 196.00 → guitar | 659.26 | ✓ (76 = ceiling) / ✓ |
| `banjo-open-g` (reentrant) | `50,55,59,62,67` | D3 G3 B3 D4 G4 (physical gDGBD) | 146.83 → guitar | 392.00 | ✓ / ✓ |
| `baritone-standard` | `35,40,45,50,54,59` | B1 E2 A2 D3 F#3 B3 | 61.74 → **bass** | 246.94 | ✓ / ✓ |

Baritone's B1 (61.74 Hz < 70) selecting the **bass** DSP engine is correct/intended (same as the existing 7-string's B1). Nothing exceeds the `validateTuningStrings` clamp of MIDI 76 or the guitar profile's `fMax` = 1200 Hz.

---

### Task 1: New instrument tuning presets (`tunings.js`) + note-math tests

**Files:**
- Modify: `web/js/music/tunings.js`
- Modify: `web/test/test-theory.js`

**Interfaces:**
- Consumes: `frequencyFromMidi` (already imported by `test-theory.js`).
- Produces: six new frozen entries in `TUNINGS` (`ukulele-standard`, `ukulele-low-g`, `mandolin-standard`, `violin-standard`, `banjo-open-g`, `baritone-standard`), each `{id, name, instrument, strings}` with a new-string `instrument` id. `tuningsFor(instrument: string)` unchanged in behaviour.

- [ ] **Step 1: Write the failing test**

In `web/test/test-theory.js`, insert a new suite immediately before the closing brace of the default `run()` export. Replace the final two lines of the file:

```js
  });
}
```

with:

```js
  });

  suite('tunings: Package B instruments', () => {
    // Ukulele standard is reentrant (physical gCEA); stored in PITCH order C4 E4 G4 A4.
    assert(TUNINGS['ukulele-standard'].strings.join(',') === '60,64,67,69', 'ukulele standard = C4 E4 G4 A4 (pitch order)');
    assert(TUNINGS['ukulele-standard'].instrument === 'ukulele', 'ukulele standard tagged instrument ukulele');
    assertClose(frequencyFromMidi(69, 440), 440, 1e-9, 'ukulele A4 string = 440 Hz');
    // Ukulele Low-G is natural (ascending) G3 C4 E4 A4.
    assert(TUNINGS['ukulele-low-g'].strings.join(',') === '55,60,64,69', 'ukulele low-G = G3 C4 E4 A4');
    // Mandolin & violin: G3 D4 A4 E5 — E5 (MIDI 76) is exactly the custom-string clamp ceiling.
    assert(TUNINGS['mandolin-standard'].strings.join(',') === '55,62,69,76', 'mandolin = G3 D4 A4 E5');
    assert(TUNINGS['violin-standard'].strings.join(',') === '55,62,69,76', 'violin = G3 D4 A4 E5');
    assertClose(frequencyFromMidi(76, 440), 659.26, 0.05, 'top string E5 ≈ 659.26 Hz (well under guitar fMax 1200)');
    // Banjo open-G, 5-string reentrant drone stored in pitch order D3 G3 B3 D4 G4.
    assert(TUNINGS['banjo-open-g'].strings.join(',') === '50,55,59,62,67', 'banjo open G = D3 G3 B3 D4 G4 (pitch order)');
    // Baritone guitar B1 E2 A2 D3 F#3 B3; lowest B1 ≈ 61.74 Hz → derives the bass DSP profile.
    assert(TUNINGS['baritone-standard'].strings.join(',') === '35,40,45,50,54,59', 'baritone = B1 E2 A2 D3 F#3 B3');
    assertClose(frequencyFromMidi(35, 440), 61.74, 0.05, 'baritone low B1 ≈ 61.74 Hz (< 70 → bass engine)');
    // Every new preset is stored strictly ascending (index 0 = lowest pitch).
    for (const id of ['ukulele-standard', 'ukulele-low-g', 'mandolin-standard', 'violin-standard', 'banjo-open-g', 'baritone-standard']) {
      const s = TUNINGS[id].strings;
      let asc = true;
      for (let i = 1; i < s.length; i++) if (s[i] <= s[i - 1]) asc = false;
      assert(asc, `${id} stored strictly ascending (pitch order)`);
    }
  });
}
```

(`suite`, `assert`, `assertClose`, `frequencyFromMidi`, and `TUNINGS` are already imported at the top of `test-theory.js` — no import change needed.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node web/test/run-all.js`
Expected: FAIL — the new `tunings: Package B instruments` suite throws (the referenced `TUNINGS['ukulele-standard']` is `undefined`, so `.strings` errors), reported as `[tunings: Package B instruments] THREW: Cannot read properties of undefined (reading 'strings')`. The summary ends `… TEST(S) FAILED`.

- [ ] **Step 3: Add the six presets**

In `web/js/music/tunings.js`, widen the `instrument` typedef. Change line 8 from:

```js
 * @property {'guitar'|'bass'} instrument
```
to:
```js
 * @property {string} instrument  registry id ('guitar','bass','ukulele','mandolin','violin','banjo','baritone')
```

Then add the six entries inside the frozen `TUNINGS` object, immediately after the `'bass-6-standard': …` line (currently the last entry, before the closing `});`):

```js
  // --- Package B: additional instruments. DSP profile is still frequency-derived
  //     by engineModeFor() in app.js — these need only a row + presets, no mode change.
  //     Reentrant instruments are stored in PITCH order (spec §4.1 simplification).
  'ukulele-standard':  { id: 'ukulele-standard',  name: 'Standard (reentrant)', instrument: 'ukulele',  strings: [60, 64, 67, 69] },         // C4 E4 G4 A4 (physical gCEA)
  'ukulele-low-g':     { id: 'ukulele-low-g',     name: 'Low G',                instrument: 'ukulele',  strings: [55, 60, 64, 69] },         // G3 C4 E4 A4
  'mandolin-standard': { id: 'mandolin-standard', name: 'Standard GDAE',        instrument: 'mandolin', strings: [55, 62, 69, 76] },         // G3 D4 A4 E5
  'violin-standard':   { id: 'violin-standard',   name: 'Standard GDAE',        instrument: 'violin',   strings: [55, 62, 69, 76] },         // G3 D4 A4 E5
  'banjo-open-g':      { id: 'banjo-open-g',      name: 'Open G (5-string)',    instrument: 'banjo',    strings: [50, 55, 59, 62, 67] },     // D3 G3 B3 D4 G4 (physical gDGBD)
  'baritone-standard': { id: 'baritone-standard', name: 'Standard B–B',         instrument: 'baritone', strings: [35, 40, 45, 50, 54, 59] }, // B1 E2 A2 D3 F#3 B3
```

Also widen the two helper param typedefs so JSDoc stays accurate. Change line 31 from:
```js
 * @param {'guitar'|'bass'} instrument
```
to:
```js
 * @param {string} instrument
```
and change (in `makeCustomTuning`'s doc block) the line:
```js
 * @param {'guitar'|'bass'} [instrument]    overrides the min-midi inference when provided
```
to:
```js
 * @param {string} [instrument]             overrides the min-midi inference when provided
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node web/test/run-all.js`
Expected: PASS — the `tunings: Package B instruments` suite prints all `PASS`, the existing `tunings: catalogue + helpers` suite still passes (`tuningsFor('guitar')` = 11, `tuningsFor('bass')` = 4 are unchanged — Package B adds no guitar/bass presets), and the summary ends `ALL TESTS PASSED`.

- [ ] **Step 5: Commit**

```bash
git add web/js/music/tunings.js web/test/test-theory.js
git commit -m "feat(tunings): add ukulele, mandolin, violin, banjo, baritone presets"
```

---

### Task 2: Instrument registry module (`instruments.js`) + tests + precache

**Files:**
- Create: `web/js/music/instruments.js`
- Create: `web/test/test-instruments.js`
- Modify: `web/test/run-all.js`
- Modify: `web/sw.js`

**Interfaces:**
- Consumes: `TUNINGS`, `makeCustomTuning`, `validateTuningStrings` from `tunings.js` (the test cross-checks against them).
- Produces: `INSTRUMENTS: ReadonlyArray<{id, label, defaultTuningId, order}>`; `instrumentById(id: string) => Instrument|undefined`; `defaultTuningIdFor(id: string) => string` (the row's `defaultTuningId`, or `'guitar-standard'` when unknown).

- [ ] **Step 1: Write the failing test + register it**

Create `web/test/test-instruments.js`:

```js
// Node. Cases for js/music/instruments.js — the pure instrument registry — and its
// contract with js/music/tunings.js (every defaultTuningId resolves; classification).
import { suite, assert, assertClose } from './assert.js';
import { INSTRUMENTS, instrumentById, defaultTuningIdFor } from '../js/music/instruments.js';
import { TUNINGS, makeCustomTuning, validateTuningStrings } from '../js/music/tunings.js';
import { frequencyFromMidi } from '../js/music/theory.js';

/** Registers and runs the instrument-registry suites. */
export default function run() {
  suite('instruments: registry integrity', () => {
    assert(Array.isArray(INSTRUMENTS) && INSTRUMENTS.length === 7, 'registry has 7 instruments');
    const ids = INSTRUMENTS.map((r) => r.id);
    assert(new Set(ids).size === ids.length, 'instrument ids are unique');
    assert(ids.join(',') === 'guitar,bass,ukulele,mandolin,violin,banjo,baritone', 'registry order');
    assert(INSTRUMENTS.every((r, i) => r.order === i), 'order is 0-based ascending, matching array position');
    assert(INSTRUMENTS.every((r) => typeof r.label === 'string' && r.label.length > 0), 'every row has a non-empty label');
    assert(Object.isFrozen(INSTRUMENTS), 'INSTRUMENTS is frozen');
  });

  suite('instruments: every defaultTuningId resolves to a matching preset', () => {
    INSTRUMENTS.forEach((r) => {
      const t = TUNINGS[r.defaultTuningId];
      assert(!!t, `${r.id} defaultTuningId '${r.defaultTuningId}' exists in TUNINGS`);
      assert(t && t.instrument === r.id, `${r.id} default tuning is tagged instrument '${r.id}'`);
    });
  });

  suite('instruments: every TUNINGS entry belongs to a registered instrument', () => {
    const known = new Set(INSTRUMENTS.map((r) => r.id));
    const orphans = Object.values(TUNINGS).filter((t) => !known.has(t.instrument)).map((t) => t.id);
    assert(orphans.length === 0, `no tuning references an unknown instrument (orphans: ${orphans.join(', ') || 'none'})`);
    INSTRUMENTS.forEach((r) => {
      const has = Object.values(TUNINGS).some((t) => t.instrument === r.id);
      assert(has, `${r.id} has at least one preset tuning`);
    });
  });

  suite('instruments: helpers', () => {
    assert(instrumentById('violin').label === 'Violin', "instrumentById('violin') → row");
    assert(instrumentById('nope') === undefined, 'instrumentById(unknown) → undefined');
    assert(defaultTuningIdFor('bass') === 'bass-4-standard', "defaultTuningIdFor('bass')");
    assert(defaultTuningIdFor('ukulele') === 'ukulele-standard', "defaultTuningIdFor('ukulele')");
    assert(defaultTuningIdFor('nope') === 'guitar-standard', 'defaultTuningIdFor(unknown) → guitar-standard fallback');
  });

  suite('instruments: makeCustomTuning honours explicit instrument (fixes misclassification)', () => {
    // A LOW custom guitar (lowest MIDI 35 < 36) would infer 'bass' — explicit instrument wins.
    const low = makeCustomTuning([35, 40, 45, 50, 54, 59], 'Low', 'c1', 'guitar');
    assert(low.instrument === 'guitar', 'low custom saved as guitar keeps guitar (not bass)');
    // Arbitrary new instrument id is honoured verbatim.
    const uke = makeCustomTuning([60, 64, 67, 69], 'Uke', 'c2', 'ukulele');
    assert(uke.instrument === 'ukulele', 'explicit ukulele honoured');
    // No instrument arg → legacy min-midi inference still applies (guitar range → guitar).
    assert(makeCustomTuning([40, 45, 50, 55, 59, 64]).instrument === 'guitar', 'no-arg inference still → guitar');
  });

  suite('instruments: preset ceiling fits the custom-string clamp', () => {
    // The highest preset pitch (mandolin/violin E5 = 76) sits exactly at the clamp ceiling.
    assert(validateTuningStrings([76])[0] === 76, 'E5 (76) is within the [21,76] clamp');
    assert(validateTuningStrings([77])[0] === 76, 'above E5 clamps down to 76');
    assert(validateTuningStrings([20])[0] === 21, 'below A0 clamps up to 21');
    assertClose(frequencyFromMidi(76, 440), 659.26, 0.05, 'E5 ceiling ≈ 659.26 Hz (< guitar fMax 1200)');
  });
}
```

Register it in `web/test/run-all.js` — add the import after `import runSwAssets from './test-sw-assets.js';`:

```js
import runInstruments from './test-instruments.js';
```

and add the call after `runSwAssets();`:

```js
runInstruments();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node web/test/run-all.js`
Expected: FAIL — the run aborts with `ERR_MODULE_NOT_FOUND` for `../js/music/instruments.js` and exit code 1 (`run-all.js` statically imports the newly-registered suite, which imports the not-yet-created module).

- [ ] **Step 3: Create the registry module**

Create `web/js/music/instruments.js`:

```js
// PURE. Instrument registry — the single data source for the instrument selector,
// default tunings, and custom-tuning classification. No browser APIs. Node-safe.
//
// The DSP profile is NOT stored here: engineModeFor() in app.js still derives
// 'guitar'|'bass' from the lowest string's frequency (< 70 Hz → bass engine), so a
// new instrument needs only a registry row + preset tunings — never a DSP change.

/**
 * @typedef {Object} Instrument
 * @property {string} id              Stable key, also stored on each Tuning.instrument.
 * @property {string} label           Display name for the selector chip.
 * @property {string} defaultTuningId TUNINGS id selected when this instrument is chosen.
 * @property {number} order           Display order (0-based).
 */

/** @type {ReadonlyArray<Instrument>} display order === array order */
export const INSTRUMENTS = Object.freeze([
  Object.freeze({ id: 'guitar',   label: 'Guitar',   defaultTuningId: 'guitar-standard',   order: 0 }),
  Object.freeze({ id: 'bass',     label: 'Bass',     defaultTuningId: 'bass-4-standard',   order: 1 }),
  Object.freeze({ id: 'ukulele',  label: 'Ukulele',  defaultTuningId: 'ukulele-standard',  order: 2 }),
  Object.freeze({ id: 'mandolin', label: 'Mandolin', defaultTuningId: 'mandolin-standard', order: 3 }),
  Object.freeze({ id: 'violin',   label: 'Violin',   defaultTuningId: 'violin-standard',   order: 4 }),
  Object.freeze({ id: 'banjo',    label: 'Banjo',    defaultTuningId: 'banjo-open-g',      order: 5 }),
  Object.freeze({ id: 'baritone', label: 'Baritone', defaultTuningId: 'baritone-standard', order: 6 }),
]);

/**
 * @param {string} id
 * @returns {Instrument|undefined}
 */
export function instrumentById(id) {
  return INSTRUMENTS.find((r) => r.id === id);
}

/**
 * @param {string} id
 * @returns {string} the instrument's default tuning id, or 'guitar-standard' if unknown.
 */
export function defaultTuningIdFor(id) {
  const r = instrumentById(id);
  return r ? r.defaultTuningId : 'guitar-standard';
}
```

- [ ] **Step 4: Run tests — registry passes, but the precache guard now bites**

Run: `node web/test/run-all.js`
Expected: the six `instruments:` suites all PASS, but the run FAILS overall on the precache guard: `sw: CORE_ASSETS covers every shipped runtime asset` reports `every shipped asset is precached (missing: ./js/music/instruments.js)`. This is `test-sw-assets` correctly catching the new shipped module that isn't yet precached. Summary ends `1 TEST(S) FAILED`.

- [ ] **Step 5: Add the module to `CORE_ASSETS` and bump `CACHE`**

In `web/js/../sw.js` (`web/sw.js`), add `./js/music/instruments.js` to the `CORE_ASSETS` array, immediately before the `'./js/music/theory.js',` line:

```js
  './js/music/instruments.js',
```

Then bump the cache version (Package B adds a shipped file, so `CACHE` must move per the cache-list discipline). Change:

```js
const CACHE = 'tuner-cache-v2';
```
to:
```js
const CACHE = 'tuner-cache-v3';
```

(Package B ships exactly one new runtime file — `instruments.js` — so this is the only `CORE_ASSETS`/`CACHE` change in the package.)

- [ ] **Step 6: Run tests to verify everything passes**

Run: `node web/test/run-all.js`
Expected: PASS — `sw: CORE_ASSETS covers every shipped runtime asset` and `sw: every listed asset exists on disk` both pass now that `instruments.js` is listed and on disk; all `instruments:` suites pass; summary ends `ALL TESTS PASSED`.

- [ ] **Step 7: Commit**

```bash
git add web/js/music/instruments.js web/test/test-instruments.js web/test/run-all.js web/sw.js
git commit -m "feat(instruments): data-driven instrument registry + precache"
```

---

### Task 3: Wire the registry into `app.js` (defaults + custom-save instrument)

**Files:**
- Modify: `web/js/app.js`

**Interfaces:**
- Consumes: `defaultTuningIdFor` from `instruments.js` (Task 2); `makeCustomTuning(midiArray, name, id, instrument)` (Task 1/existing).
- Produces: `saveCustom(midiArray, name, id, instrument)` — a 4th `instrument` parameter forwarded to `makeCustomTuning`; `changeInstrument`/`deleteCustom` resolve defaults through `defaultTuningIdFor`. This is the plumbing for the misclassification fix; `controls.js` supplies the argument in Task 5. Until then `saveCustom` receives `instrument === undefined` and falls back to the existing min-midi inference (no regression).

- [ ] **Step 1: Import the registry helper**

In `web/js/app.js`, add the import immediately after the tunings import (currently `import { TUNINGS, makeCustomTuning, validateTuningStrings } from './music/tunings.js';`):

```js
import { defaultTuningIdFor } from './music/instruments.js';
```

- [ ] **Step 2: Drop the hardcoded `DEFAULT_TUNING` map**

In `web/js/app.js`, delete this line (currently line 18):

```js
const DEFAULT_TUNING = { guitar: 'guitar-standard', bass: 'bass-4-standard' };
```

- [ ] **Step 3: Resolve instrument defaults through the registry**

In `web/js/app.js`, change `changeInstrument`, currently:

```js
function changeInstrument(instrument) {
  state.instrument = instrument;
  selectTuning(DEFAULT_TUNING[instrument]);
  controls.setInstrument(instrument);
}
```

to:

```js
function changeInstrument(instrument) {
  state.instrument = instrument;
  selectTuning(defaultTuningIdFor(instrument));
  controls.setInstrument(instrument);
}
```

Then, in `deleteCustom`, change the fallback line, currently:

```js
  if (state.tuningId === id) selectTuning(DEFAULT_TUNING[state.instrument]);
```

to:

```js
  if (state.tuningId === id) selectTuning(defaultTuningIdFor(state.instrument));
```

- [ ] **Step 4: Forward `instrument` through `saveCustom`**

In `web/js/app.js`, change `saveCustom`, currently:

```js
function saveCustom(midiArray, name, id) {
  const strings = validateTuningStrings(midiArray);
  const tid = id || 'custom-' + Date.now();
  const t = makeCustomTuning(strings, (name || 'Custom').slice(0, 24), tid);
  const i = state.customTunings.findIndex((x) => x.id === tid);
  if (i >= 0) state.customTunings[i] = t; else state.customTunings.push(t);
  saveCustoms();
  controls.setCustomTunings(state.customTunings);
  selectTuning(tid);
}
```

to:

```js
function saveCustom(midiArray, name, id, instrument) {
  const strings = validateTuningStrings(midiArray);
  const tid = id || 'custom-' + Date.now();
  const t = makeCustomTuning(strings, (name || 'Custom').slice(0, 24), tid, instrument);
  const i = state.customTunings.findIndex((x) => x.id === tid);
  if (i >= 0) state.customTunings[i] = t; else state.customTunings.push(t);
  saveCustoms();
  controls.setCustomTunings(state.customTunings);
  selectTuning(tid);
}
```

- [ ] **Step 5: Run tests (no regressions)**

Run: `node web/test/run-all.js`
Expected: PASS — `ALL TESTS PASSED`. (This task edits browser-only wiring in `app.js`, which the Node suite does not import; the pure guarantee it depends on — `makeCustomTuning` honouring an explicit `instrument` — is already proven by Task 2's `instruments: makeCustomTuning honours explicit instrument` suite.)

- [ ] **Step 6: Manual verification (no regression to the still-2-button selector)**

```bash
node serve.mjs 8173
```

At `http://localhost:8173`, open the sheet (tap the tuning label). The instrument control is still the old Guitar/Bass segmented control at this point (chips arrive in Task 4). Expected: switching Guitar⇄Bass still loads `guitar-standard`/`bass-4-standard`; saving/deleting a custom still works. No console errors. (The end-to-end misclassification fix is verified in Task 5, once the editor passes the instrument.)

- [ ] **Step 7: Commit**

```bash
git add web/js/app.js
git commit -m "fix(app): registry-driven defaults; forward instrument when saving customs"
```

---

### Task 4: Scrollable instrument chip row from the registry (`controls.js` + `index.html` + CSS)

**Files:**
- Modify: `web/index.html`
- Modify: `web/js/ui/controls.js`
- Modify: `web/css/styles.css`

**Interfaces:**
- Consumes: `INSTRUMENTS` from `instruments.js` (Task 2); `cb.onModeChange(instrument: string)` (existing callback, retyped from the `'guitar'|'bass'` union to `string`).
- Produces: `#instrumentSeg` populated with one `.chip` per registry row; `setInstrument(inst)` marks the active chip and horizontally centres it in the scroll row.

- [ ] **Step 1: Replace the two-button selector with a chip-row container**

In `web/index.html`, replace the instrument `.seg` block (currently):

```html
          <div class="seg" id="instrumentSeg">
            <button class="seg-btn is-on" data-instrument="guitar" type="button">Guitar</button>
            <button class="seg-btn" data-instrument="bass" type="button">Bass</button>
          </div>
```

with:

```html
          <div class="chip-row" id="instrumentSeg" role="tablist" aria-label="Instrument"><!-- instrument chips injected --></div>
```

- [ ] **Step 2: Render chips from the registry in `controls.js`**

In `web/js/ui/controls.js`, add the registry import after the tunings import (currently `import { tuningsFor } from '../music/tunings.js';`):

```js
import { INSTRUMENTS } from '../music/instruments.js';
```

Retype the `onModeChange` callback doc. Change:

```js
   * @param {(instrument:'guitar'|'bass') => void} cb.onModeChange
```
to:
```js
   * @param {(instrument:string) => void} cb.onModeChange
```

In the constructor, render the chips before wiring. Change (currently the end of the constructor):

```js
    this._wire();
  }
```
to:
```js
    this._renderInstruments();
    this._wire();
  }
```

In `_wire()`, delete the old instrument-segment block that queried `.seg-btn` (the chips are dynamic now and carry their own listeners). Remove:

```js
    this.$('instrumentSeg').querySelectorAll('.seg-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const inst = btn.dataset.instrument;
        if (inst === this._instrument) return;
        cb.onModeChange(inst);
      });
    });

```

- [ ] **Step 3: Add `_renderInstruments()` and rewrite `_setInstrumentUI()`**

In `web/js/ui/controls.js`, replace the existing `_setInstrumentUI` / `setInstrument` pair (currently):

```js
  _setInstrumentUI(inst) {
    this._instrument = inst;
    this.$('instrumentSeg').querySelectorAll('.seg-btn').forEach((b) => {
      b.classList.toggle('is-on', b.dataset.instrument === inst);
    });
    this._renderTuningList();
  }
  setInstrument(inst) { this._setInstrumentUI(inst); }
```

with:

```js
  /** Build the instrument selector chips from the registry (horizontally scrollable). */
  _renderInstruments() {
    const seg = this.$('instrumentSeg');
    seg.innerHTML = '';
    INSTRUMENTS.forEach((inst) => {
      const b = this.doc.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (inst.id === this._instrument ? ' is-on' : '');
      b.dataset.instrument = inst.id;
      b.textContent = inst.label;
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', inst.id === this._instrument ? 'true' : 'false');
      b.addEventListener('click', () => {
        if (inst.id === this._instrument) return;
        this.cb.onModeChange(inst.id);
      });
      seg.appendChild(b);
    });
  }

  _setInstrumentUI(inst) {
    this._instrument = inst;
    const seg = this.$('instrumentSeg');
    let active = null;
    seg.querySelectorAll('.chip').forEach((b) => {
      const on = b.dataset.instrument === inst;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      if (on) active = b;
    });
    // Keep the active chip visible on a narrow phone: centre it within the scroll row.
    if (active) seg.scrollLeft = active.offsetLeft - (seg.clientWidth - active.clientWidth) / 2;
    this._renderTuningList();
  }
  setInstrument(inst) { this._setInstrumentUI(inst); }
```

- [ ] **Step 4: Style the chip row**

In `web/css/styles.css`, insert after the `.seg-btn.is-on { … }` rule (in the sheet-controls block):

```css
/* Package B: instrument selector — horizontally scrollable chip row */
.chip-row {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  gap: 8px;
  padding: 3px;
  overflow-x: auto;
  scroll-behavior: smooth;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
}
.chip-row::-webkit-scrollbar { display: none; }
.chip {
  flex: 0 0 auto;
  border: 1px solid var(--surface-brd);
  background: var(--surface);
  color: var(--muted);
  font: 500 14px 'Space Grotesk', sans-serif;
  padding: 7px 15px;
  border-radius: 999px;
  cursor: pointer;
  white-space: nowrap;
  -webkit-tap-highlight-color: transparent;
}
.chip.is-on { background: var(--accent); color: var(--bg-bot); border-color: transparent; font-weight: 600; }
```

(`.sheet-row` is `display:flex; justify-content:space-between`; `.chip-row { flex:1 1 auto; min-width:0 }` takes the width beside the fixed theme toggle and scrolls its overflow instead of pushing the toggle.)

- [ ] **Step 5: Run tests (no regressions)**

Run: `node web/test/run-all.js`
Expected: PASS — `ALL TESTS PASSED`. (Browser-only view changes; the Node suite is unaffected.)

- [ ] **Step 6: Manual verification**

```bash
node serve.mjs 8173
```

At `http://localhost:8173`, open the sheet. Expected: a single scrollable row of 7 chips — Guitar, Bass, Ukulele, Mandolin, Violin, Banjo, Baritone — with the active one highlighted. Narrow the window (or use a device-emulation width ~360px): the row scrolls horizontally without pushing the ◑ theme toggle off-screen and without the page itself scrolling sideways. Tapping **Ukulele** loads `Standard (reentrant)` (strings show C E G A), tapping **Baritone** loads B1 E2 A2 D3 F#3 B3 and the selected chip scrolls into view/centres. No console errors.

- [ ] **Step 7: Commit**

```bash
git add web/index.html web/js/ui/controls.js web/css/styles.css
git commit -m "feat(controls): scrollable instrument chip row from registry"
```

---

### Task 5: Repair the custom-tuning editor (`controls.js` + CSS)

**Files:**
- Modify: `web/js/ui/controls.js`
- Modify: `web/css/styles.css`

**Interfaces:**
- Consumes: `midiToName`, `frequencyFromMidi` (already imported); `cb.onCustomSave(midiArray, name, id, instrument)` — the callback gains a 4th `instrument` argument, which `app.js#saveCustom` (Task 3) already accepts.
- Produces: `_openEditor(seed?, id?, name?)` seeds `_editId`/name for edit-in-place; a rebuilt editor whose name `<input>` survives per-string edits; a 1–8 string stepper; a per-string note+octave picker; an ✎ edit affordance on each custom tuning row.

- [ ] **Step 1: Retype the `onCustomSave` callback**

In `web/js/ui/controls.js`, change the constructor doc line:

```js
   * @param {(midiArray:number[], name:string, id:string|null) => void} cb.onCustomSave
```
to:
```js
   * @param {(midiArray:number[], name:string, id:string|null, instrument:string) => void} cb.onCustomSave
```

- [ ] **Step 2: Add an ✎ edit affordance to each custom tuning row**

In `web/js/ui/controls.js`, inside `_renderTuningList`'s `addItem`, change the `if (isCustom) { … }` block (currently):

```js
      if (isCustom) {
        const del = doc.createElement('button');
        del.type = 'button';
        del.className = 'tuning-del';
        del.textContent = '✕';
        del.title = 'Delete tuning';
        del.addEventListener('click', (e) => { e.stopPropagation(); this.cb.onCustomDelete(t.id); });
        item.appendChild(del);
      }
```

to:

```js
      if (isCustom) {
        const edit = doc.createElement('button');
        edit.type = 'button';
        edit.className = 'tuning-edit';
        edit.textContent = '✎';
        edit.title = 'Edit tuning';
        edit.addEventListener('click', (e) => { e.stopPropagation(); this._openEditor(t.strings.slice(), t.id, t.name); });
        item.appendChild(edit);
        const del = doc.createElement('button');
        del.type = 'button';
        del.className = 'tuning-del';
        del.textContent = '✕';
        del.title = 'Delete tuning';
        del.addEventListener('click', (e) => { e.stopPropagation(); this.cb.onCustomDelete(t.id); });
        item.appendChild(del);
      }
```

- [ ] **Step 3: Rewrite the editor for edit-in-place, 1–8 strings, a note picker, and focus preservation**

In `web/js/ui/controls.js`, replace the entire block from `_openEditor(seed) {` through the closing brace of `_nudge` (the whole "custom tuning editor" section, currently `_openEditor`, `_renderEditor`, `_setStringCount`, `_nudge`) with:

```js
  _openEditor(seed, id, name) {
    // seed from the passed strings (edit / tweak-preset), else the current tuning.
    this._editMidis = (seed || (this._tuning ? this._tuning.strings.slice() : [40, 45, 50, 55, 59, 64])).slice();
    this._editId = id || null;               // set → Save upserts the existing custom (edit-in-place)
    this._editSeedName = name || null;
    this.sheetMain.hidden = true;
    this.sheetEditor.hidden = false;
    this._buildEditor();
  }

  /** Build the editor shell ONCE. Only the string rows re-render on edits, so the
   *  name <input> keeps its value/focus (fixes the "typed name lost on nudge" bug). */
  _buildEditor() {
    const doc = this.doc;
    const ed = this.sheetEditor;
    ed.innerHTML = '';

    const head = doc.createElement('div');
    head.className = 'editor-head';
    const back = doc.createElement('button');
    back.type = 'button'; back.className = 'editor-back'; back.textContent = '‹ Back';
    back.addEventListener('click', () => this._showMain());
    const title = doc.createElement('span');
    title.className = 'editor-title';
    title.textContent = this._editId ? 'Edit tuning' : 'Custom tuning';
    head.appendChild(back); head.appendChild(title);
    ed.appendChild(head);

    // string-count stepper (1–8)
    const countRow = doc.createElement('div');
    countRow.className = 'editor-count-row';
    this._countMinus = doc.createElement('button');
    this._countMinus.type = 'button'; this._countMinus.className = 'a4-step'; this._countMinus.textContent = '−';
    this._countMinus.addEventListener('click', () => this._stepCount(-1));
    this._countLabel = doc.createElement('span');
    this._countLabel.className = 'editor-count';
    this._countPlus = doc.createElement('button');
    this._countPlus.type = 'button'; this._countPlus.className = 'a4-step'; this._countPlus.textContent = '+';
    this._countPlus.addEventListener('click', () => this._stepCount(+1));
    countRow.appendChild(this._countMinus);
    countRow.appendChild(this._countLabel);
    countRow.appendChild(this._countPlus);
    ed.appendChild(countRow);

    // per-string rows (rebuilt by _renderRows on count change)
    this._elRows = doc.createElement('div');
    this._elRows.className = 'editor-rows';
    ed.appendChild(this._elRows);

    // name — lives OUTSIDE the re-rendered rows, so it survives every edit
    const nameWrap = doc.createElement('div');
    nameWrap.className = 'editor-name';
    this._nameInput = doc.createElement('input');
    this._nameInput.type = 'text'; this._nameInput.maxLength = 24; this._nameInput.id = 'customName';
    this._nameInput.placeholder = 'Name';
    this._nameInput.value = this._editSeedName || `Custom ${this._customs.length + 1}`;
    nameWrap.appendChild(this._nameInput);
    ed.appendChild(nameWrap);

    const actions = doc.createElement('div');
    actions.className = 'editor-actions';
    const cancel = doc.createElement('button');
    cancel.type = 'button'; cancel.className = 'editor-cancel'; cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => this._showMain());
    const save = doc.createElement('button');
    save.type = 'button'; save.className = 'sheet-done'; save.textContent = 'Save tuning';
    save.addEventListener('click', () => {
      const nm = (this._nameInput.value || '').trim() || `Custom ${this._customs.length + 1}`;
      this.cb.onCustomSave(this._editMidis.slice(), nm, this._editId, this._instrument);
      this.closeSheet();
    });
    actions.appendChild(cancel); actions.appendChild(save);
    ed.appendChild(actions);

    this._renderRows();
  }

  /** Rebuild only the string rows (called when the string count changes). */
  _renderRows() {
    const doc = this.doc;
    this._elRows.innerHTML = '';
    this._editMidis.forEach((midi, i) => {
      const row = doc.createElement('div');
      row.className = 'editor-row';

      const minus = doc.createElement('button');
      minus.type = 'button'; minus.className = 'a4-step'; minus.textContent = '−';
      minus.addEventListener('click', () => this._nudge(i, -1));

      const noteSel = doc.createElement('select');
      noteSel.className = 'editor-pick editor-note-sel';
      for (let pc = 0; pc < 12; pc++) {
        const o = doc.createElement('option');
        o.value = String(pc); o.textContent = midiToName(pc).name;   // C, C#, D, … B
        noteSel.appendChild(o);
      }
      noteSel.addEventListener('change', () => this._setFromPickers(i));

      const octSel = doc.createElement('select');
      octSel.className = 'editor-pick editor-oct-sel';
      for (let oct = 0; oct <= 5; oct++) {                            // A0..E5 span octaves 0..5
        const o = doc.createElement('option');
        o.value = String(oct); o.textContent = String(oct);
        octSel.appendChild(o);
      }
      octSel.addEventListener('change', () => this._setFromPickers(i));

      const hz = doc.createElement('span');
      hz.className = 'editor-hz';

      const plus = doc.createElement('button');
      plus.type = 'button'; plus.className = 'a4-step'; plus.textContent = '+';
      plus.addEventListener('click', () => this._nudge(i, +1));

      row.appendChild(minus);
      row.appendChild(noteSel);
      row.appendChild(octSel);
      row.appendChild(hz);
      row.appendChild(plus);
      this._elRows.appendChild(row);
      this._updateRow(i);
    });
    this._updateCountUI();
  }

  /** Sync one row's pickers + Hz label to _editMidis[i] in place (preserves focus). */
  _updateRow(i) {
    const row = this._elRows.children[i];
    if (!row) return;
    const midi = this._editMidis[i];
    row.querySelector('.editor-note-sel').value = String(((midi % 12) + 12) % 12);
    row.querySelector('.editor-oct-sel').value = String(Math.floor(midi / 12) - 1);
    const info = midiToName(midi);
    row.querySelector('.editor-hz').textContent =
      `${info.name}${info.octave} · ${frequencyFromMidi(midi, this._a4).toFixed(1)} Hz`;
  }

  _updateCountUI() {
    const n = this._editMidis.length;
    this._countLabel.textContent = n === 1 ? '1 string' : `${n} strings`;
    this._countMinus.disabled = n <= 1;
    this._countPlus.disabled = n >= 8;
  }

  _stepCount(delta) {
    this._setStringCount(Math.min(8, Math.max(1, this._editMidis.length + delta)));
  }

  _setStringCount(n) {
    const cur = this._editMidis;
    if (n === cur.length) return;
    if (n > cur.length) {
      // grow: prepend strings a fourth (5 semitones) below the current lowest
      while (this._editMidis.length < n) {
        this._editMidis.unshift(Math.max(21, this._editMidis[0] - 5));
      }
    } else {
      // shrink from the low side (keep the highest n)
      this._editMidis = this._editMidis.slice(cur.length - n);
    }
    this._renderRows();
  }

  _setFromPickers(i) {
    const row = this._elRows.children[i];
    if (!row) return;
    const pc = parseInt(row.querySelector('.editor-note-sel').value, 10);
    const oct = parseInt(row.querySelector('.editor-oct-sel').value, 10);
    this._editMidis[i] = Math.min(76, Math.max(21, (oct + 1) * 12 + pc));
    this._updateRow(i);
  }

  _nudge(i, delta) {
    this._editMidis[i] = Math.min(76, Math.max(21, this._editMidis[i] + delta));
    this._updateRow(i);
  }
```

- [ ] **Step 4: Style the note picker, string-count stepper, and edit affordance**

In `web/css/styles.css`, change the `.editor-row` rule's gap from 12px to 8px to fit five controls per row. Change:

```css
.editor-row { display: flex; align-items: center; gap: 12px; }
```
to:
```css
.editor-row { display: flex; align-items: center; gap: 8px; }
```

Then insert after the `.editor-actions .sheet-done { flex: 1; margin-top: 0; }` rule:

```css
/* Package B: custom-editor 1–8 string stepper + per-string note picker */
.editor-count-row { display: flex; align-items: center; justify-content: center; gap: 18px; margin-bottom: 16px; }
.editor-count { min-width: 92px; text-align: center; font: 500 14px 'JetBrains Mono', monospace; color: var(--ink); }
.a4-step:disabled { opacity: 0.35; cursor: default; }
.editor-row .a4-step { width: 40px; height: 40px; font-size: 20px; }
.editor-pick {
  appearance: none; -webkit-appearance: none;
  border: 1px solid var(--surface-brd); background: var(--surface); color: var(--ink);
  font: 500 14px 'Space Grotesk', sans-serif; padding: 8px 10px; border-radius: 10px; cursor: pointer;
}
.editor-note-sel { min-width: 58px; }
.editor-oct-sel { min-width: 52px; }
.editor-hz { flex: 1; text-align: right; font: 500 12px 'JetBrains Mono', monospace; color: var(--muted); }
.tuning-edit {
  flex: none; width: 42px; background: none; border: 0; border-left: 1px solid var(--surface-brd);
  color: var(--muted); font-size: 14px; cursor: pointer;
}
.tuning-edit:hover { color: var(--accent); }
```

- [ ] **Step 5: Run tests (no regressions)**

Run: `node web/test/run-all.js`
Expected: PASS — `ALL TESTS PASSED`. (Browser-only view changes; the underlying pure guarantees — `makeCustomTuning` honouring `instrument`, and the `validateTuningStrings` 1–8/21–76 clamp the editor relies on — are covered by Task 1/Task 2 suites.)

- [ ] **Step 6: Manual verification (all five editor defects)**

```bash
node serve.mjs 8173
```

At `http://localhost:8173`, open the sheet → **＋ Custom tuning…**. Verify:
1. **Focus-preserving render:** type a name, then tap a string's `−`/`+` a few times — the typed name is NOT lost and the Hz/note updates in place.
2. **Note picker:** change a string's note dropdown to `C` and octave to `2` — the row shows `C2 · 65.4 Hz`; the ± buttons still nudge from there; nothing exceeds A0..E5.
3. **1–8 strings:** the count stepper goes down to `1 string` (− disabled at 1) and up to `8 strings` (+ disabled at 8); rows add/remove accordingly and the name persists.
4. **Misclassification fix (end-to-end):** with **Guitar** selected, create a custom whose lowest string you nudge below C2 (e.g. to A1 = MIDI 33 or lower), Save. It appears under Guitar → "Your tunings". Switch to **Bass**: it is NOT listed there. Switch back to **Guitar**: it IS listed. (Confirms `instrument: 'guitar'` was passed, not inferred as bass.)
5. **Edit-in-place:** on that saved custom, tap ✎ — the editor title reads "Edit tuning", seeded with its strings/name. Change a string and Save: the SAME entry updates (no duplicate row appears).

No console errors throughout.

- [ ] **Step 7: Commit**

```bash
git add web/js/ui/controls.js web/css/styles.css
git commit -m "fix(controls): edit-in-place, 1-8 strings, note picker, focus-preserving editor"
```

---

## Self-Review

**Spec coverage (spec §4 Package B) — every requirement maps to a task:**
- §4.1 Instrument registry `{id, label, defaultTuningId, order}`, single source for selector/default/`tuningsFor` grouping/classification → **Task 2** (`instruments.js`), wired in **Task 3** (`defaultTuningIdFor`) and **Task 4** (chip source). ✓
- §4.1 New instruments as tuning data (ukulele reentrant + low-G, mandolin, violin, banjo, baritone), tagged with their instrument id → **Task 1**. ✓
- §4.1 DSP profile still frequency-derived (no `CONFIG.modes` change) → stated in Architecture + `instruments.js` header + the MIDI table (baritone → bass engine verified). ✓
- §4.1 Reentrant caveat (stored in pitch order; physical labelling a documented simplification) → Global Constraints + `tunings.js` comments + Task 1 ascending-storage test. ✓
- §4.2 Selector → horizontally scrollable chip row from the registry; selecting an instrument selects its `defaultTuningId`; usable on a narrow phone → **Task 4** (`.chip-row`, scroll-centre active chip; manual narrow-width check). ✓
- §4.3 Misclassification: `onCustomSave` gains `instrument`; `controls.js` passes `this._instrument`; `app.js#saveCustom` forwards to `makeCustomTuning(…, instrument)` → **Task 3** (app forward) + **Task 5** (controls pass) + **Task 2** (pure guarantee tested). ✓
- §4.3 Edit-in-place (wire `_editId`, ✎ affordance, `_openEditor(seed, id)` upsert) → **Task 5**. ✓
- §4.3 1–8 strings (replace fixed `[4,5,6,7]`) → **Task 5** stepper (uses the existing `validateTuningStrings` 1–8 range). ✓
- §4.3 Note picker (note-name + octave dropdowns alongside ± nudge) → **Task 5**. ✓
- §4.3 Focus-preserving render (name input outside the re-rendered rows; per-row in-place `_updateRow`) → **Task 5**. ✓
- §4 Tests: `test-instruments` (registry integrity, unique ids, valid `defaultTuningId`, `tuningsFor` coverage, `makeCustomTuning` explicit-instrument) → **Task 2**; extend tunings tests for new presets' note math → **Task 1**. ✓
- §4 Files: `instruments.js`+`test-instruments.js` new; `tunings.js`/`controls.js`/`app.js`/`index.html`/`styles.css`/`sw.js` changed (`CORE_ASSETS` + `CACHE` bump v2→v3 in Task 2). ✓
- §4 Risks: narrow-phone selector (scroll + centred active state, Task 4 Step 6) and reentrant labelling (documented) both addressed. ✓

**Placeholder scan:** No TBD/TODO/"similar to". Every step contains complete, runnable code and exact commands with the exact expected pass/fail output. ✓

**Type/name consistency:** `onCustomSave(midiArray, name, id, instrument)` — 4-arg signature declared in Task 5 (controls doc + `save` handler passing `this._instrument`) matches `app.js#saveCustom(midiArray, name, id, instrument)` from Task 3, matches `makeCustomTuning(midiArray, name, id, instrument)` from Task 1. `INSTRUMENTS` ids (`guitar,bass,ukulele,mandolin,violin,banjo,baritone`) from Task 2 exactly match the `instrument` field on the Task 1 tunings and the `defaultTuningIdFor` fallback `'guitar-standard'` exists. `instrumentSeg` id is shared by the Task 4 `index.html` container and the `controls.js` chip logic. `#customName`, `.chip`, `.editor-pick`, `.editor-hz`, `.editor-count`, `.tuning-edit` class names are created in JS and styled in CSS within the same task. ✓

**MIDI/clamp/fMax verification:** all six presets recomputed (`node -e` script): strictly ascending; max pitch = E5 (MIDI 76 = 659.26 Hz) sits exactly at the `validateTuningStrings` ceiling and well under guitar `fMax` = 1200 Hz; min pitch = baritone B1 (61.74 Hz) correctly selects the bass engine (< 70 Hz). No value exceeds either bound. ✓

**Ordering / no red between tasks:** Task 1 (tunings) precedes Task 2 (registry test cross-checks `defaultTuningId` against those tunings). Task 2 creates the shipped `instruments.js` AND updates `CORE_ASSETS`/`CACHE` in the same task, so `test-sw-assets` is never left red at a task boundary (its bite is shown deliberately in Task 2 Step 4 then fixed in Step 5). Task 2 precedes Tasks 3–5 that import it. Task 3 (app 4th-arg) precedes Task 5 (controls passes it); the gap causes no regression (fallback to inference). Shared files touched only by the tasks listed in Global Constraints, in non-overlapping regions, so Packages D/E/F layer on cleanly. ✓
