# Package E — Metronome + mode navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the flagship metronome — trivially simple on its face (big BPM, tap, start/stop, default 4/4) but able to play **any** meter: arbitrary beat counts, additive/asymmetric groups (3+2+2), per-beat 4-state accents (accent/normal/ghost/rest), and per-beat subdivision. Plus a header **Tuner | Metronome** mode switch that makes the two modes mutually exclusive.

**Architecture:** A new **pure** meter model (`music/meter.js`, Node-tested) is the single source of truth: a bar is an array of beats, any length is a valid meter, and a pure `expandBar(bar, bpm)` yields the click events for one bar. A new **look-ahead scheduler** (`audio/metronome.js`, "A Tale of Two Clocks") schedules those clicks on the `AudioContext` sample clock via a `setTimeout` pump reading a short window — beats are never driven by `setInterval`/`setTimeout` timing. Each click is a raised-cosine-shaped oscillator burst routed through the Package-D **master gain bus**. A two-tier view (`ui/metronome-view.js`) renders a zero-config face and an editor bottom sheet. `app.js` gains `state.uiMode` and mode-exclusive start/stop. All numeric constants live in a new deep-frozen `CONFIG.metronome` block.

**Tech Stack:** Vanilla ES modules (no build step), Web Audio API (`AudioContext` sample-clock scheduling), the repo's zero-dependency Node test harness (`web/test/assert.js` + `run-all.js`), `store.js` for persistence.

## Global Constraints

- **No build step.** Static ES modules served as-is. No bundler, no transpile, no npm runtime deps. New code is hand-authored ESM. (spec §1.1)
- **Pure vs. browser split.** `js/config.js` and `js/music/meter.js` stay **pure and Node-safe** (no `window`/`document`/`AudioContext`/`performance`/`Date`) and are unit-tested in Node. `js/audio/metronome.js`, `js/ui/metronome-view.js`, and `js/app.js` are the browser wrappers and stay thin. **New pure logic goes in `meter.js` so it stays testable.** (spec §1.2)
- **`CONFIG` is the single source of truth**, deep-frozen. Every metronome numeric parameter goes in `CONFIG.metronome`; no inline numeric literals or globals in logic modules. (spec §1.3, §7.5)
- **Web Audio is created lazily on a user gesture** in `app.js#ensureAudioContext()` and resumed if suspended. Everything that makes sound shares that one `AudioContext`. The metronome connects to the **master gain bus** introduced in Package D, not to `destination` directly. (spec §1.6, §2.2)
- **localStorage access is always wrapped** (via `store.js`) and tolerant of absence. (spec §1.7)
- **Cache-list discipline:** every new shipped module (`meter.js`, `metronome.js`, `metronome-view.js`) MUST be added to `CORE_ASSETS` in `web/sw.js`, and `CACHE` is bumped **once** for the package. `test-sw-assets` enforces coverage. (spec §3)
- **Modes are mutually exclusive.** Entering Metronome stops capture (`capture.stop()`), cancels the rAF tuner loop, and **releases the mic**; returning to Tuner restarts it if it had been running. Views are separate DOM sections toggled by `hidden`. (spec §2.3, §7.1)
- **Beats are scheduler-driven only.** A `setTimeout` pump schedules clicks inside a look-ahead window on `ctx.currentTime`; beats are **never** driven directly by `setInterval`/`setTimeout` timing (jitter + background throttling). Absolute times accumulate in seconds from a fixed bar start — never by `+=` of a rounded interval — so there is no drift. (spec §7.3)
- Test harness idiom: each suite file default-exports a `run()` that calls `suite(name, fn)` + `assert`/`assertClose`, and is registered in `web/test/run-all.js`. Full suite is `node web/test/run-all.js` (exit 1 on any failure). Baseline on this branch when this plan was written: **319 assertions pass**. Because packages B and D land before E, the real baseline may be higher by the time E starts — treat the count as "whatever is green when the task starts," and require only that every step keeps the suite fully green (0 failures).
- **Package D dependency (integration is sequential B → D → E):** Package D adds (a) the master `GainNode` (`masterGain`) in `ensureAudioContext()`, and (b) an `export` on `raisedCosineCurve` in `audio/tone.js`. This plan consumes both; each task that relies on them includes a guarded verify-or-add step so the plan is safe even if the running tree predates D.
- **Deferred within Package E (decided, not accidental):** count-in bar, bar/loop counter, and auto-accelerate are **out of scope**. The spec calls them "cheap once the scheduler exists (include if low-cost, else defer)." They are deferred to keep the flagship tight and the default face trivially simple; they add UI surface and test burden without touching the core primitive, and remain cheap to add later precisely because the scheduler centralizes every bar boundary in `_loadBar()` (auto-accelerate = bump bpm there; count-in = prepend a bar). (spec §7.4)

---

## File Structure

- `web/js/music/meter.js` **(new, pure)** — the any-meter model: `expandBar`, `makeAdditiveBar`, `cycleAccent`, `tapTempoBpm`, `groupsFromBar`, `regroupBar`, `ACCENT_CYCLE`.
- `web/test/test-meter.js` **(new)** — unit tests for `meter.js` (the full case table).
- `web/js/config.js` **(modify)** — add the deep-frozen `CONFIG.metronome` block.
- `web/test/test-config.js` **(new)** — guards the `CONFIG.metronome` shape/freeze/relationships.
- `web/js/audio/metronome.js` **(new, browser)** — look-ahead scheduler + click synth.
- `web/test/test-metronome.js` **(new)** — Node smoke test (construction guards + bpm clamp; also verifies the `raisedCosineCurve` export exists).
- `web/js/ui/metronome-view.js` **(new, browser)** — two-tier face + editor view.
- `web/js/app.js` **(modify)** — `state.uiMode`, mode switching (mic release/restart), master-bus wiring, `Metronome` + `MetronomeView` instances, beat-highlight rAF loop, persistence.
- `web/index.html` **(modify)** — mode-nav segmented control, `#tunerView` wrapper, `#metronomeView` section, metronome editor sheet.
- `web/css/styles.css` **(modify)** — mode-nav, metronome face, beat pills, editor styles.
- `web/js/audio/tone.js` **(modify, only if D absent)** — export `raisedCosineCurve`.
- `web/sw.js` **(modify)** — add the three new modules to `CORE_ASSETS`; bump `CACHE` once.
- `web/test/run-all.js` **(modify)** — register `test-meter`, `test-config`, `test-metronome`.

---

### Task 1: `CONFIG.metronome` block + `test-config.js`

Pure, no dependencies. Establishes the single source of truth every later task reads (spec §1.3, §7.5). `config.js` is already in `CORE_ASSETS`, so **no `sw.js` change and no `CACHE` bump in this task** — only Tasks 2–4 create new shipped modules.

**Files:**
- Modify: `web/js/config.js` (add the deep-frozen `metronome` sub-object)
- Create: `web/test/test-config.js`
- Modify: `web/test/run-all.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `CONFIG.metronome` — a deep-frozen object: `{ bpmMin:number, bpmMax:number, bpmDefault:number, beatCountMin:number, beatCountMax:number, subdivisions:number[], tapResetMs:number, tapMaxTaps:number, lookaheadMs:number, scheduleAheadSec:number, clickType:string, clickMs:number, clickAttackMs:number, levels:{ accent:{freq,gain}, normal:{freq,gain}, ghost:{freq,gain}, sub:{freq,gain} }, gain:number }`.

- [ ] **Step 1: Write the failing test**

Create `web/test/test-config.js`:

```js
// Node. Guards the shape, freeze, and internal relationships of CONFIG.metronome.
// Pure: config.js is Node-safe.
import { suite, assert } from './assert.js';
import { CONFIG } from '../js/config.js';

/** Registers and runs the CONFIG.metronome guard suite. */
export default function run() {
  suite('config: metronome block exists + deep-frozen', () => {
    const m = CONFIG.metronome;
    assert(!!m && typeof m === 'object', 'CONFIG.metronome is an object');
    assert(Object.isFrozen(m), 'CONFIG.metronome is frozen');
    assert(Object.isFrozen(m.levels), 'CONFIG.metronome.levels is frozen');
    assert(Object.isFrozen(m.levels.accent), 'levels.accent is frozen');
  });

  suite('config: bpm + beat-count bounds are ordered', () => {
    const m = CONFIG.metronome;
    assert(m.bpmMin < m.bpmDefault && m.bpmDefault < m.bpmMax, 'bpmMin < bpmDefault < bpmMax');
    assert(m.beatCountMin >= 1, 'beatCountMin >= 1');
    assert(m.beatCountMin < m.beatCountMax, 'beatCountMin < beatCountMax');
  });

  suite('config: subdivisions list', () => {
    const subs = CONFIG.metronome.subdivisions;
    assert(Array.isArray(subs) && subs.length > 0, 'subdivisions is a non-empty array');
    assert(subs.includes(1), 'subdivisions includes 1 (the un-subdivided beat)');
    assert(subs.every((s) => Number.isInteger(s) && s >= 1), 'all subdivisions are positive integers');
  });

  suite('config: scheduler window exceeds the pump period', () => {
    const m = CONFIG.metronome;
    // The look-ahead window MUST be larger than the pump interval, or a click can
    // fall between two pumps and never get scheduled.
    assert(m.scheduleAheadSec > m.lookaheadMs / 1000, 'scheduleAheadSec > lookaheadMs (seconds)');
    assert(m.lookaheadMs > 0 && m.scheduleAheadSec > 0, 'both scheduler constants are positive');
  });

  suite('config: click envelope + tap-tempo sanity', () => {
    const m = CONFIG.metronome;
    assert(m.clickAttackMs > 0 && m.clickAttackMs < m.clickMs, '0 < clickAttackMs < clickMs');
    assert(typeof m.clickType === 'string' && m.clickType.length > 0, 'clickType is a non-empty string');
    assert(m.tapMaxTaps >= 2, 'tapMaxTaps >= 2 (need at least one interval)');
    assert(m.tapResetMs > 0, 'tapResetMs > 0');
  });

  suite('config: per-level voices (freq + gain, accent loudest, ghost quietest)', () => {
    const L = CONFIG.metronome.levels;
    for (const name of ['accent', 'normal', 'ghost', 'sub']) {
      assert(L[name] && L[name].freq > 0, `${name}.freq > 0`);
      assert(L[name] && L[name].gain > 0 && L[name].gain <= 1, `${name}.gain in (0,1]`);
    }
    assert(L.ghost.gain < L.normal.gain, 'ghost is quieter than normal');
    assert(L.normal.gain <= L.accent.gain, 'accent is at least as loud as normal');
  });
}
```

Register it in `web/test/run-all.js` — add the import alongside the other `import run…` lines and the call alongside the other `run…();` calls before `const ok = report();`:

```js
import runConfig from './test-config.js';
```
```js
runConfig();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node web/test/run-all.js`
Expected: FAIL — every `config:` suite fails because `CONFIG.metronome` is `undefined` (e.g. `config: metronome block exists + deep-frozen` → `CONFIG.metronome is an object` FAILs, and the `levels`/relationship suites throw on reading properties of `undefined`, recorded as `[config: …] THREW`). Summary ends `… TEST(S) FAILED`.

- [ ] **Step 3: Add the `CONFIG.metronome` block**

In `web/js/config.js`, add the `metronome` sub-object **inside** the `deepFreeze({ … })` object literal, immediately after the closing `}` of the existing `modes: { … }` block (add a comma after `modes`'s closing brace). Do **not** touch `snapGuardCents`, `octaveSanityCents`, `attackConfirmFrames`, or any existing key:

```js
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
```

`deepFreeze()` already recurses into `metronome`, `metronome.levels`, and each level object, so no extra wiring is needed.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node web/test/run-all.js`
Expected: PASS — all six `config:` suites print `PASS` and the summary ends `ALL TESTS PASSED`.

- [ ] **Step 5: Commit**

```bash
git add web/js/config.js web/test/test-config.js web/test/run-all.js
git commit -m "feat(config): add deep-frozen CONFIG.metronome block + guard test"
```

---

### Task 2: `meter.js` any-meter model + `test-meter.js` (full case table)

Pure, Node-tested — the single source of truth for the metronome. This is the **first task that creates a new shipped module**, so it also adds `meter.js` to `CORE_ASSETS` and **bumps `CACHE` once for the whole package** (Tasks 3–4 add more `CORE_ASSETS` entries but do **not** bump `CACHE` again).

**Files:**
- Create: `web/js/music/meter.js`
- Create: `web/test/test-meter.js`
- Modify: `web/test/run-all.js`
- Modify: `web/sw.js` (add `meter.js` to `CORE_ASSETS`; bump `CACHE`)

**Interfaces:**
- Consumes: `CONFIG.metronome.{subdivisions, bpmMin, bpmMax, tapResetMs, tapMaxTaps}` from Task 1.
- Produces:
  - `ACCENT_CYCLE: string[]` — `['normal','accent','ghost','rest']` (tap-cycle order for a pill).
  - `expandBar(bar: Beat[], bpm: number) => { timeOffsetSec: number, level: 'accent'|'normal'|'ghost'|'sub' }[]` where `Beat = { accent:'accent'|'normal'|'ghost'|'rest', subdivision:1|2|3|4, group?:number }`. One beat = one `60/bpm` interval; a beat's first click carries the beat's accent level, its subdivision clicks carry `'sub'`; a `'rest'` beat emits nothing.
  - `makeAdditiveBar(groups: number[]) => Beat[]` — flat bar; each group's first beat `accent:'accent'`, the rest `'normal'`; every beat `subdivision:1` and a `group` index.
  - `cycleAccent(accent: string) => string` — next entry in `ACCENT_CYCLE` (unknown → `'normal'`).
  - `tapTempoBpm(timestampsMs: number[]) => number|null` — rounded, clamped BPM from tap intervals, or `null` (`<2` taps / no valid interval).
  - `groupsFromBar(bar: Beat[]) => number[]` — run-lengths of the `group` index.
  - `regroupBar(bar: Beat[], groups: number[]) => Beat[]` — reassign `group` indices, accent each group's first beat, demote former group-firsts to `'normal'`, preserve `subdivision`.

- [ ] **Step 1: Write the failing test**

Create `web/test/test-meter.js`:

```js
// Node. Full case table for js/music/meter.js — the pure any-meter model.
import { suite, assert, assertClose } from './assert.js';
import {
  expandBar, makeAdditiveBar, cycleAccent, tapTempoBpm,
  groupsFromBar, regroupBar, ACCENT_CYCLE,
} from '../js/music/meter.js';
import { CONFIG } from '../js/config.js';

const beat = (accent = 'normal', subdivision = 1, group = 0) => ({ accent, subdivision, group });
const levels = (evs) => evs.map((e) => e.level);
const times = (evs) => evs.map((e) => e.timeOffsetSec);

/** Registers and runs the meter suite. */
export default function run() {
  suite('meter: plain 4/4 accents (bpm counts the pulse)', () => {
    const bar = makeAdditiveBar([4]);          // [accent, normal, normal, normal]
    const evs = expandBar(bar, 120);            // beatDur = 60/120 = 0.5s
    assert(evs.length === 4, 'four clicks for four beats');
    assert(times(evs).join(',') === '0,0.5,1,1.5', 'beats at 0, 0.5, 1.0, 1.5 (one 60/bpm interval each)');
    assert(levels(evs).join(',') === 'accent,normal,normal,normal', 'downbeat accented, rest normal');
  });

  suite('meter: 5/8 is five beats', () => {
    const bar = makeAdditiveBar([5]);
    const evs = expandBar(bar, 120);
    assert(evs.length === 5, 'five clicks for five beats');
    assert(times(evs).join(',') === '0,0.5,1,1.5,2', 'evenly spaced at 60/bpm');
    assert(levels(evs).join(',') === 'accent,normal,normal,normal,normal', 'single accented downbeat');
  });

  suite('meter: additive 3+2+2 — group-first beats get accent', () => {
    const bar = makeAdditiveBar([3, 2, 2]);     // 7 beats
    assert(bar.length === 7, 'seven beats');
    const evs = expandBar(bar, 120);
    assert(times(evs).join(',') === '0,0.5,1,1.5,2,2.5,3', 'seven pulses');
    assert(levels(evs).join(',') === 'accent,normal,normal,accent,normal,accent,normal',
      'beats 0, 3, 5 (each group start) are accented');
    assert(groupsFromBar(bar).join(',') === '3,2,2', 'groupsFromBar recovers 3,2,2');
  });

  suite('meter: subdivision 1..4 — first click = beat accent, rest = sub', () => {
    // bpm 60 → beatDur 1.0s for clean fractions.
    const s1 = expandBar([beat('normal', 1)], 60);
    assert(levels(s1).join(',') === 'normal' && s1.length === 1, 'sub=1 → one normal click at 0');

    const s2 = expandBar([beat('accent', 2)], 60);
    assert(levels(s2).join(',') === 'accent,sub', 'sub=2 → accent then sub');
    assert(times(s2).join(',') === '0,0.5', 'sub=2 clicks at 0 and 0.5');

    const s3 = expandBar([beat('normal', 3)], 60);
    assert(levels(s3).join(',') === 'normal,sub,sub', 'sub=3 → normal then two subs');
    assertClose(s3[1].timeOffsetSec, 1 / 3, 1e-9, 'second click at 1/3');
    assertClose(s3[2].timeOffsetSec, 2 / 3, 1e-9, 'third click at 2/3');

    const s4 = expandBar([beat('normal', 4)], 60);
    assert(levels(s4).join(',') === 'normal,sub,sub,sub', 'sub=4 → normal then three subs');
    assert(times(s4).join(',') === '0,0.25,0.5,0.75', 'sub=4 quarter-beat clicks');

    // out-of-range subdivision clamps to 1 (no crash, single beat click)
    const bad = expandBar([beat('normal', 7)], 60);
    assert(bad.length === 1 && bad[0].level === 'normal', 'unlisted subdivision falls back to 1');
  });

  suite('meter: rest emits nothing, ghost keeps its level', () => {
    const evs = expandBar([beat('accent', 1), beat('rest', 1), beat('normal', 1)], 60);
    assert(evs.length === 2, 'rest beat produces no click');
    assert(times(evs).join(',') === '0,2', 'the rest leaves a gap: clicks at 0 and 2, none at 1');

    const g = expandBar([beat('ghost', 1)], 60);
    assert(g.length === 1 && g[0].level === 'ghost', "ghost beat's click carries the 'ghost' level");
    // (its gain is CONFIG.metronome.levels.ghost.gain — mapped in metronome.js, guarded in test-config)
  });

  suite('meter: empty / invalid input is safe', () => {
    assert(expandBar([], 120).length === 0, 'empty bar → no events');
    assert(expandBar(makeAdditiveBar([4]), 0).length === 0, 'bpm 0 → no events (no divide-by-zero)');
  });

  suite('meter: ACCENT_CYCLE + cycleAccent', () => {
    assert(ACCENT_CYCLE.join(',') === 'normal,accent,ghost,rest', 'cycle order is normal→accent→ghost→rest');
    assert(cycleAccent('normal') === 'accent', 'normal → accent');
    assert(cycleAccent('accent') === 'ghost', 'accent → ghost');
    assert(cycleAccent('ghost') === 'rest', 'ghost → rest');
    assert(cycleAccent('rest') === 'normal', 'rest wraps to normal');
    assert(cycleAccent('bogus') === 'normal', 'unknown accent → normal');
  });

  suite('meter: tapTempoBpm averaging + clamp + reset', () => {
    assert(tapTempoBpm([1000]) === null, '<2 taps → null');
    assert(tapTempoBpm([0, 500, 1000, 1500]) === 120, '500ms intervals → 120 bpm');
    assert(tapTempoBpm([0, 1000]) === 60, '1000ms interval → 60 bpm');
    // a gap beyond tapResetMs is discarded; only the tight pair remains → too few → null
    const reset = CONFIG.metronome.tapResetMs;
    assert(tapTempoBpm([0, reset + 5000]) === null, 'interval beyond tapResetMs is ignored');
    // absurdly fast taps clamp to bpmMax
    assert(tapTempoBpm([0, 10, 20, 30]) === CONFIG.metronome.bpmMax, 'very fast taps clamp to bpmMax');
    // absurdly slow taps (within reset window is impossible; use exactly reset) clamp to bpmMin
    const slow = tapTempoBpm([0, reset]); // 2000ms → 30 bpm (== bpmMin default)
    assert(slow === CONFIG.metronome.bpmMin, 'slowest in-window tap clamps to bpmMin');
  });

  suite('meter: makeAdditiveBar shape', () => {
    const bar = makeAdditiveBar([3, 2, 2]);
    assert(bar.length === 7, 'flattened length = sum of groups');
    assert(bar[0].accent === 'accent' && bar[3].accent === 'accent' && bar[5].accent === 'accent',
      'each group-first beat is accented');
    assert(bar[1].accent === 'normal' && bar[2].accent === 'normal', 'interior beats normal');
    assert(bar[0].group === 0 && bar[3].group === 1 && bar[5].group === 2, 'group indices assigned');
    assert(bar.every((b) => b.subdivision === 1), 'default subdivision 1');
  });

  suite('meter: regroupBar reassigns groups + accents, preserves subdivision', () => {
    // start as a flat 7/8 single group with a custom subdivision on one beat
    const flat = makeAdditiveBar([7]);
    flat[4].subdivision = 3;            // user set a subdivided beat
    const re = regroupBar(flat, [3, 2, 2]);
    assert(re.length === 7, 'length unchanged');
    assert(groupsFromBar(re).join(',') === '3,2,2', 'new grouping applied');
    assert(re[0].accent === 'accent' && re[3].accent === 'accent' && re[5].accent === 'accent',
      'group-first beats accented');
    assert(re[1].accent === 'normal' && re[4].accent === 'normal', 'former single-group accent demoted to normal');
    assert(re[4].subdivision === 3, 'per-beat subdivision preserved across regroup');
  });
}
```

Register it in `web/test/run-all.js` (import + call, same placement rule as Task 1):

```js
import runMeter from './test-meter.js';
```
```js
runMeter();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node web/test/run-all.js`
Expected: FAIL — the `meter:` suites throw with `Cannot find module '../js/music/meter.js'` (recorded as `[meter: …] THREW`), summary `… TEST(S) FAILED`. (`test-sw-assets` is still green at this point: `meter.js` does not yet exist on disk, so the shipped-tree scan can't flag it.)

- [ ] **Step 3: Write minimal implementation**

Create `web/js/music/meter.js`:

```js
// PURE (Node-safe). The any-meter model: a bar is an array of beats, any length is
// a valid meter, and expandBar(bar, bpm) yields the click events for one bar. No
// window/document/AudioContext/Date/performance. Numeric parameters come from CONFIG.
import { CONFIG } from '../config.js';

const SECONDS_PER_MINUTE = 60;   // unit conversion, not a tunable parameter
const MS_PER_MINUTE = 60000;

/** Tap-cycle order used when a pill is tapped in the editor. */
export const ACCENT_CYCLE = ['normal', 'accent', 'ghost', 'rest'];

/**
 * @typedef {Object} Beat
 * @property {'accent'|'normal'|'ghost'|'rest'} accent
 * @property {number} subdivision  clicks per beat (one of CONFIG.metronome.subdivisions)
 * @property {number} [group]      additive group index
 */

/**
 * Expand one bar into click events. beatDur = 60/bpm. A beat's first click carries
 * the beat's accent level ('accent'|'normal'|'ghost'); its remaining subdivision
 * clicks carry 'sub'. A 'rest' beat emits nothing.
 * @param {Beat[]} bar
 * @param {number} bpm
 * @returns {{timeOffsetSec:number, level:'accent'|'normal'|'ghost'|'sub'}[]}
 */
export function expandBar(bar, bpm) {
  const events = [];
  if (!Array.isArray(bar) || bar.length === 0 || !(bpm > 0)) return events;
  const beatDur = SECONDS_PER_MINUTE / bpm;
  const allowed = CONFIG.metronome.subdivisions;
  for (let i = 0; i < bar.length; i++) {
    const b = bar[i] || {};
    if (b.accent === 'rest') continue;                       // rests are silent
    const level = b.accent === 'accent' || b.accent === 'ghost' ? b.accent : 'normal';
    const beatStart = i * beatDur;
    const s = allowed.includes(b.subdivision) ? b.subdivision : 1;
    const subDur = beatDur / s;
    events.push({ timeOffsetSec: beatStart, level });        // beat-first: accent level
    for (let j = 1; j < s; j++) {
      events.push({ timeOffsetSec: beatStart + j * subDur, level: 'sub' });
    }
  }
  return events;
}

/**
 * Build a flat bar from additive group sizes. Each group's first beat is accented.
 * @param {number[]} groups
 * @returns {Beat[]}
 */
export function makeAdditiveBar(groups) {
  const bar = [];
  (groups || []).forEach((size, g) => {
    for (let k = 0; k < size; k++) {
      bar.push({ accent: k === 0 ? 'accent' : 'normal', subdivision: 1, group: g });
    }
  });
  return bar;
}

/**
 * Next accent state in ACCENT_CYCLE (unknown → 'normal').
 * @param {string} accent
 * @returns {string}
 */
export function cycleAccent(accent) {
  const i = ACCENT_CYCLE.indexOf(accent);
  return ACCENT_CYCLE[(i + 1) % ACCENT_CYCLE.length];
}

/**
 * Average tap intervals into a BPM. Intervals wider than tapResetMs are dropped
 * (a fresh tap set). Returns null for <2 taps or no valid interval. Clamped+rounded.
 * @param {number[]} timestampsMs
 * @returns {number|null}
 */
export function tapTempoBpm(timestampsMs) {
  const { bpmMin, bpmMax, tapResetMs, tapMaxTaps } = CONFIG.metronome;
  if (!Array.isArray(timestampsMs) || timestampsMs.length < 2) return null;
  const taps = timestampsMs.slice(-tapMaxTaps);
  const intervals = [];
  for (let i = 1; i < taps.length; i++) {
    const dt = taps[i] - taps[i - 1];
    if (dt > 0 && dt <= tapResetMs) intervals.push(dt);
  }
  if (intervals.length === 0) return null;
  const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  const bpm = MS_PER_MINUTE / avg;
  return Math.max(bpmMin, Math.min(bpmMax, Math.round(bpm)));
}

/**
 * Run-length of the `group` index across the bar (missing group → 0).
 * @param {Beat[]} bar
 * @returns {number[]}
 */
export function groupsFromBar(bar) {
  if (!Array.isArray(bar) || bar.length === 0) return [];
  const groups = [];
  let curG = bar[0].group == null ? 0 : bar[0].group;
  let count = 0;
  for (const b of bar) {
    const g = b.group == null ? 0 : b.group;
    if (g === curG) { count++; } else { groups.push(count); curG = g; count = 1; }
  }
  groups.push(count);
  return groups;
}

/**
 * Reassign group indices and accents from a groups array: each group's first beat
 * becomes 'accent'; a former group-first that is now interior demotes to 'normal';
 * 'ghost'/'rest' choices and per-beat subdivision are preserved. Returns a new bar.
 * @param {Beat[]} bar
 * @param {number[]} groups
 * @returns {Beat[]}
 */
export function regroupBar(bar, groups) {
  const out = bar.map((b) => ({ ...b }));
  let idx = 0;
  (groups || []).forEach((size, g) => {
    for (let k = 0; k < size && idx < out.length; k++, idx++) {
      const b = out[idx];
      b.group = g;
      if (k === 0) {
        if (b.accent !== 'rest') b.accent = 'accent';        // group downbeat
      } else if (b.accent === 'accent') {
        b.accent = 'normal';                                  // was a downbeat, now interior
      }
    }
  });
  return out;
}
```

- [ ] **Step 4: Add `meter.js` to `CORE_ASSETS` and bump `CACHE` (once for the package)**

In `web/sw.js`:

1. Add the module to `CORE_ASSETS`, immediately after the `'./js/music/tunings.js',` line:

```js
  './js/music/meter.js',
```

2. Bump `CACHE` **once** — increment its version integer by one. The running tree may already be past `v2` because Packages B–D shipped and each bumped it; increment from whatever is currently there. As it stood when this plan was written:

```js
const CACHE = 'tuner-cache-v2';
```
becomes
```js
const CACHE = 'tuner-cache-v3';
```

Tasks 3 and 4 add more `CORE_ASSETS` entries but do **not** bump `CACHE` again — Package E ships as one unit. Adding `meter.js` here (same task that creates it) keeps `test-sw-assets` green: the guard scans the whole shipped tree every run, so a file on disk that is not in the list turns the suite red.

- [ ] **Step 5: Run tests to verify they pass**

Run: `node web/test/run-all.js`
Expected: PASS — every `meter:` suite prints `PASS`, `test-sw-assets` stays green (`meter.js` is now both on disk and listed), summary `ALL TESTS PASSED`.

- [ ] **Step 6: Commit**

```bash
git add web/js/music/meter.js web/test/test-meter.js web/test/run-all.js web/sw.js
git commit -m "feat(meter): pure any-meter model (expandBar, additive, accents, tap tempo)"
```

---

### Task 3: `metronome.js` look-ahead scheduler + click synth + `test-metronome.js`

The one genuinely new Web-Audio primitive. Drift-free look-ahead scheduling on the sample clock; click voices shaped by `raisedCosineCurve`; nodes torn down on `ended`. **Not fully Node-testable** — `test-metronome.js` is a construction/clamp smoke test plus a check that the Package-D `raisedCosineCurve` export exists; the timing itself is verified manually in Task 5. Adds `metronome.js` to `CORE_ASSETS` (no `CACHE` re-bump).

**Files:**
- Create: `web/js/audio/metronome.js`
- Create: `web/test/test-metronome.js`
- Modify: `web/test/run-all.js`
- Modify: `web/sw.js` (add `metronome.js` to `CORE_ASSETS`)
- Modify (only if Package D absent): `web/js/audio/tone.js` (export `raisedCosineCurve`)

**Interfaces:**
- Consumes: `expandBar(bar, bpm)` from Task 2; `CONFIG.metronome` from Task 1; `raisedCosineCurve(peak, rising, points=64)` from `audio/tone.js` (exported by Package D — Global Constraints; guarded verify-or-add below).
- Produces: `class Metronome`:
  - `new Metronome({ audioContext: AudioContext, destination?: AudioNode, config?: object })` — throws without `audioContext`; does **not** touch the context until `start()`.
  - `setBpm(bpm: number) => number` (clamped to `[bpmMin,bpmMax]`, rounded); `get bpm()`.
  - `setBar(bar: Beat[]) => void` (applied at the next bar boundary while running; immediately when stopped).
  - `start() => void` / `stop() => void`; `get isRunning()`.
  - `pollBeat(nowSec: number) => number` — beat index whose scheduled time has passed (`-1` if none); drives the UI highlight from app.js's rAF.

- [ ] **Step 1: Write the failing test**

Create `web/test/test-metronome.js`:

```js
// Node SMOKE test for js/audio/metronome.js. The scheduler + click synth need a
// real AudioContext, so this covers ONLY: construction guards, bpm clamp, and the
// presence of the Package-D raisedCosineCurve export. Timing is verified manually.
import { suite, assert } from './assert.js';
import { Metronome } from '../js/audio/metronome.js';
import { raisedCosineCurve } from '../js/audio/tone.js';
import { CONFIG } from '../js/config.js';

// Minimal fake context: the ctor and setBpm/isRunning never call ctx methods.
const fakeCtx = () => ({ currentTime: 0 });

/** Registers and runs the metronome smoke suite. */
export default function run() {
  suite('metronome: construction guard', () => {
    let threw = false;
    try { new Metronome({}); } catch { threw = true; }
    assert(threw, 'ctor throws without audioContext');
    const m = new Metronome({ audioContext: fakeCtx() });
    assert(m.isRunning === false, 'isRunning false before start()');
  });

  suite('metronome: bpm clamp + round', () => {
    const m = new Metronome({ audioContext: fakeCtx() });
    assert(m.bpm === CONFIG.metronome.bpmDefault, 'default bpm = config default');
    m.setBpm(5);
    assert(m.bpm === CONFIG.metronome.bpmMin, 'below min clamps to bpmMin');
    m.setBpm(99999);
    assert(m.bpm === CONFIG.metronome.bpmMax, 'above max clamps to bpmMax');
    m.setBpm(128);
    assert(m.bpm === 128, 'in-range bpm kept');
    m.setBpm(120.6);
    assert(m.bpm === 121, 'fractional bpm rounded');
  });

  suite('metronome: pollBeat with no schedule → -1', () => {
    const m = new Metronome({ audioContext: fakeCtx() });
    assert(m.pollBeat(0) === -1, 'nothing queued → -1');
  });

  suite('metronome: Package-D raisedCosineCurve export present', () => {
    assert(typeof raisedCosineCurve === 'function', 'tone.js exports raisedCosineCurve');
    const c = raisedCosineCurve(1, true, 8);
    assert(c.length === 8, 'curve length honoured');
    assert(c[0] === 0 && Math.abs(c[c.length - 1] - 1) < 1e-9, 'rising curve runs 0 → peak');
  });
}
```

Register it in `web/test/run-all.js` (import + call):

```js
import runMetronome from './test-metronome.js';
```
```js
runMetronome();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node web/test/run-all.js`
Expected: FAIL — `[metronome: …] THREW: Cannot find module '../js/audio/metronome.js'`. (If Package D has **not** shipped, note that once `metronome.js` exists it will import `{ raisedCosineCurve }` from `tone.js`; Step 3 handles that export explicitly.)

- [ ] **Step 3: Verify (or add) the `raisedCosineCurve` export in `tone.js`**

Package D exports `raisedCosineCurve` from `web/js/audio/tone.js`. Check the current tree:

```bash
grep -n "export function raisedCosineCurve" web/js/audio/tone.js
```

- If it prints a match, do nothing.
- If it prints nothing (D not yet merged in this tree), change the declaration `function raisedCosineCurve(peak, rising, points = 64) {` to `export function raisedCosineCurve(peak, rising, points = 64) {` — add the `export` keyword only; leave the body and all `ReferenceTone` usage untouched.

(An ESM `import { raisedCosineCurve }` against a module that doesn't export it fails at load, so this must be in place before Step 5.)

- [ ] **Step 4: Write minimal implementation**

Create `web/js/audio/metronome.js`:

```js
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
```

- [ ] **Step 5: Add `metronome.js` to `CORE_ASSETS`**

In `web/sw.js`, add the module to `CORE_ASSETS`, immediately after the `'./js/audio/tone.js',` line:

```js
  './js/audio/metronome.js',
```

Do **not** bump `CACHE` again (Task 2 already bumped it once for the package).

- [ ] **Step 6: Run tests to verify they pass**

Run: `node web/test/run-all.js`
Expected: PASS — the four `metronome:` smoke suites print `PASS`, `test-sw-assets` stays green (`metronome.js` on disk and listed), summary `ALL TESTS PASSED`.

- [ ] **Step 7: Commit**

```bash
git add web/js/audio/metronome.js web/test/test-metronome.js web/test/run-all.js web/sw.js web/js/audio/tone.js
git commit -m "feat(metronome): drift-free look-ahead scheduler + raised-cosine click synth"
```

(If `tone.js` was unchanged in Step 3 because D already exported the curve, drop it from the `git add`.)

---

### Task 4: `metronome-view.js` two-tier view + metronome DOM + CSS

The zero-config face (big BPM, tap, start/stop, beat-pill row) and the one-tap-deeper editor (preset chips, beat-count stepper, per-pill accent cycling, per-pill subdivision). **Not Node-testable** (pure DOM); the automated gate is `test-sw-assets` (which goes red until the module is listed) plus a full visual pass in Task 5. Adds `metronome-view.js` to `CORE_ASSETS` (no `CACHE` re-bump). The view is instantiated by `app.js` in Task 5.

**Files:**
- Create: `web/js/ui/metronome-view.js`
- Modify: `web/index.html` (add the `#metronomeView` section shell + the editor container)
- Modify: `web/css/styles.css` (metronome face, beat pills, editor)
- Modify: `web/sw.js` (add `metronome-view.js` to `CORE_ASSETS`)

**Interfaces:**
- Consumes: `cycleAccent`, `makeAdditiveBar` from Task 2; `CONFIG.metronome` from Task 1.
- Produces: `class MetronomeView`:
  - `new MetronomeView(doc: Document, cb: { onStartStop:()=>void, onBpmChange:(bpm:number)=>void, onTap:()=>void, onBarChange:(bar:Beat[])=>void })`.
  - `setBpm(bpm)`, `setBar(bar)`, `setRunning(on)`, `highlightBeat(index)`.

- [ ] **Step 1: Add the metronome view shell to `index.html`**

In `web/index.html`, add this `<section>` immediately **after** the closing `</div>` of the tuning/settings sheet (i.e. after the `<div id="sheetEditor" hidden>…</div>` block's parent `.sheet` closes, before `</main>`). It starts `hidden`; `app.js` (Task 5) toggles it opposite the tuner view:

```html
    <!-- Metronome view (mutually exclusive with the tuner; toggled by app.js) -->
    <section class="met-view" id="metronomeView" hidden>
      <div class="met-face">
        <div class="met-bpm-row">
          <button class="met-step" id="metBpmDown" type="button" aria-label="Slower">−</button>
          <div class="met-bpm"><span id="metBpm">120</span><span class="met-bpm-unit">BPM</span></div>
          <button class="met-step" id="metBpmUp" type="button" aria-label="Faster">+</button>
        </div>
        <div class="met-pills" id="metPills"><!-- beat pills injected --></div>
        <div class="met-actions">
          <button class="met-tap" id="metTap" type="button">Tap</button>
          <button class="met-start" id="metStart" type="button">Start</button>
          <button class="met-edit" id="metEditBtn" type="button">Edit meter</button>
        </div>
        <div class="met-editor" id="metEditor" hidden><!-- editor injected --></div>
      </div>
    </section>
```

- [ ] **Step 2: Create the view module**

Create `web/js/ui/metronome-view.js`:

```js
// BROWSER. Two-tier metronome view: a zero-config face (BPM, tap, start/stop, beat
// pills) and a one-tap editor (presets, beat count, per-pill accent + subdivision).
// Pure view: callbacks out, setters in. Never touches audio/dsp.
import { CONFIG } from '../config.js';
import { cycleAccent, makeAdditiveBar } from '../music/meter.js';

// Editor presets → additive group sizes fed to makeAdditiveBar.
const PRESETS = [
  { label: '4/4', groups: [4] },
  { label: '3/4', groups: [3] },
  { label: '6/8', groups: [3, 3] },
  { label: '5/8', groups: [3, 2] },
  { label: '7/8', groups: [3, 2, 2] },
];
const ACCENT_CLASS = { accent: 'is-accent', normal: 'is-normal', ghost: 'is-ghost', rest: 'is-rest' };

export class MetronomeView {
  /**
   * @param {Document} doc
   * @param {Object} cb
   * @param {() => void} cb.onStartStop
   * @param {(bpm:number) => void} cb.onBpmChange
   * @param {() => void} cb.onTap
   * @param {(bar:Array) => void} cb.onBarChange  emitted whenever the meter is edited
   */
  constructor(doc, cb) {
    this.doc = doc;
    this.cb = cb;
    const $ = (id) => doc.getElementById(id);
    this.bpmEl = $('metBpm');
    this.pillsEl = $('metPills');
    this.editorEl = $('metEditor');
    this.startBtn = $('metStart');
    this.editBtn = $('metEditBtn');

    this._bpm = CONFIG.metronome.bpmDefault;
    this._bar = makeAdditiveBar([4]);
    this._editorOpen = false;

    $('metBpmDown').addEventListener('click', () => this._nudgeBpm(-1));
    $('metBpmUp').addEventListener('click', () => this._nudgeBpm(+1));
    $('metTap').addEventListener('click', () => this.cb.onTap());
    this.startBtn.addEventListener('click', () => this.cb.onStartStop());
    this.editBtn.addEventListener('click', () => this._toggleEditor());

    this.setBpm(this._bpm);
    this.setBar(this._bar);
  }

  /** @param {number} bpm */
  setBpm(bpm) {
    this._bpm = bpm;
    this.bpmEl.textContent = String(bpm);
  }

  /** @param {Array} bar */
  setBar(bar) {
    this._bar = Array.isArray(bar) && bar.length ? bar : makeAdditiveBar([4]);
    this._renderPills();
    if (this._editorOpen) this._renderEditor();
  }

  /** @param {boolean} on */
  setRunning(on) {
    this.startBtn.textContent = on ? 'Stop' : 'Start';
    this.startBtn.classList.toggle('is-on', !!on);
    if (!on) this.highlightBeat(-1);
  }

  /** Light the active beat pill; called from app.js's beat rAF. @param {number} index */
  highlightBeat(index) {
    const kids = this.pillsEl.children;
    for (let i = 0; i < kids.length; i++) kids[i].classList.toggle('is-active', i === index);
  }

  _nudgeBpm(delta) {
    const { bpmMin, bpmMax } = CONFIG.metronome;
    const next = Math.max(bpmMin, Math.min(bpmMax, this._bpm + delta));
    this.setBpm(next);
    this.cb.onBpmChange(next);
  }

  _emitBar() { this.cb.onBarChange(this._bar.map((b) => ({ ...b }))); }

  _renderPills() {
    const doc = this.doc;
    this.pillsEl.innerHTML = '';
    this._bar.forEach((beat) => {
      const pill = doc.createElement('span');
      pill.className = 'met-pill ' + (ACCENT_CLASS[beat.accent] || 'is-normal');
      if (beat.subdivision > 1) pill.dataset.sub = String(beat.subdivision);
      this.pillsEl.appendChild(pill);
    });
  }

  _toggleEditor() {
    this._editorOpen = !this._editorOpen;
    this.editorEl.hidden = !this._editorOpen;
    this.editBtn.classList.toggle('is-on', this._editorOpen);
    if (this._editorOpen) this._renderEditor();
  }

  _renderEditor() {
    const doc = this.doc;
    const ed = this.editorEl;
    ed.innerHTML = '';

    // preset chips
    const presetRow = doc.createElement('div');
    presetRow.className = 'met-presets';
    PRESETS.forEach((p) => {
      const chip = doc.createElement('button');
      chip.type = 'button';
      chip.className = 'met-chip';
      chip.textContent = p.label;
      chip.addEventListener('click', () => {
        this._bar = makeAdditiveBar(p.groups);
        this._renderPills();
        this._renderEditor();
        this._emitBar();
      });
      presetRow.appendChild(chip);
    });
    ed.appendChild(presetRow);

    // beat-count stepper
    const countRow = doc.createElement('div');
    countRow.className = 'met-count';
    const minus = doc.createElement('button');
    minus.type = 'button'; minus.className = 'met-step'; minus.textContent = '−';
    minus.addEventListener('click', () => this._setBeatCount(this._bar.length - 1));
    const label = doc.createElement('span');
    label.className = 'met-count-label';
    label.textContent = `${this._bar.length} beats`;
    const plus = doc.createElement('button');
    plus.type = 'button'; plus.className = 'met-step'; plus.textContent = '+';
    plus.addEventListener('click', () => this._setBeatCount(this._bar.length + 1));
    countRow.appendChild(minus); countRow.appendChild(label); countRow.appendChild(plus);
    ed.appendChild(countRow);

    // editable pills: tap the pill cycles accent; the ×N button cycles subdivision
    const editPills = doc.createElement('div');
    editPills.className = 'met-editpills';
    this._bar.forEach((beat, i) => {
      const cell = doc.createElement('div');
      cell.className = 'met-editcell';

      const pill = doc.createElement('button');
      pill.type = 'button';
      pill.className = 'met-pill met-editpill ' + (ACCENT_CLASS[beat.accent] || 'is-normal');
      pill.textContent = String(i + 1);
      pill.title = 'Tap to cycle accent';
      pill.addEventListener('click', () => {
        beat.accent = cycleAccent(beat.accent);
        this._renderPills();
        this._renderEditor();
        this._emitBar();
      });

      const sub = doc.createElement('button');
      sub.type = 'button';
      sub.className = 'met-subbtn';
      sub.textContent = '×' + (beat.subdivision || 1);
      sub.title = 'Tap to cycle subdivision';
      sub.addEventListener('click', () => {
        const subs = CONFIG.metronome.subdivisions;
        const idx = subs.indexOf(beat.subdivision || 1);
        beat.subdivision = subs[(idx + 1) % subs.length];
        this._renderPills();
        this._renderEditor();
        this._emitBar();
      });

      cell.appendChild(pill); cell.appendChild(sub);
      editPills.appendChild(cell);
    });
    ed.appendChild(editPills);
  }

  _setBeatCount(n) {
    const { beatCountMin, beatCountMax } = CONFIG.metronome;
    n = Math.max(beatCountMin, Math.min(beatCountMax, n));
    if (n === this._bar.length) return;
    if (n > this._bar.length) {
      while (this._bar.length < n) this._bar.push({ accent: 'normal', subdivision: 1, group: 0 });
    } else {
      this._bar = this._bar.slice(0, n);
    }
    this._renderPills();
    this._renderEditor();
    this._emitBar();
  }
}
```

- [ ] **Step 3: Add the CSS**

In `web/css/styles.css`, append the metronome styles at the end of the file. (Colours reuse the existing `--accent`, `--accent-in`, `--bg-*`, `--muted-*` theme tokens so both themes work; no new tokens needed.)

```css
/* ---------- Package E: metronome view ---------- */
.met-view { display: flex; flex-direction: column; align-items: center; gap: 22px; padding: 24px 16px; }
.met-bpm-row { display: flex; align-items: center; gap: 20px; }
.met-bpm { font-size: 64px; font-weight: 600; line-height: 1; display: flex; align-items: baseline; gap: 8px; }
.met-bpm-unit { font-size: 16px; color: var(--muted-2); font-weight: 500; }
.met-step { width: 44px; height: 44px; border-radius: 12px; border: 1px solid var(--muted-2);
  background: transparent; color: inherit; font-size: 22px; cursor: pointer; }
.met-step:active { transform: scale(0.94); }

.met-pills { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; max-width: 320px; }
.met-pill { width: 20px; height: 20px; border-radius: 50%; background: var(--muted-2); position: relative;
  transition: transform 60ms ease, background-color 60ms ease, box-shadow 60ms ease; }
.met-pill.is-accent { background: var(--accent); }
.met-pill.is-normal { background: var(--muted-2); }
.met-pill.is-ghost  { background: var(--muted-2); opacity: 0.4; }
.met-pill.is-rest   { background: transparent; border: 1px dashed var(--muted-2); }
.met-pill[data-sub]::after { content: attr(data-sub); position: absolute; top: -14px; left: 50%;
  transform: translateX(-50%); font-size: 10px; color: var(--muted-2); }
.met-pill.is-active { transform: scale(1.4); box-shadow: 0 0 12px var(--accent-in); background: var(--accent-in); }

.met-actions { display: flex; gap: 12px; flex-wrap: wrap; justify-content: center; }
.met-tap, .met-start, .met-edit { padding: 12px 22px; border-radius: 12px; border: 1px solid var(--muted-2);
  background: transparent; color: inherit; font-size: 15px; cursor: pointer; }
.met-start.is-on { background: var(--accent); border-color: var(--accent); color: #06121a; }
.met-edit.is-on { border-color: var(--accent); }

.met-editor { width: 100%; max-width: 340px; display: flex; flex-direction: column; gap: 14px; margin-top: 6px; }
.met-presets { display: flex; gap: 8px; flex-wrap: wrap; }
.met-chip { padding: 8px 14px; border-radius: 999px; border: 1px solid var(--muted-2);
  background: transparent; color: inherit; cursor: pointer; }
.met-count { display: flex; align-items: center; gap: 14px; justify-content: center; }
.met-count-label { min-width: 72px; text-align: center; color: var(--muted-2); }
.met-editpills { display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; }
.met-editcell { display: flex; flex-direction: column; align-items: center; gap: 6px; }
.met-editpill { width: 34px; height: 34px; border-radius: 8px; border: none; color: #06121a;
  font-size: 13px; cursor: pointer; }
.met-editpill.is-ghost, .met-editpill.is-rest { color: var(--muted-2); }
.met-subbtn { font-size: 11px; padding: 2px 8px; border-radius: 6px; border: 1px solid var(--muted-2);
  background: transparent; color: var(--muted-2); cursor: pointer; }
@media (prefers-reduced-motion: reduce) {
  .met-pill { transition: none; }
}
```

- [ ] **Step 4: Add `metronome-view.js` to `CORE_ASSETS`**

In `web/sw.js`, add the module to `CORE_ASSETS`, immediately after the `'./js/ui/graph.js',` line:

```js
  './js/ui/metronome-view.js',
```

Do **not** bump `CACHE` again.

- [ ] **Step 5: Run tests to verify they pass**

Run: `node web/test/run-all.js`
Expected: PASS — no new suite here, but `test-sw-assets` must stay green now that `metronome-view.js` is both on disk and in `CORE_ASSETS`. Summary `ALL TESTS PASSED`. (If you skip the `CORE_ASSETS` add, `sw: CORE_ASSETS covers every shipped runtime asset` FAILs with `missing: ./js/ui/metronome-view.js` — proof the guard bites.)

- [ ] **Step 6: Manual smoke (shell only — full interaction lands in Task 5)**

```bash
node serve.mjs 8173
```

At `http://localhost:8173`, in DevTools → Elements, remove the `hidden` attribute on `<section id="metronomeView">`. Expected: the BPM row, an (empty until Task 5) pill row, and the Tap/Start/Edit buttons render and are styled in both themes (toggle theme via the sheet). Restore `hidden`. (The view is not wired to audio yet — that is Task 5.)

- [ ] **Step 7: Commit**

```bash
git add web/js/ui/metronome-view.js web/index.html web/css/styles.css web/sw.js
git commit -m "feat(metronome): two-tier metronome view (face + meter editor) + styles"
```

---

### Task 5: `app.js` mode navigation + full integration + persistence

Bring it live: `state.uiMode`, the header **Tuner | Metronome** segmented control, mutually-exclusive mode switching (mic release/restart), master-bus wiring, the `Metronome` + `MetronomeView` instances, the beat-highlight rAF, tap tempo, and BPM/meter persistence. This is the timing-critical task — verified manually (drift, backgrounding, no-clip). Spec §7.1. No new module, so **no `CORE_ASSETS`/`CACHE` change**.

**Running-metronome-on-mode-switch decision:** switching back to Tuner **stops** the metronome. Rationale (one line): the modes are mutually exclusive and the tuner reclaims the mic, so a still-running metronome would bleed audible clicks into the mic input (corrupting pitch detection) from a sound source the user can no longer see to stop.

**Files:**
- Modify: `web/js/app.js`
- Modify: `web/index.html` (mode-nav in the header; wrap the tuner sections in `#tunerView`)

**Interfaces:**
- Consumes: `Metronome` (Task 3), `MetronomeView` (Task 4), `makeAdditiveBar`/`tapTempoBpm` (Task 2), `CONFIG.metronome` (Task 1), `store.get/set` (Package A), the master gain bus (Package D — guarded).
- Produces: no new exports; `state.uiMode`, mode switching, and metronome wiring inside `app.js`.

- [ ] **Step 1: Add the mode-nav + wrap the tuner view in `index.html`**

In `web/index.html`:

1. Add the segmented mode-nav to the `<header class="hdr">`, immediately after the opening `<header …>` tag (before `#autoBtn`):

```html
      <div class="mode-nav" id="modeNav" role="tablist" aria-label="Mode">
        <button class="mode-btn is-on" id="navTuner" type="button" aria-pressed="true">Tuner</button>
        <button class="mode-btn" id="navMet" type="button" aria-pressed="false">Metronome</button>
      </div>
```

2. Wrap the tuner-only content in a `#tunerView` div. Add `<div id="tunerView">` immediately **after** the closing `</header>` (before `<div class="spacer">`), and its closing `</div>` immediately **before** the `<!-- Metronome view -->` `<section id="metronomeView">` added in Task 4. Everything between — the spacers, `.stage`, `.strings`, tone button, tuning label, start overlay, and the tuning sheet — is inside `#tunerView`. (The header, with the mode-nav, stays outside so it is shared.)

3. Add the mode-nav CSS to `web/css/styles.css` (append near the Package E block):

```css
.mode-nav { display: inline-flex; gap: 2px; background: var(--bg-bot); border-radius: 999px; padding: 3px; }
.mode-btn { border: none; background: transparent; color: var(--muted-2); padding: 6px 14px;
  border-radius: 999px; font-size: 13px; cursor: pointer; }
.mode-btn.is-on { background: var(--accent); color: #06121a; }
```

- [ ] **Step 2: Import the metronome modules + add state**

In `web/js/app.js`, add these imports after the existing `import { Controls } from './ui/controls.js';` line:

```js
import { Metronome } from './audio/metronome.js';
import { MetronomeView } from './ui/metronome-view.js';
import { makeAdditiveBar, tapTempoBpm } from './music/meter.js';
```

Add these fields to the `state` object (inside the `const state = { … }` literal, after `customTunings: [],`):

```js
  uiMode: 'tuner',           // 'tuner' | 'metronome' — mutually exclusive
  wasRunning: false,         // was the mic running when we left the tuner?
  metBpm: CONFIG.metronome.bpmDefault,
  metBar: makeAdditiveBar([4]),
```

Add these module-level vars alongside the existing `let rafId = 0;` / `let lastStringIndex = null;` block:

```js
/** @type {GainNode} */ let masterGain = null;
/** @type {Metronome} */ let metronome = null;
let metRafId = 0;
let tapTimes = [];
```

- [ ] **Step 3: Restore persisted BPM + meter**

In `web/js/app.js`, in the "restore persisted state" area (right after the existing `loadCustoms();` / last-tuning IIFE), add:

```js
// Metronome persistence (Package A store.js). metBar is a plain bar array.
(() => {
  const bpm = store.get('tuner-met-bpm', CONFIG.metronome.bpmDefault);
  if (typeof bpm === 'number') {
    state.metBpm = Math.max(CONFIG.metronome.bpmMin, Math.min(CONFIG.metronome.bpmMax, Math.round(bpm)));
  }
  const bar = store.get('tuner-met-bar', null);
  if (Array.isArray(bar) && bar.length) state.metBar = bar;
})();
function persistMet() {
  store.set('tuner-met-bpm', state.metBpm);
  store.set('tuner-met-bar', state.metBar);
}
```

- [ ] **Step 4: Wire the master bus + metronome into `ensureAudioContext`**

In `web/js/app.js`, replace `ensureAudioContext()` with the version below. It creates the **master gain bus** and the `Metronome`. If Package D already added `masterGain` here, keep D's line and do not duplicate it — the `if (!masterGain)` guard makes this safe either way:

```js
async function ensureAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    // Master gain bus (Package D). Guarded so this is a no-op if D already made it.
    if (!masterGain) {
      masterGain = audioCtx.createGain();
      masterGain.gain.value = 1;
      masterGain.connect(audioCtx.destination);
    }
    // ReferenceTone gains an optional `destination` in D; an older ctor ignores the
    // extra arg and stays on ctx.destination (still works).
    tone = new ReferenceTone({ audioContext: audioCtx, destination: masterGain });
    metronome = new Metronome({ audioContext: audioCtx, destination: masterGain });
    metronome.setBpm(state.metBpm);
    metronome.setBar(state.metBar);
  }
  if (audioCtx.state === 'suspended') await audioCtx.resume();
}
```

- [ ] **Step 5: Instantiate the view + wire its callbacks**

In `web/js/app.js`, after the `const controls = new Controls(document, { … });` block (and its initial `controls.set…` calls), add:

```js
/* ---------- metronome view + mode nav ---------- */
const metView = new MetronomeView(document, {
  onStartStop: toggleMetronome,
  onBpmChange: (bpm) => {
    state.metBpm = bpm;
    if (metronome) metronome.setBpm(bpm);
    persistMet();
  },
  onTap: handleTap,
  onBarChange: (bar) => {
    state.metBar = bar;
    if (metronome) metronome.setBar(bar);
    persistMet();
  },
});
metView.setBpm(state.metBpm);
metView.setBar(state.metBar);

document.getElementById('navTuner').addEventListener('click', () => setUiMode('tuner'));
document.getElementById('navMet').addEventListener('click', () => setUiMode('metronome'));

async function toggleMetronome() {
  await ensureAudioContext();
  if (metronome.isRunning) {
    metronome.stop();
    metView.setRunning(false);
  } else {
    metronome.setBpm(state.metBpm);
    metronome.setBar(state.metBar);
    metronome.start();
    metView.setRunning(true);
  }
}

function handleTap() {
  const now = performance.now();
  if (tapTimes.length && now - tapTimes[tapTimes.length - 1] > CONFIG.metronome.tapResetMs) tapTimes = [];
  tapTimes.push(now);
  const bpm = tapTempoBpm(tapTimes);
  if (bpm != null) {
    state.metBpm = bpm;
    metView.setBpm(bpm);
    if (metronome) metronome.setBpm(bpm);
    persistMet();
  }
}

/** Beat-highlight loop — polls the sample-clock schedule, not wall time. */
function metLoop() {
  metRafId = requestAnimationFrame(metLoop);
  if (!audioCtx || !metronome || !metronome.isRunning) return;
  const bi = metronome.pollBeat(audioCtx.currentTime);
  if (bi >= 0) metView.highlightBeat(bi);
}

function setUiMode(mode) {
  if (mode === state.uiMode) return;
  state.uiMode = mode;
  const toMet = mode === 'metronome';

  document.getElementById('tunerView').hidden = toMet;
  document.getElementById('metronomeView').hidden = !toMet;
  const navTuner = document.getElementById('navTuner');
  const navMet = document.getElementById('navMet');
  navTuner.classList.toggle('is-on', !toMet);
  navMet.classList.toggle('is-on', toMet);
  navTuner.setAttribute('aria-pressed', String(!toMet));
  navMet.setAttribute('aria-pressed', String(toMet));

  if (toMet) {
    // Leave the tuner: release the mic + stop its rAF loop; remember whether it ran.
    state.wasRunning = state.running;
    cancelAnimationFrame(rafId);
    if (capture) capture.stop();
    state.running = false;
    controls.setMicState('idle');
    stopTone();
    cancelAnimationFrame(metRafId);
    metLoop();
  } else {
    // Return to the tuner: STOP the metronome (modes are exclusive), stop its loop,
    // and restart the mic only if it had been running.
    if (metronome) metronome.stop();
    metView.setRunning(false);
    cancelAnimationFrame(metRafId);
    if (state.wasRunning) startMic();
  }
}
```

- [ ] **Step 6: Clean up the metronome on unload**

In `web/js/app.js`, extend the existing `beforeunload` handler so a running metronome and its loop are stopped too:

```js
window.addEventListener('beforeunload', () => {
  cancelAnimationFrame(rafId);
  cancelAnimationFrame(metRafId);
  if (metronome) metronome.stop();
  if (capture) capture.stop();
});
```

- [ ] **Step 7: Run tests (no regressions)**

Run: `node web/test/run-all.js`
Expected: PASS — `ALL TESTS PASSED`. This task changes only browser code + HTML, so the full suite (meter/config/metronome/sw-assets included) must stay green.

- [ ] **Step 8: Manual verification — the timing-critical pass**

```bash
node serve.mjs 8173
```

At `http://localhost:8173`:

1. **Mode switch + mic release.** Start the mic (tuner works). Tap **Metronome** in the header — the tuner view hides, the metronome view shows, and the mic indicator returns to idle. Confirm in DevTools → Application → the `getUserMedia` track is stopped (the browser mic indicator turns off). Tap **Tuner** — the mic restarts automatically (because it had been running).
2. **Running metronome stops on return.** In Metronome, press **Start** (steady clicks). Switch to **Tuner** — the clicks stop immediately (decision above). Switch back to Metronome — it is stopped (Start shown), not still running.
3. **Face works.** Big BPM, **−/＋** change tempo, **Tap** four times at a steady pace sets BPM (matches your tapping), **Start/Stop** toggles the click and the active beat pill highlights on each downbeat/beat.
4. **Editor works.** Tap **Edit meter**: preset chips (4/4, 3/4, 6/8, 5/8, 7/8) change the pill row; **−/＋ beats** grows/shrinks; tap a numbered pill to cycle accent (accent → ghost → rest → normal); the **×N** button cycles subdivision. Edits apply at the next bar boundary while running (no restart), and audibly: accent is brighter/louder, ghost quiet, rest silent, subdivisions fill the beat.
5. **No drift (the whole feature).** Set 4/4 at 120, Start, and let it run **several minutes** against a phone/watch metronome or the seconds hand — the two must stay locked (no creeping ahead/behind). Absolute times accumulate from a fixed bar start, so there should be zero drift.
6. **Survives tab backgrounding.** With the metronome running, switch to another tab for ~30 s, then return — the beat is still on time and in phase (the sample clock kept running; the pump caught up), not jittery or halted.
7. **No pops.** Each click is clean (raised-cosine attack/release) — no clicks-on-the-click.
8. **No clipping alongside a reference tone.** Switch to Tuner, pin a string and play its reference tone (speaker button); switch back and Start the metronome... note the modes are exclusive so they don't actually overlap — instead verify the master bus itself: within Package D's chime + tone, and here the metronome, all sit under `masterGain` (gain 1) so no single voice drives the output past 0 dBFS (watch for no crackle at max BPM/accent). Confirm the metronome master gain is `CONFIG.metronome.gain` (0.9), leaving headroom.
9. **Persistence.** Change BPM + meter, reload — the BPM and meter are restored (via `store.js`).

- [ ] **Step 9: Commit**

```bash
git add web/js/app.js web/index.html web/css/styles.css
git commit -m "feat(metronome): mode navigation + master-bus wiring + tap tempo + persistence"
```

---

## Self-Review

**Spec coverage (spec §7 Package E) — a task per requirement:**
- §7.1 Mode navigation (Tuner|Metronome, mutually exclusive, mic release/restart, views toggled by `hidden`) → Task 5. ✓ Running-metronome-on-switch decided: switch-to-Tuner stops the metronome (justified inline). ✓
- §7.2 Meter model (`meter.js`, pure, Node-tested; `expandBar`, additive, accents, subdivisions, tap tempo) → Task 2 with the full case table (4/4, 5/8, 3+2+2, subdivisions 1..4, rest, ghost, tap averaging/clamp/reset, regroup). ✓
- §7.3 Scheduler + click synth (`metronome.js`, look-ahead pump on `ctx.currentTime`, drift-free absolute accumulation, raised-cosine clicks through the master bus, `disconnect()` on `ended`) → Task 3 + smoke test. ✓
- §7.4 UI two-tier (face + editor; presets, beat count, per-pill accent + subdivision) + persistence → Task 4 (view/DOM/CSS) + Task 5 (wiring, `store.js` persistence). ✓
- §1.3/§7.5 `CONFIG.metronome` single source of truth (deep-frozen; scheduler window > pump period relationship) → Task 1 + `test-config.js`. ✓
- Deferred (count-in / bar counter / auto-accelerate) → honored; not implemented (Global Constraints). ✓

**Not Node-testable — stated honestly:** the Web Audio scheduler timing and the DOM view. `test-metronome.js` is a construction/clamp/export smoke test only; drift, backgrounding, pops, and headroom are the manual steps in Task 5 Step 8. ✓

**Cache-list discipline:** each of the three new shipped modules (`meter.js`, `metronome.js`, `metronome-view.js`) is added to `CORE_ASSETS` in the **same task** that creates it (Tasks 2, 3, 4), so `test-sw-assets` never goes red between tasks; `CACHE` is bumped exactly **once** (Task 2). ✓

**Placeholder scan:** no TBD/TODO; every implementation step shows complete code and an exact `node web/test/run-all.js` run with its expected pass/fail line. ✓

**Symbol/path consistency vs. the File Structure block above:** `meter.js` exports `expandBar, makeAdditiveBar, cycleAccent, tapTempoBpm, groupsFromBar, regroupBar, ACCENT_CYCLE` (Task 2) — all present and used exactly. `expandBar(bar, bpm) → [{timeOffsetSec, level}]`; beat-first carries accent level, subdivisions `'sub'`, rests silent — consistent across meter/metronome/tests. `Metronome`/`MetronomeView` constructor shapes match their call sites in Task 5. `state.uiMode` (not `state.mode`, which stays the DSP profile). `store.get/set` signatures match Package A. Test files `test-meter.js`, `test-config.js`, `test-metronome.js` created and registered in `run-all.js`. ✓

**Ordering:** Task 1 (config) precedes everything that reads `CONFIG.metronome`; Task 2 (meter) precedes Task 3/4/5 that import it; Task 3 (scheduler) and Task 4 (view) precede Task 5 (integration). ✓

**One inconsistency corrected in the pre-existing file:** Global Constraints stated the pre-package baseline as **294** assertions; the current branch baseline is **319** (and B/D land before E), so it now reads 319 with a "whatever is green when the task starts" note. ✓
