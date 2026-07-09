# Package F — Accessibility pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the tuner usable and correct for screen-reader, colour-blind, low-vision, and reduced-motion users, covering every control introduced across Packages B (instrument chip row, custom-tuning editor + note picker), D (dial⇄strobe toggle, haptics/chime settings, mic primer + Retry), and E (Tuner|Metronome mode nav, BPM face, tap-tempo, beat pills, meter editor sheet) in one final pass.

**Architecture:** Six independent slices, each grounded in `DisplayState`/existing DOM, with pure logic extracted wherever the underlying decision is not itself DOM/timing:
1. **Spoken note** — a visually-hidden `aria-live="polite"` region in `controls.js`, fed by a new pure formatter (`note-status.js`) that returns a fresh announcement only when the note (name+octave) or the in-tune boolean changes — keyed, not timer-throttled, so it never fires per rAF tick even though `controls.update(ds)` runs ~60×/sec.
2. **Focus-trapped sheet** — `openSheet()`/`closeSheet()` gain focus-in, a Tab/Shift-Tab trap (stepped by a pure `focus-order.js` helper), `Escape`-to-close, and return-focus-to-trigger, layered on top of the existing scrim-tap and "Done" paths without replacing them.
3. **Labels/roles** — `aria-pressed`/`aria-label` on every toggle-like control that exists today (string circles, instrument segment, theme toggle, reference-tone button) plus an explicit, grep-verified checklist for the equivalent B/D/E controls (instrument chips, note picker, dial⇄strobe toggle, haptics/chime switches, mic Retry, mode nav, BPM/tap-tempo, beat pills, meter editor sheet).
4. **Redundant in-tune cue** — the dial indicator becomes a *ring* (not a colour swap) and the active string circle grows a checkmark badge when in tune; the visual state label already gets a `✓` prefix as part of the note-status formatter.
5. **High-contrast theme** — a third `[data-theme="contrast"]` token block (near-black background, pure-white/high-luminance ink, blue/yellow accent pair) added to the existing CSS-token system that `graph.setColors()`/`pushGraphColors()` already repaint from; the single theme-toggle button becomes a 3-way cycle (dark → light → contrast → dark) driven by a new pure `theme-cycle.js`.
6. **Reduced motion** — the existing (partial) `prefers-reduced-motion` CSS block is extended to cover every current decorative animation (including the sheet's slide-up), plus a tiny `motion.js` helper (`prefersReducedMotion()`) for JS-driven canvas motion that CSS can't gate (D's strobe phase drift).

**Tech Stack:** Vanilla ES modules (no build step), the repo's zero-dependency Node test harness (`web/test/assert.js` + `run-all.js`), native `aria-live`/focus APIs, CSS custom properties + `prefers-reduced-motion`.

## Global Constraints

- **No build step.** Hand-authored ES modules served as-is; no bundler/transpiler; no npm runtime dependencies. (verbatim from spec §1.1)
- **Pure vs. browser split.** `js/config.js`, `js/music/*`, and `js/dsp/*` are pure and Node-safe (no `window`/`document`/`AudioContext`/`performance`/`Date`); only `js/audio/*`, `js/ui/*`, and `js/app.js` touch browser APIs. **New pure logic goes in pure modules so it stays testable.** (spec §1.2) This plan's three new pure modules — `js/ui/note-status.js`, `js/ui/focus-order.js`, `js/theme-cycle.js` — are Node-safe despite two of them living under `js/ui/`, the same way `js/store.js` is a Node-safe helper consumed by browser code; each file's header comment says so explicitly.
- **`CONFIG` is the single source of truth**, deep-frozen. All new numeric parameters go into `CONFIG`, never inline literals or globals. (spec §1.3) Package F introduces **no new numeric `CONFIG` parameters.** The one numeric threshold it touches (the 15-cent "ALMOST" boundary) is *relocated as-is* from its existing inline literal in `controls.js` into `note-status.js` — it was already inline before this package, so moving it verbatim is not a new violation; centralizing it into `CONFIG` is out of scope for this pass.
- **The Stabilizer is the only numeric smoother** and emits one `DisplayState` per frame; the UI renders `DisplayState` and nothing else. (spec §1.4) The live region and the state label are built only from `DisplayState` fields (`status`, `noteName`, `octave`, `cents`, `inTune`) — never from DSP internals.
- **localStorage access is always wrapped in try/catch** and tolerant of absence. (spec §1.7) The third theme value flows through the existing `store.js` wrapper (Package A) — no new direct `localStorage` calls are added.
- **Cache-list discipline:** `CORE_ASSETS` is hand-maintained; any file added/removed later must be reflected in it, and `CACHE` is bumped per *released* package. `test-sw-assets` enforces coverage. (spec §3)
- Test harness idiom: each suite file default-exports a `run()` that calls `suite(name, fn)` + `assert`/`assertClose`, and is registered in `web/test/run-all.js`. Full suite is `node web/test/run-all.js` (exit 1 on any failure).
- **No jsdom, no npm dev/runtime dependencies of any kind.** Spec §8's "Tests" section mentions an *optional* jsdom/Playwright smoke test — this repo's constraints rule that out entirely. Anything that requires a live DOM (focus movement, `aria-live` announcements actually reaching a screen reader, `Escape` handling, `prefers-reduced-motion` rendering) is **manual-only**, called out per task. Where a decision *behind* that DOM behaviour is pure (throttling logic, tab-index stepping, theme-cycle order), it is extracted and unit-tested instead.
- **Sequential shared-file integration.** Packages B, D, and E land before F and each modify `web/js/app.js`, `web/js/ui/controls.js`, `web/index.html`, `web/css/styles.css`, and `web/sw.js` — the same files this plan touches. **Before starting any task below, re-read the current contents of the file(s) it touches.** This plan was authored against the tree as it exists after Package A only (the most recent commit at authoring time is `7cbc4b3`); the exact line numbers/snippets quoted below are for orientation, not a guarantee of what B/D/E left behind. Where a task references a B/D/E-introduced element whose exact selector/id isn't yet knowable, it says so and gives a `grep` command to locate the real thing first.
- Out of Package F: a full automated axe/Lighthouse CI gate (spec §8 lists it as manual); a dedicated theme *picker* UI (kept as a 3-way cycle on the existing single button — see Task 7's rationale).

---

## File Structure

New:
- `web/js/ui/note-status.js` — pure: `stateLabelFor(ds)` (visual label incl. non-colour checkmark) + `announcementFor(ds, prevKey)` (throttled spoken-note text) + `spokenNoteName(name)`.
- `web/test/test-note-status.js` — unit tests for the above.
- `web/js/ui/focus-order.js` — pure: `nextFocusIndex(count, currentIndex, shiftKey)`, the sheet's Tab-trap stepper.
- `web/test/test-focus-order.js` — unit tests for the above.
- `web/test/test-a11y-markup.js` — static text guard (reads `index.html`/`controls.js` as text) confirming the a11y hooks this package adds are present; **not** a behavior test.
- `web/js/theme-cycle.js` — pure: `THEME_ORDER`, `nextTheme(current)`, `THEME_LABEL`.
- `web/test/test-theme-cycle.js` — unit tests for the above.
- `web/js/ui/motion.js` — browser: `prefersReducedMotion()`, a one-line `matchMedia` wrapper for JS-driven (canvas) motion; no dedicated Node test (trivial + browser-only, see Task 8).

Changed:
- `web/js/ui/controls.js` — live region wiring, focus trap, labels/roles on existing controls, theme-cycle button wiring, in-tune checkmark badge trigger (CSS-driven).
- `web/index.html` — live-region node, `.sheet` `tabindex="-1"`, aria attributes on existing markup, `themeBtn` initial label.
- `web/css/styles.css` — `.sr-only` utility, contrast theme tokens, non-colour in-tune shape CSS, extended `prefers-reduced-motion` block.
- `web/js/app.js` — `THEME_COLORS.contrast`, wires `controls.setTheme(...)`.
- `web/sw.js` — add the new modules to `CORE_ASSETS`; bump `CACHE`.
- `web/test/run-all.js` — register the four new suites.
- *(Conditional, Task 8 only, if already present from D/E)* `web/js/ui/strobe.js`, `web/js/ui/metronome-view.js` — add a `prefersReducedMotion()` gate to their animation loops.

---

### Task 1: Pure spoken-note formatter (`note-status.js`)

**Files:**
- Create: `web/js/ui/note-status.js`
- Create: `web/test/test-note-status.js`
- Modify: `web/test/run-all.js`

**Interfaces:**
- Consumes: `DisplayState` shape from `web/js/dsp/stabilizer.js` (`status`, `noteName`, `octave`, `cents`, `inTune`) — read-only, no import needed (duck-typed).
- Produces: `spokenNoteName(noteName: string) => string`; `stateLabelFor(ds) => string`; `announcementFor(ds, prevKey: string|null) => {text: string|null, key: string|null} | null`.

- [ ] **Step 1: Write the failing test**

Create `web/test/test-note-status.js`:

```js
// Node. Cases for js/ui/note-status.js — the pure DisplayState -> text formatter
// shared by the visual state label and the throttled spoken-note announcement.
import { suite, assert } from './assert.js';
import { spokenNoteName, stateLabelFor, announcementFor } from '../js/ui/note-status.js';

function ds(overrides) {
  return {
    status: 'active', noteName: 'E', octave: 4, midi: 64, cents: 0, frequency: 329.63,
    inTune: true, stringIndex: 0, targetMidi: 64, confidence: 1,
    noiseFloorDb: -70, rawFrequency: 329.63, clarity: 0.95, rmsDb: -30,
    ...overrides,
  };
}

export default function run() {
  suite('spokenNoteName: sharp pronunciation', () => {
    assert(spokenNoteName('E') === 'E', "natural note passes through");
    assert(spokenNoteName('F#') === 'F sharp', "'F#' -> 'F sharp'");
    assert(spokenNoteName('C#') === 'C sharp', "'C#' -> 'C sharp'");
  });

  suite('stateLabelFor: blank states', () => {
    assert(stateLabelFor(ds({ status: 'silent', noteName: null })) === '', 'silent -> empty');
    assert(stateLabelFor(ds({ status: 'rejected', noteName: null })) === '', 'rejected -> empty');
  });

  suite('stateLabelFor: in-tune carries a non-colour (checkmark) cue', () => {
    assert(stateLabelFor(ds({ inTune: true, cents: 2 })) === '✓ IN TUNE', 'in tune -> checkmark label');
    assert(stateLabelFor(ds({ status: 'hold', inTune: true, cents: 0 })) === '✓ IN TUNE', 'hold+in-tune same as active');
  });

  suite('stateLabelFor: almost / flat / sharp thresholds', () => {
    assert(stateLabelFor(ds({ inTune: false, cents: -10 })) === 'ALMOST ♭', '|cents|<=15 flat -> ALMOST ♭');
    assert(stateLabelFor(ds({ inTune: false, cents: 12 })) === 'ALMOST ♯', '|cents|<=15 sharp -> ALMOST ♯');
    assert(stateLabelFor(ds({ inTune: false, cents: -30 })) === 'FLAT ♭', '|cents|>15 flat -> FLAT ♭');
    assert(stateLabelFor(ds({ inTune: false, cents: 40 })) === 'SHARP ♯', '|cents|>15 sharp -> SHARP ♯');
  });

  suite('announcementFor: throttled to note/in-tune changes, never per-frame', () => {
    let key = null;

    const a1 = announcementFor(ds({ status: 'silent', noteName: null }), key);
    assert(a1 === null, 'silent on first call -> no announcement');

    const a2 = announcementFor(ds({ noteName: 'E', octave: 4, inTune: true, cents: 1 }), key);
    assert(a2 && a2.text === 'E, in tune', 'first active in-tune reading announces');
    key = a2.key;

    const a3 = announcementFor(ds({ noteName: 'E', octave: 4, inTune: true, cents: 2 }), key);
    assert(a3 === null, 'same note+state next frame -> no re-announcement (throttled)');

    const a4 = announcementFor(ds({ noteName: 'F#', octave: 4, inTune: false, cents: -8 }), key);
    assert(a4 && a4.text === 'F sharp, 8 cents flat', "sharp note pronounced 'F sharp'; flat cents phrased");
    key = a4.key;

    const a5 = announcementFor(ds({ noteName: 'F#', octave: 4, inTune: true, cents: 0 }), key);
    assert(a5 && a5.text === 'F sharp, in tune', 'in-tune transition on the SAME note re-announces');
    key = a5.key;

    const a6 = announcementFor(ds({ status: 'rejected', noteName: null }), key);
    assert(a6 && a6.text === null && a6.key === null, 'going blank clears the key but announces nothing');
    key = a6.key;

    const a7 = announcementFor(ds({ status: 'rejected', noteName: null }), key);
    assert(a7 === null, 'staying blank -> no repeat "nothing" announcements');

    const a8 = announcementFor(ds({ noteName: 'F#', octave: 4, inTune: true, cents: 0 }), key);
    assert(a8 && a8.text === 'F sharp, in tune', 'sound resuming re-announces even the same note (it stopped and restarted)');
  });

  suite('announcementFor: cents rounded to whole numbers', () => {
    const a = announcementFor(ds({ noteName: 'A', octave: 2, inTune: false, cents: 23.6 }), null);
    assert(a.text === 'A, 24 cents sharp', 'cents rounded to nearest whole number');
  });
}
```

Register it in `web/test/run-all.js` — add near the other imports/calls:
```js
import runNoteStatus from './test-note-status.js';
```
```js
runNoteStatus();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node web/test/run-all.js`
Expected: FAIL — `[note-status...]` suites throw `Cannot find module '../js/ui/note-status.js'`, summary shows FAILED.

- [ ] **Step 3: Write the implementation**

Create `web/js/ui/note-status.js`:

```js
// PURE (Node-safe) despite living under ui/ — see Global Constraints / architecture
// invariant §1.2: new pure logic goes in pure, testable modules; browser wrappers
// (controls.js) stay thin. This module turns a DisplayState into human-readable
// text: the short visual state label (with a shape cue, not colour alone) and the
// throttled spoken-note announcement for the aria-live region. No DOM, no timers,
// no Date — timestamps never enter this file.

/** @typedef {import('../dsp/stabilizer.js').DisplayState} DisplayState */

const ALMOST_CENTS = 15; // relocated as-is from controls.js's prior inline literal

/**
 * Pronounce a sharp note name the way a screen reader user expects:
 * 'F#' -> 'F sharp'. Natural note names ('E') pass through unchanged. The DSP
 * only ever emits sharps (see stabilizer.js DisplayState typedef), so flats
 * never reach this function.
 * @param {string} noteName
 * @returns {string}
 */
export function spokenNoteName(noteName) {
  return noteName.length > 1 ? `${noteName[0]} sharp` : noteName;
}

/**
 * Short visual state label shown under the note ("✓ IN TUNE" / "FLAT ♭" / ...).
 * The leading "✓" is a non-colour (shape) redundant cue for the in-tune state —
 * see spec §8 "Redundant (non-colour) in-tune cue" — the accent-colour swap
 * elsewhere (dial ring, string circle) stays, this text is an additional signal.
 * @param {DisplayState} ds
 * @returns {string} '' when there's nothing to show (blank/silent/rejected).
 */
export function stateLabelFor(ds) {
  const active = ds.status === 'active' || ds.status === 'hold';
  if (!active || ds.noteName == null) return '';
  if (ds.inTune) return '✓ IN TUNE';
  const c = ds.cents;
  if (Math.abs(c) <= ALMOST_CENTS) return c < 0 ? 'ALMOST ♭' : 'ALMOST ♯';
  return c < 0 ? 'FLAT ♭' : 'SHARP ♯';
}

/**
 * Throttled spoken-note announcement for the aria-live region. Only returns a
 * fresh announcement when the note (name+octave) or the in-tune state changes —
 * NEVER per animation frame (controls.js#update(ds) runs ~60x/sec via the rAF
 * loop in app.js#loop()). Going blank (mic drops out / signal rejected) clears
 * the tracked key but is itself silent — no "listening…" chatter. The next
 * active reading, even of the identical note, announces again: from a listener's
 * perspective the sound stopped and started over, which is worth saying.
 * @param {DisplayState} ds
 * @param {string|null} prevKey  the `.key` from the last call that returned non-null
 * @returns {{text: string|null, key: string|null} | null} null = nothing changed
 */
export function announcementFor(ds, prevKey) {
  const active = ds.status === 'active' || ds.status === 'hold';
  const key = active && ds.noteName != null
    ? `${ds.noteName}${ds.octave}:${ds.inTune ? 'in' : 'out'}`
    : null;
  if (key === prevKey) return null;
  if (key === null) return { text: null, key: null };

  const spoken = spokenNoteName(ds.noteName);
  const text = ds.inTune
    ? `${spoken}, in tune`
    : `${spoken}, ${Math.abs(Math.round(ds.cents))} cents ${ds.cents < 0 ? 'flat' : 'sharp'}`;
  return { text, key };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node web/test/run-all.js`
Expected: PASS — all `note-status` suites print PASS, `ALL TESTS PASSED`.

- [ ] **Step 5: Commit**

```bash
git add web/js/ui/note-status.js web/test/test-note-status.js web/test/run-all.js
git commit -m "feat(a11y): pure note-status formatter (state label + throttled announcement)"
```

---

### Task 2: Wire the spoken-note live region into `controls.js`

**Files:**
- Modify: `web/index.html` (live-region node + `.sr-only` hookup)
- Modify: `web/css/styles.css` (`.sr-only` utility)
- Modify: `web/js/ui/controls.js` (import + wiring + reuse `stateLabelFor`)

**Interfaces:**
- Consumes: `stateLabelFor`, `announcementFor` from Task 1.
- Produces: `#liveRegion` DOM node that screen readers announce on note/in-tune change; `Controls.update(ds)`'s visible state label is now sourced from the same pure function as the announcement (single source of truth for phrasing).

This step is **browser/DOM behavior — no automated test is possible here** (no jsdom in this repo; see Global Constraints). Verified manually in Step 4.

- [ ] **Step 1: Add the live region + visually-hidden utility**

Re-read the current `web/index.html` and `web/css/styles.css` first (Package A is the only landed package right now, but re-verify before editing per the shared-file warning).

In `web/index.html`, change the `<main>` opening line:
```html
  <main class="app" id="app">
```
to:
```html
  <main class="app" id="app">
    <div id="liveRegion" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></div>
```

In `web/css/styles.css`, add this new rule immediately after `* { box-sizing: border-box; }`:
```css
/* ---------- Accessibility utilities ---------- */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
```

- [ ] **Step 2: Wire the live region + reuse `stateLabelFor` in `controls.js`**

Re-read `web/js/ui/controls.js` first — Task 1 hasn't touched it, but confirm no earlier package changed it since this plan was authored.

Add the import (top of the file, after the existing imports):
```js
import { stateLabelFor, announcementFor } from './note-status.js';
```

In the constructor, alongside the other `this.$(...)` field assignments (near `this.overlay = this.$('overlay');`), add:
```js
    this.liveRegion = this.$('liveRegion');
```
and alongside the other state fields (near `this._lastNoteKey = null;`), add:
```js
    this._announceKey = null;
```

In `update(ds)`, replace:
```js
  update(ds) {
    this.app.style.setProperty('--conf', String(ds.confidence != null ? ds.confidence : 1));
    const active = ds.status === 'active' || ds.status === 'hold';
```
with:
```js
  update(ds) {
    this.app.style.setProperty('--conf', String(ds.confidence != null ? ds.confidence : 1));

    const ann = announcementFor(ds, this._announceKey);
    if (ann) {
      this._announceKey = ann.key;
      if (ann.text) {
        // Clear-then-set (forcing a reflow in between) so a screen reader
        // re-announces even when the new text is byte-identical to what's
        // already in the region (e.g. the same note resumes after a brief
        // silence) — some ATs only fire on an observed DOM mutation, not on
        // textContent merely being assigned the same string. Mirrors the
        // existing note-swap restart idiom below (`void ...offsetWidth`).
        this.liveRegion.textContent = '';
        void this.liveRegion.offsetWidth;
        this.liveRegion.textContent = ann.text;
      }
    }

    const active = ds.status === 'active' || ds.status === 'hold';
```

Then replace the inline label logic:
```js
    const c = ds.cents;
    let label;
    if (ds.inTune) label = 'IN TUNE';
    else if (Math.abs(c) <= 15) label = c < 0 ? 'ALMOST ♭' : 'ALMOST ♯';
    else label = c < 0 ? 'FLAT ♭' : 'SHARP ♯';
    this.stateLabel.textContent = label;
```
with:
```js
    this.stateLabel.textContent = stateLabelFor(ds);
```

(The `const c = ds.cents;` a few lines below, used for `Math.round(c)`/sign in the Hz/cents subtext, stays — only the label block above is replaced.)

- [ ] **Step 3: Run the full suite (no regressions)**

Run: `node web/test/run-all.js`
Expected: `ALL TESTS PASSED` (this task only touches browser code + markup + reuses Task 1's already-tested pure function).

- [ ] **Step 4: Manual verification — screen reader + DOM inspection**

```bash
node serve.mjs 8173
```

Without a screen reader, first confirm the plumbing in DevTools: open `http://localhost:8173`, start the mic, play a note, and in the Console run `document.getElementById('liveRegion').textContent` — expect something like `"E, in tune"` or `"A, 8 cents flat"`. Play a rapid vibrato around the in-tune boundary and confirm the text does **not** change on every frame — only when the printed value actually differs from before.

With a screen reader (VoiceOver on macOS, NVDA on Windows, or Chrome's built-in "Accessibility" DevTools pane showing the accessibility tree's live-region value): confirm it speaks "E, in tune" / "A, 8 cents flat" style phrases as you change strings/tuning, that "F#" is spoken as "F sharp", and that it stays silent while holding one note steady in tune (no per-frame chatter). Stop playing, wait for the note to blank, then play the exact same note again — confirm it re-announces (this exercises the clear-then-set reflow fix from Step 2).

- [ ] **Step 5: Commit**

```bash
git add web/index.html web/css/styles.css web/js/ui/controls.js
git commit -m "feat(a11y): wire spoken-note live region into controls"
```

---

### Task 3: Pure Tab-trap stepper (`focus-order.js`)

**Files:**
- Create: `web/js/ui/focus-order.js`
- Create: `web/test/test-focus-order.js`
- Modify: `web/test/run-all.js`

**Interfaces:**
- Produces: `nextFocusIndex(count: number, currentIndex: number, shiftKey: boolean) => number`.

- [ ] **Step 1: Write the failing test**

Create `web/test/test-focus-order.js`:

```js
// Node. Cases for js/ui/focus-order.js — the pure Tab-trap index stepper.
import { suite, assert } from './assert.js';
import { nextFocusIndex } from '../js/ui/focus-order.js';

export default function run() {
  suite('nextFocusIndex: empty trap', () => {
    assert(nextFocusIndex(0, -1, false) === -1, 'no focusables -> -1 forward');
    assert(nextFocusIndex(0, -1, true) === -1, 'no focusables -> -1 backward');
  });

  suite('nextFocusIndex: forward (Tab)', () => {
    assert(nextFocusIndex(3, -1, false) === 0, 'unknown focus -> first element');
    assert(nextFocusIndex(3, 0, false) === 1, 'middle step forward');
    assert(nextFocusIndex(3, 1, false) === 2, 'step forward toward the end');
    assert(nextFocusIndex(3, 2, false) === 0, 'Tab from the last element wraps to the first (trap)');
  });

  suite('nextFocusIndex: backward (Shift+Tab)', () => {
    assert(nextFocusIndex(3, -1, true) === 2, 'unknown focus -> last element');
    assert(nextFocusIndex(3, 2, true) === 1, 'step backward');
    assert(nextFocusIndex(3, 1, true) === 0, 'step backward toward the start');
    assert(nextFocusIndex(3, 0, true) === 2, 'Shift+Tab from the first element wraps to the last (trap)');
  });

  suite('nextFocusIndex: single focusable element traps on itself', () => {
    assert(nextFocusIndex(1, 0, false) === 0, 'Tab on a single element stays put');
    assert(nextFocusIndex(1, 0, true) === 0, 'Shift+Tab on a single element stays put');
  });
}
```

Register it in `web/test/run-all.js`:
```js
import runFocusOrder from './test-focus-order.js';
```
```js
runFocusOrder();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node web/test/run-all.js`
Expected: FAIL — `Cannot find module '../js/ui/focus-order.js'`.

- [ ] **Step 3: Write the implementation**

Create `web/js/ui/focus-order.js`:

```js
// PURE (Node-safe). Computes the next index for a Tab/Shift+Tab keypress inside a
// focus-trapped container (the tuning/settings sheet — see controls.js). Takes the
// number of currently-focusable elements and the currently-focused element's index
// (-1 when focus isn't on any tracked element, e.g. right after the panel
// re-rendered) and returns the index to focus next, WRAPPING at both ends so focus
// can never escape the trap. No DOM access — controls.js supplies count/index from
// a live query, recomputed on every keypress so it stays correct across re-renders
// (the tuning list and the custom-tuning editor rebuild their DOM on state changes).

/**
 * @param {number} count         number of focusable elements in the trap
 * @param {number} currentIndex  index of the currently-focused element, or -1
 * @param {boolean} shiftKey     true for Shift+Tab (backward)
 * @returns {number} index to focus, or -1 if there is nothing focusable
 */
export function nextFocusIndex(count, currentIndex, shiftKey) {
  if (count <= 0) return -1;
  if (shiftKey) {
    return currentIndex <= 0 ? count - 1 : currentIndex - 1;
  }
  return currentIndex < 0 || currentIndex >= count - 1 ? 0 : currentIndex + 1;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node web/test/run-all.js`
Expected: PASS — all `nextFocusIndex` suites print PASS, `ALL TESTS PASSED`.

- [ ] **Step 5: Commit**

```bash
git add web/js/ui/focus-order.js web/test/test-focus-order.js web/test/run-all.js
git commit -m "feat(a11y): pure focus-order stepper for the sheet's Tab trap"
```

---

### Task 4: Focus-trap the tuning sheet (open focus, Tab trap, Escape, return focus)

**Files:**
- Modify: `web/index.html` (`.sheet` gains `tabindex="-1"`)
- Modify: `web/js/ui/controls.js` (`openSheet`/`closeSheet`/`_showMain`/`_openEditor` + new private helpers)

**Interfaces:**
- Consumes: `nextFocusIndex` from Task 3.
- Produces: `Controls#openSheet()`/`closeSheet()` now manage focus; no public API change (callers in `app.js` and internal click handlers are unaffected).

Browser/DOM behavior — **no automated test possible**; verified manually in Step 3.

- [ ] **Step 1: Give `.sheet` a fallback focus target**

Re-read `web/index.html` first (confirm the `.sheet` markup Task 2 didn't touch is still as expected). Change:
```html
    <div class="sheet" id="sheet" hidden role="dialog" aria-modal="true" aria-label="Tuning settings">
```
to:
```html
    <div class="sheet" id="sheet" hidden tabindex="-1" role="dialog" aria-modal="true" aria-label="Tuning settings">
```

- [ ] **Step 2: Add the trap to `controls.js`**

Re-read `web/js/ui/controls.js` first (Task 2 added the live-region wiring; confirm current line numbers before editing).

Add the import at the top, alongside the Task 2 import:
```js
import { nextFocusIndex } from './focus-order.js';
```

Add a module-level constant near the top of the file (after the imports, before `export class Controls`):
```js
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
```

In the constructor, add a field next to `this._blankTimer = null;`:
```js
    this._preOpenFocus = null;
```

Still in the constructor (after all other field assignments, before `this._wire();`), define the trap's keydown handler as an instance arrow function so it can be added/removed as one stable reference:
```js
    this._onSheetKeydown = (e) => {
      if (this.sheet.hidden) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        this.closeSheet();
        return;
      }
      if (e.key !== 'Tab') return;
      const els = this._getFocusable();
      const current = els.indexOf(this.doc.activeElement);
      const next = nextFocusIndex(els.length, current, e.shiftKey);
      if (next === -1) return; // nothing focusable — let the browser do its default thing
      e.preventDefault();
      els[next].focus();
    };
```

Add these three private methods anywhere inside the class (e.g. just above `openSheet()`):
```js
  /** The sheet panel currently shown: main list or the custom-tuning editor. */
  _activePanel() {
    return this.sheetEditor.hidden ? this.sheetMain : this.sheetEditor;
  }

  /** Focusable elements in the CURRENTLY VISIBLE panel, re-queried every call so
   *  it stays correct after the tuning list / editor rows re-render. */
  _getFocusable() {
    return Array.from(this._activePanel().querySelectorAll(FOCUSABLE_SELECTOR))
      .filter((el) => !el.closest('[hidden]'));
  }

  _focusFirstInPanel() {
    const els = this._getFocusable();
    if (els.length) els[0].focus();
    else this.sheet.focus(); // fallback: the sheet itself (tabindex="-1", Step 1)
  }
```

Replace:
```js
  openSheet() { this.scrim.hidden = false; this.sheet.hidden = false; this._showMain(); }
  closeSheet() { this.scrim.hidden = true; this.sheet.hidden = true; }
  _showMain() { this.sheetMain.hidden = false; this.sheetEditor.hidden = true; }
```
with:
```js
  openSheet() {
    this._preOpenFocus = this.doc.activeElement;
    this.scrim.hidden = false;
    this.sheet.hidden = false;
    this._showMain();
    this.doc.addEventListener('keydown', this._onSheetKeydown);
  }

  closeSheet() {
    this.scrim.hidden = true;
    this.sheet.hidden = true;
    this.doc.removeEventListener('keydown', this._onSheetKeydown);
    const trigger = this._preOpenFocus;
    this._preOpenFocus = null;
    if (trigger && this.doc.contains(trigger) && typeof trigger.focus === 'function') {
      trigger.focus();
    }
  }

  _showMain() {
    this.sheetMain.hidden = false;
    this.sheetEditor.hidden = true;
    this._focusFirstInPanel();
  }
```

In `_openEditor(seed)`, add a call at the end (after `this._renderEditor();`):
```js
  _openEditor(seed) {
    // seed from the current tuning (so "tweak this preset" is easy)
    this._editMidis = (seed || (this._tuning ? this._tuning.strings.slice() : [40, 45, 50, 55, 59, 64])).slice();
    this._editId = null;
    this.sheetMain.hidden = true;
    this.sheetEditor.hidden = false;
    this._renderEditor();
    this._focusFirstInPanel();
  }
```

This does **not** touch the scrim-click handler (`this.scrim.addEventListener('click', () => this.closeSheet());`) or the Done button handler (`this.$('sheetDone').addEventListener('click', () => this.closeSheet());`) — both already call `closeSheet()`, so they automatically inherit the return-focus behavior for free.

- [ ] **Step 3: Manual verification — keyboard only**

```bash
node serve.mjs 8173
```

At `http://localhost:8173`, using only the keyboard (Tab, Shift+Tab, Enter, Space, Escape — no mouse):
1. Tab to the "tap to change" tuning label (or the A4 chip), press Enter/Space to open the sheet. Expected: focus lands inside the sheet (on its first control) — never stays on the trigger, never lands in the background.
2. Tab repeatedly. Expected: focus cycles only through controls inside the sheet (instrument segment, theme button, tuning list rows, A4 steppers, Done) and wraps from the last back to the first — it must never reach `#toneBtn`, the string circles, or the overlay behind the scrim.
3. From the first control, press Shift+Tab. Expected: focus wraps to the last control in the panel.
4. Press `Escape`. Expected: the sheet closes and focus returns to whichever element opened it.
5. Reopen the sheet, this time click "Done" with the mouse. Expected: sheet closes, focus returns to the trigger (same as Escape).
6. Reopen the sheet, click the scrim. Expected: sheet closes, focus returns to the trigger.
7. Reopen the sheet, Tab to "＋ Custom tuning…", press Enter. Expected: focus moves into the editor panel (its "‹ Back" button), and the Tab trap now cycles only through the editor's controls (string-count segment, −/+ nudges, name input, Cancel/Save) — not the now-hidden main panel's controls.
8. Press "‹ Back" (mouse or Enter). Expected: focus returns to the first control of the main panel, and the trap is scoped back to it.

- [ ] **Step 4: Run the full suite (no regressions)**

Run: `node web/test/run-all.js`
Expected: `ALL TESTS PASSED`.

- [ ] **Step 5: Commit**

```bash
git add web/index.html web/js/ui/controls.js
git commit -m "feat(a11y): focus-trap the tuning sheet (Tab trap, Escape, return focus)"
```

---

### Task 5: Labels & roles across existing controls + the B/D/E checklist

**Files:**
- Modify: `web/index.html`
- Modify: `web/js/ui/controls.js`
- Create: `web/test/test-a11y-markup.js`
- Modify: `web/test/run-all.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `aria-pressed`/`aria-label`/`role` attributes on every existing toggle-like control; a documented checklist (this task's body) for the equivalent B/D/E controls.

- [ ] **Step 1: Write the failing static-markup guard test**

This is a **static text guard**, not a behavior test — it confirms the required attributes/ids are present in source, not that focus/announcements actually work (that's manual, Tasks 2 & 4). It mirrors the existing `test-sw-assets.js` idiom of reading a file as text because the target can't safely be imported/instantiated in Node.

Create `web/test/test-a11y-markup.js`:

```js
// Node. Static text guard: confirms the accessibility hooks this package adds are
// present in the shipped markup/source. NOT a behavior test — it cannot exercise
// focus movement, aria-live announcements, or keyboard events (no jsdom in this
// repo; see Global Constraints). Real behavior is verified manually per-task.
import { suite, assert } from './assert.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..');

export default function run() {
  const html = readFileSync(join(WEB, 'index.html'), 'utf8');
  const controlsJs = readFileSync(join(WEB, 'js/ui/controls.js'), 'utf8');

  suite('a11y markup: spoken-note live region exists', () => {
    assert(html.includes('id="liveRegion"'), 'index.html declares #liveRegion');
    assert(html.includes('aria-live="polite"'), '#liveRegion is aria-live="polite"');
    assert(html.includes('class="sr-only"'), '#liveRegion is visually hidden via .sr-only');
  });

  suite('a11y markup: sheet is a labelled, focus-manageable dialog', () => {
    assert(html.includes('role="dialog"'), '.sheet has role="dialog"');
    assert(html.includes('aria-modal="true"'), '.sheet has aria-modal="true"');
    assert(html.includes('tabindex="-1"'), '.sheet has a tabindex="-1" fallback trap-focus target');
  });

  suite('a11y markup: existing toggle-like controls expose pressed state', () => {
    assert(controlsJs.includes("setAttribute('aria-pressed'"), 'controls.js sets aria-pressed on toggle-like controls');
    assert(controlsJs.includes("setAttribute('aria-label'"), 'controls.js sets aria-label on dynamically-created controls');
  });

  suite('a11y markup: instrument segment is a labelled group', () => {
    assert(html.includes('id="instrumentSeg" role="group" aria-label="Instrument"'),
      '#instrumentSeg has role="group" aria-label="Instrument"');
  });
}
```

Register it in `web/test/run-all.js`:
```js
import runA11yMarkup from './test-a11y-markup.js';
```
```js
runA11yMarkup();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node web/test/run-all.js`
Expected: FAIL — all four `a11y markup:` suites fail against the current (pre-Task-5) markup.

- [ ] **Step 3: String circles — `aria-pressed` (pin state) + `aria-label`**

Re-read `web/js/ui/controls.js` first (Tasks 2 & 4 changed it since this plan was authored).

In `setTuning(tuning, a4)`, inside the `tuning.strings.forEach(...)` loop, add two lines after `btn.title = ...`:
```js
      btn.title = `${info.name}${info.octave} · ${frequencyFromMidi(midi, a4).toFixed(2)} Hz — tap to pin`;
      btn.setAttribute('aria-pressed', 'false');
      btn.setAttribute('aria-label', `${info.name}${info.octave}, tap to pin pitch detection to this string`);
```

Replace `_applyPinnedState()`:
```js
  _applyPinnedState() {
    const kids = this.stringsEl.children;
    for (let i = 0; i < kids.length; i++) kids[i].classList.toggle('is-pinned', i === this._pinnedIndex);
    this.autoLabel.textContent = this._pinnedIndex != null ? 'PINNED' : 'AUTO';
  }
```
with:
```js
  _applyPinnedState() {
    const kids = this.stringsEl.children;
    for (let i = 0; i < kids.length; i++) {
      const pinned = i === this._pinnedIndex;
      kids[i].classList.toggle('is-pinned', pinned);
      kids[i].setAttribute('aria-pressed', String(pinned));
    }
    this.autoLabel.textContent = this._pinnedIndex != null ? 'PINNED' : 'AUTO';
    if (this._pinnedIndex != null && this._tuning) {
      const info = midiToName(this._tuning.strings[this._pinnedIndex]);
      this.autoBtn.setAttribute('aria-label', `Pinned to ${info.name}${info.octave}. Tap to return to automatic string detection.`);
    } else {
      this.autoBtn.setAttribute('aria-label', 'Automatic string detection is on. Tap a string to pin detection to it.');
    }
  }
```

This uses `this.autoBtn`, which doesn't exist yet as a cached field — add it in the constructor next to `this.autoDot = this.$('autoDot');`:
```js
    this.autoBtn = this.$('autoBtn');
```
and update `_wire()` to reuse it instead of re-querying:
```js
    this.$('autoBtn').addEventListener('click', () => {
```
becomes:
```js
    this.autoBtn.addEventListener('click', () => {
```

*Design decision:* the AUTO↔PINNED transition is **labelled**, not separately announced — a second `aria-live` region firing alongside the Task 2 note-announcement region would compete/interleave unpredictably for screen-reader users. `aria-pressed` on each string circle plus the dynamic `aria-label` on `#autoBtn` fully conveys the state to anyone who tabs to/queries those controls.

- [ ] **Step 4: Instrument segment, theme toggle title, tone button, sheet handle**

In `web/index.html`, replace:
```html
          <div class="seg" id="instrumentSeg">
            <button class="seg-btn is-on" data-instrument="guitar" type="button">Guitar</button>
            <button class="seg-btn" data-instrument="bass" type="button">Bass</button>
          </div>
```
with:
```html
          <div class="seg" id="instrumentSeg" role="group" aria-label="Instrument">
            <button class="seg-btn is-on" data-instrument="guitar" type="button" aria-pressed="true">Guitar</button>
            <button class="seg-btn" data-instrument="bass" type="button" aria-pressed="false">Bass</button>
          </div>
```

Replace:
```html
    <button class="tone-btn" id="toneBtn" type="button" title="Play reference tone" aria-pressed="false" disabled>
```
with:
```html
    <button class="tone-btn" id="toneBtn" type="button" title="Play reference tone" aria-label="Play reference tone" aria-pressed="false" disabled>
```

Replace:
```html
      <div class="sheet-handle"></div>
```
with:
```html
      <div class="sheet-handle" aria-hidden="true"></div>
```

(The theme button's `aria-label`/title is handled in Task 7, which introduces the 3-way cycle it needs to describe — the checklist below still calls it out so it isn't dropped.)

In `controls.js`, replace `_setInstrumentUI(inst)`:
```js
  _setInstrumentUI(inst) {
    this._instrument = inst;
    this.$('instrumentSeg').querySelectorAll('.seg-btn').forEach((b) => {
      b.classList.toggle('is-on', b.dataset.instrument === inst);
    });
    this._renderTuningList();
  }
```
with:
```js
  _setInstrumentUI(inst) {
    this._instrument = inst;
    this.$('instrumentSeg').querySelectorAll('.seg-btn').forEach((b) => {
      const on = b.dataset.instrument === inst;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    this._renderTuningList();
  }
```

Replace `_syncToneBtn()`:
```js
  _syncToneBtn() {
    const target = this._pinnedIndex != null ? this._pinnedIndex : this._activeIndex;
    this.toneBtn.disabled = target == null;
    if (target != null && this._tuning) {
      const info = midiToName(this._tuning.strings[target]);
      this.toneBtn.title = `Play ${info.name}${info.octave} reference tone`;
    } else {
      this.toneBtn.title = 'Play reference tone';
    }
  }
```
with:
```js
  _syncToneBtn() {
    const target = this._pinnedIndex != null ? this._pinnedIndex : this._activeIndex;
    this.toneBtn.disabled = target == null;
    let label = 'Play reference tone';
    if (target != null && this._tuning) {
      const info = midiToName(this._tuning.strings[target]);
      label = `Play ${info.name}${info.octave} reference tone`;
    }
    this.toneBtn.title = label;
    this.toneBtn.setAttribute('aria-label', label);
  }
```

- [ ] **Step 5: Run tests to verify the markup guard passes**

Run: `node web/test/run-all.js`
Expected: PASS — all four `a11y markup:` suites, plus everything else, `ALL TESTS PASSED`.

- [ ] **Step 6: The B/D/E checklist (verify-then-apply — these controls don't exist in this tree yet)**

Packages B, D, and E land before this one and each introduce controls that need the identical treatment demonstrated in Steps 3–4. This plan was authored before those packages shipped, so it cannot give exact selectors — instead, **grep for the real markup first**, then apply the pattern shown, adapting the selector/id to what's actually there. Do not skip any of these; each is a real spec §8 requirement ("Labels/roles... on string, instrument, theme, tone, mode, and display-toggle controls").

| Source | Control | Grep first | Apply |
|---|---|---|---|
| B | Instrument chip row (likely replaces/extends `#instrumentSeg`) | `grep -rn "instrument" web/index.html web/js/ui/controls.js` | Same as Step 4: `role="group" aria-label="Instrument"` on the container, `aria-pressed` per chip. |
| B | Custom-tuning note picker (per-string dropdown) + −/+ nudge buttons | `grep -n "editor-row\|_nudge" web/js/ui/controls.js` | Each `<select>` gets `aria-label="String {n} pitch"`; nudge buttons get `aria-label="Lower string {n} by a semitone"` / `"Raise string {n} by a semitone"`. |
| D | Dial⇄strobe toggle | `grep -rn "strobe\|displayMode" web/js/app.js web/js/ui/controls.js` | `role="group" aria-label="Display style"` on the container; `aria-pressed` on the two options ("Dial", "Strobe"), same pattern as Step 4's instrument segment. |
| D | Haptics / chime settings toggles | `grep -rn "haptic\|chime" web/js/app.js web/js/ui/controls.js web/index.html` | Prefer native `<input type="checkbox">` + `<label>`. If already built as custom buttons, use `role="switch" aria-checked="true\|false"` plus a visible label ("Haptic feedback", "In-tune chime"). |
| D | Mic Retry button | `grep -rn "[Rr]etry" web/js/ui/controls.js web/index.html` | `aria-label="Retry microphone access"`. |
| E | Mode nav (Tuner \| Metronome) | `grep -rn "uiMode\|modeNav" web/js/app.js web/index.html` | `role="group" aria-label="Mode"` on the container; `aria-pressed` per button — same pattern as Step 4. |
| E | BPM face + tap-tempo | `grep -n "bpm\|tap" web/js/ui/metronome-view.js` | Tap button gets a **static** `aria-label="Tap tempo"` (don't embed the live BPM — it goes stale mid-gesture, and adding a second `aria-live` region here would compete with Task 2's note-announcement region). Start/Stop button: `aria-label="Start metronome"` / `"Stop metronome"`. The BPM number itself is plain visible text (not `aria-hidden`) so a screen reader's virtual cursor can read it on demand. |
| E | Beat-pill row | `grep -n "beat-pill\|beatRow" web/js/ui/metronome-view.js` | Mark the whole row `aria-hidden="true"` — it's a real-time visual redundant with the metronome's audible click; per-beat live updates would be exactly the frame-rate chatter the throttling rule (spec §8) warns against. |
| E | Meter editor sheet | `grep -n "sheet\|dialog" web/js/ui/metronome-view.js` | If it reuses `Controls`'s `openSheet()`/`closeSheet()`, it already has Task 4's focus trap for free. If `metronome-view.js` rolls its own sheet instance, replicate Task 4's `_getFocusable`/`_onSheetKeydown`/`nextFocusIndex` wiring verbatim (same import from `focus-order.js`), and its own `tabindex="-1"` on that sheet's container. |

- [ ] **Step 7: Commit**

```bash
git add web/index.html web/js/ui/controls.js web/test/test-a11y-markup.js web/test/run-all.js
git commit -m "feat(a11y): aria labels/roles across tuner controls + B/D/E checklist"
```

---

### Task 6: Redundant non-colour in-tune cue (dial ring + string badge)

**Files:**
- Modify: `web/css/styles.css`

**Interfaces:**
- Consumes: the existing `.in-tune` class toggled on `.app` by `controls.js#update(ds)` (`this.app.classList.toggle('in-tune', active && ds.inTune)`, unchanged) and the `✓ IN TUNE` text label from Task 1.
- Produces: an in-tune state that reads via shape/position even with colour removed — the dial indicator becomes a ring instead of a filled dot, and the active string circle gains a checkmark badge, on top of the Task 1 text-label checkmark.

Purely visual CSS — **no automated test possible**; verified manually (Step 2) including a colour-blindness simulation.

- [ ] **Step 1: Ring-shaped dial indicator + string-circle checkmark badge**

Re-read `web/css/styles.css` first (Task 2 added `.sr-only`; confirm current state before editing).

Replace:
```css
/* ---------- in-tune recolor ---------- */
.in-tune .note-state    { color: var(--accent-in); }
.in-tune .dot           { background: var(--accent-in); box-shadow: 0 0 10px var(--accent-in); }
.in-tune .dial-progress { stroke: var(--accent-in); }
.in-tune .dial-indicator{ fill: var(--accent-in); filter: drop-shadow(0 0 14px rgba(52, 211, 153, 0.85)); }
.in-tune .dial-zone     { opacity: 0.9; stroke-width: 4; }
```
with:
```css
/* ---------- in-tune recolor + non-colour (shape) redundant cue ---------- */
/* The visual state label (js/ui/note-status.js) already prefixes "✓" on in-tune;
   these two rules add a SHAPE cue to the graphical elements too, so the moment
   reads without colour (spec §8 redundant in-tune cue). */
.in-tune .note-state    { color: var(--accent-in); }
.in-tune .dot           { background: var(--accent-in); box-shadow: 0 0 10px var(--accent-in); }
.in-tune .dial-progress { stroke: var(--accent-in); }
.in-tune .dial-indicator {
  /* filled dot -> outlined ring: a silhouette change, not just a colour swap */
  fill: none;
  stroke: var(--accent-in);
  stroke-width: 3;
  filter: drop-shadow(0 0 14px rgba(52, 211, 153, 0.85));
}
.in-tune .dial-zone     { opacity: 0.9; stroke-width: 4; }
```

In the `.str` rule, add `position: relative;` (needed to anchor the checkmark badge below):
```css
.str {
  flex: 1 1 0;
  aspect-ratio: 1;
  max-width: 52px;
  min-width: 0;
  margin: 0 auto;
  position: relative;
  border-radius: 50%;
  ...
```

Immediately after the existing `.in-tune .str.is-active { ... }` rule, add:
```css
.in-tune .str.is-active { background: var(--accent-in); box-shadow: 0 0 22px rgba(52, 211, 153, 0.45); }
/* Shape cue on the active string too: a checkmark badge, not colour alone. */
.in-tune .str.is-active::after {
  content: '✓';
  position: absolute;
  right: -2px;
  bottom: -2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--bg-bot);
  color: var(--accent-in);
  font-size: 11px;
  line-height: 16px;
  text-align: center;
  box-shadow: 0 0 0 1px var(--accent-in);
}
```

- [ ] **Step 2: Manual verification — colour-blindness simulation**

```bash
node serve.mjs 8173
```

In Chrome DevTools → More tools → **Rendering** → "Emulate vision deficiencies" → **Achromatopsia** (full grayscale), start the mic, tune a string into tune. Expected: even with all colour removed, the in-tune moment is unambiguous from: the `✓ IN TUNE` text label (Task 1/2), the dial indicator switching from a filled dot to a ring outline, and the checkmark badge appearing on the active string circle. Repeat for **Deuteranopia** and **Protanopia** (red-green) to confirm the accent/accent-in colours plus the shape cues both remain legible. Also confirm the *out-of-tune* look (filled dot, no badge, plain "FLAT ♭"/"SHARP ♯"/"ALMOST ♭/♯" text) is unaffected.

- [ ] **Step 3: Run the full suite (no regressions)**

Run: `node web/test/run-all.js`
Expected: `ALL TESTS PASSED` (CSS-only change).

- [ ] **Step 4: Commit**

```bash
git add web/css/styles.css
git commit -m "feat(a11y): redundant non-colour in-tune cue (ring + checkmark)"
```

---

### Task 7: High-contrast/colour-blind-safe theme + 3-way cycle

**Files:**
- Create: `web/js/theme-cycle.js`
- Create: `web/test/test-theme-cycle.js`
- Modify: `web/test/run-all.js`
- Modify: `web/css/styles.css` (contrast theme tokens)
- Modify: `web/js/app.js` (`THEME_COLORS.contrast`, wire `controls.setTheme`)
- Modify: `web/js/ui/controls.js` (`themeBtn` uses `nextTheme`; new `setTheme()` method)
- Modify: `web/index.html` (`themeBtn` initial label/title)

**Interfaces:**
- Consumes: nothing new for `theme-cycle.js` itself.
- Produces: `THEME_ORDER: string[]`, `nextTheme(current: string) => string`, `THEME_LABEL: {[id: string]: string}`; `Controls#setTheme(theme: string)` (new public method).

- [ ] **Step 1: Write the failing test**

Create `web/test/test-theme-cycle.js`:

```js
// Node. Cases for js/theme-cycle.js — the pure 3-way theme cycle stepper.
import { suite, assert } from './assert.js';
import { THEME_ORDER, nextTheme, THEME_LABEL } from '../js/theme-cycle.js';

export default function run() {
  suite('THEME_ORDER: three themes, dark first', () => {
    assert(THEME_ORDER.length === 3, 'exactly three themes');
    assert(THEME_ORDER[0] === 'dark', 'dark is first (default)');
  });

  suite('nextTheme: cycles dark -> light -> contrast -> dark', () => {
    assert(nextTheme('dark') === 'light', 'dark -> light');
    assert(nextTheme('light') === 'contrast', 'light -> contrast');
    assert(nextTheme('contrast') === 'dark', 'contrast -> dark (wraps)');
  });

  suite('nextTheme: unknown current is treated as dark', () => {
    assert(nextTheme('bogus') === 'light', "unrecognised theme -> next after 'dark'");
    assert(nextTheme(undefined) === 'light', 'undefined -> next after dark');
  });

  suite('THEME_LABEL: has a human-readable entry for every theme', () => {
    for (const id of THEME_ORDER) {
      assert(typeof THEME_LABEL[id] === 'string' && THEME_LABEL[id].length > 0, `THEME_LABEL has '${id}'`);
    }
  });
}
```

Register it in `web/test/run-all.js`:
```js
import runThemeCycle from './test-theme-cycle.js';
```
```js
runThemeCycle();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node web/test/run-all.js`
Expected: FAIL — `Cannot find module '../js/theme-cycle.js'`.

- [ ] **Step 3: Write the implementation**

Create `web/js/theme-cycle.js`:

```js
// PURE (Node-safe). The theme cycle order + stepping logic shared by app.js
// (applies the theme) and controls.js (labels the toggle button with what
// tapping it will do next). Three themes: dark (default), light, and contrast
// (spec §8 high-contrast / colour-blind-safe theme) — see css/styles.css's
// [data-theme="contrast"] token block.

export const THEME_ORDER = ['dark', 'light', 'contrast'];

export const THEME_LABEL = { dark: 'dark', light: 'light', contrast: 'high-contrast' };

/**
 * @param {string} current  current theme id; unrecognised values are treated as
 *   though the current theme were 'dark' (so the toggle always has a sane next step).
 * @returns {string} the next theme id in the cycle.
 */
export function nextTheme(current) {
  const i = THEME_ORDER.indexOf(current);
  const base = i === -1 ? 0 : i;
  return THEME_ORDER[(base + 1) % THEME_ORDER.length];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node web/test/run-all.js`
Expected: PASS — all `theme-cycle`/`THEME_ORDER`/`THEME_LABEL` suites, `ALL TESTS PASSED`.

- [ ] **Step 5: Add the `contrast` theme tokens**

Re-read `web/css/styles.css` first (Task 6 changed it).

Immediately after the `:root[data-theme="light"] { ... }` block, add:
```css
/* High-contrast / colour-blind-safe theme (spec §8). All ratios below are
   computed against this theme's pure-black background per the WCAG 2 relative-
   luminance formula, rounded DOWN to stay conservative:
     --ink       #ffffff  21.0:1  (WCAG AA normal text needs >= 4.5:1)
     --muted     #cccccc  13.0:1
     --muted-2   #999999   7.3:1  (AA large text / non-text UI needs >= 3:1)
     --accent    #4fc3f7  10.4:1  (and black text ON this accent as a button
                                   background is also 10.4:1 — same channels)
     --accent-in #ffd500  14.7:1
     --accent-flat #ff6b4a 7.4:1
     --surface-brd (45% white over black, ~solid #666) ~3.6:1 (meets the 3:1
                                   non-text/UI-component minimum, WCAG 1.4.11)
   All exceed AA minimums with margin. The accent/accent-in hues (blue/yellow)
   avoid the red-green confusion pairs that trip up the two most common colour-
   vision deficiencies (deuteranopia/protanopia); the redundant SHAPE cues added
   in Task 6 (checkmark + ring, not just colour) cover the rarer blue-yellow
   deficiency (tritanopia) that this particular hue pair alone would not. */
:root[data-theme="contrast"] {
  --bg-top: #000000;
  --bg-mid: #000000;
  --bg-bot: #000000;
  --ink: #ffffff;
  --note-ink: #ffffff;
  --muted: #cccccc;
  --muted-2: #999999;
  --hair: rgba(255, 255, 255, 0.45);
  --surface: rgba(255, 255, 255, 0.12);
  --surface-brd: rgba(255, 255, 255, 0.45);
  --chip-brd: rgba(255, 255, 255, 0.5);
  --sheet-bg: #050505;
  --accent: #4fc3f7;
  --accent-in: #ffd500;
  --accent-flat: #ff6b4a;
  color-scheme: dark;
}
```

- [ ] **Step 6: Wire the 3-way cycle into `app.js` and `controls.js`**

Re-read `web/js/app.js` and `web/js/ui/controls.js` first.

In `app.js`, replace:
```js
const THEME_COLORS = { dark: '#0b0d10', light: '#efe9df' };
```
with:
```js
const THEME_COLORS = { dark: '#0b0d10', light: '#efe9df', contrast: '#000000' };
```

In `applyTheme(theme)`, add a call to `controls.setTheme` at the end:
```js
function applyTheme(theme) {
  root.setAttribute('data-theme', theme);
  store.set('tuner-theme', theme);
  applyThemeColor(theme);
  cacheColors();
  pushGraphColors();
  controls.setTheme(theme);
}
```

In the "initial UI reflects (possibly restored) default state" block, add one line so the button's label is correct on first load too:
```js
controls.setInstrument(state.instrument);
controls.setCustomTunings(state.customTunings);
controls.setA4(state.a4);
controls.setTuning(resolveTuning(state.tuningId), state.a4);
controls.setMicState('idle');
controls.setTheme(root.getAttribute('data-theme') || 'dark');
```

In `controls.js`, add the import alongside the Task 4 import:
```js
import { nextTheme, THEME_LABEL } from '../theme-cycle.js';
```

Replace the `themeBtn` click handler in `_wire()`:
```js
    this.$('themeBtn').addEventListener('click', () => {
      const cur = this.doc.documentElement.getAttribute('data-theme') || 'dark';
      cb.onThemeToggle(cur === 'dark' ? 'light' : 'dark');
    });
```
with:
```js
    this.$('themeBtn').addEventListener('click', () => {
      const cur = this.doc.documentElement.getAttribute('data-theme') || 'dark';
      cb.onThemeToggle(nextTheme(cur));
    });
```

Add a new public method (near `setA4`, for example):
```js
  /** @param {string} theme  the CURRENTLY applied theme id. */
  setTheme(theme) {
    const next = nextTheme(theme);
    this.$('themeBtn').setAttribute('aria-label',
      `Theme: ${THEME_LABEL[theme] || theme}. Tap for ${THEME_LABEL[next] || next} theme.`);
  }
```

In `web/index.html`, replace:
```html
          <button class="theme-toggle" id="themeBtn" type="button" title="Light / dark">◑</button>
```
with:
```html
          <button class="theme-toggle" id="themeBtn" type="button" title="Cycle theme (dark / light / high-contrast)" aria-label="Theme: dark. Tap for light theme.">◑</button>
```
(this static default is immediately overwritten by `controls.setTheme(...)` on load; it exists so the markup is never label-less before JS runs.)

- [ ] **Step 7: Run the full suite (no regressions)**

Run: `node web/test/run-all.js`
Expected: `ALL TESTS PASSED`.

- [ ] **Step 8: Manual verification**

```bash
node serve.mjs 8173
```

Open the sheet, tap the theme button three times. Expected order: dark → light → contrast → dark. On the contrast theme confirm: `<html data-theme="contrast">`, `#themeColorMeta`'s `content` is `#000000`, the background is pure black, note/dial/text are crisp white/blue/yellow (no washed-out greys), and `#themeBtn`'s `aria-label` (inspect via DevTools Accessibility pane) updates on every tap to describe the *next* theme. Run Chrome DevTools' Lighthouse (Accessibility category) or the axe DevTools extension against the contrast theme and confirm no colour-contrast failures are reported.

- [ ] **Step 9: Commit**

```bash
git add web/js/theme-cycle.js web/test/test-theme-cycle.js web/test/run-all.js web/css/styles.css web/js/app.js web/js/ui/controls.js web/index.html
git commit -m "feat(a11y): high-contrast/colour-blind-safe theme + 3-way cycle"
```

---

### Task 8: Honour `prefers-reduced-motion` everywhere

**Files:**
- Modify: `web/css/styles.css` (extend the existing reduced-motion block)
- Create: `web/js/ui/motion.js`
- Modify: (conditional) `web/js/ui/strobe.js`, `web/js/ui/metronome-view.js` — only if they already exist (they should, per B→D→E→F ordering)

**Interfaces:**
- Produces: `prefersReducedMotion() => boolean`.

`motion.js` is a one-line `matchMedia` wrapper — too trivial to warrant a Node test, and it's browser-only (`matchMedia` doesn't exist in Node). No automated test for this task; all of it is verified manually in Step 3.

- [ ] **Step 1: Extend the existing CSS reduced-motion block**

Re-read `web/css/styles.css` first (Tasks 6 & 7 both changed it since this plan was authored).

The file already has a partial `prefers-reduced-motion` block:
```css
@media (prefers-reduced-motion: reduce) {
  .dot, .str.is-playing, .tone-btn.is-playing { animation: none; }
  .note-swap { animation: none; }
  .note-main, .note-state, .note-sub { transition: opacity 120ms linear; }
  .dial-indicator, .dial-progress { transition: fill 300ms ease, stroke 300ms ease; }
}
```
It does **not** cover the sheet's slide-up-on-open animation. Replace it with:
```css
@media (prefers-reduced-motion: reduce) {
  .dot, .str.is-playing, .tone-btn.is-playing { animation: none; }
  .note-swap { animation: none; }
  .sheet { animation: none; }
  .note-main, .note-state, .note-sub { transition: opacity 120ms linear; }
  .dial-indicator, .dial-progress { transition: fill 300ms ease, stroke 300ms ease; }
}
```

Now find every OTHER animation in the current tree (Packages B/D/E may have added `@keyframes`/`animation:` rules of their own — a dial "snap" pulse reusing `tonepulse`/`autopulse`, a strobe sweep, a metronome beat flash):
```bash
grep -n "animation:\|@keyframes" web/css/styles.css
```
For every decorative `animation:`/`transform`-driving rule this prints that is **not already** in the `prefers-reduced-motion` block above (the two `@keyframes` blocks `autopulse`/`tonepulse`/`noteIn`/`sheetUp` are decorative sources — their *consumers*, listed above, are what must be neutralized), add its selector to the block using the same `animation: none;` pattern. If D's in-tune "snap"/pulse (spec §6.2: "a one-frame dial snap/ring pulse (reuse existing tonepulse/autopulse CSS keyframes)") is implemented by toggling one of the *existing* classes already covered above (`.str.is-playing`/`.tone-btn.is-playing`/a class built on `tonepulse`), it's already covered; only add a new selector if D introduced a genuinely new class name for it (spec §6.2 also separately says this feedback is "gated behind... `prefers-reduced-motion`" — confirm it actually is, in whichever file implements it, rather than assuming).

- [ ] **Step 2: Add the JS `prefersReducedMotion()` helper and wire it into canvas-driven motion**

Create `web/js/ui/motion.js`:
```js
// BROWSER (not Node-tested — a trivial one-line matchMedia wrapper; browser-only
// API, and too small to be worth a fake-DOM test given this repo's no-jsdom
// constraint). Single source of truth for "should this frame skip decorative
// motion", used by anything JS-driven that CSS media queries can't gate — namely
// canvas rendering loops (D's strobe display; the pitch trail already reflects
// live data, not decoration, so it is intentionally NOT gated by this).

/** @returns {boolean} true if the user has requested reduced motion. */
export function prefersReducedMotion() {
  try {
    return !!(globalThis.matchMedia && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch {
    return false;
  }
}
```

If `web/js/ui/strobe.js` already exists (Package D), open it and find its render/phase-accumulation loop. Add a reduced-motion gate so it draws a static needle at the current cents value instead of an animating drift — the exact call/field names below are illustrative; adapt them to strobe.js's real API (this sub-step has no automated test — canvas rendering is browser-only and is verified in Step 3):
```js
import { prefersReducedMotion } from './motion.js';
// ...inside the render/update method, before advancing the phase accumulator:
if (prefersReducedMotion()) {
  this._drawStatic(ds); // single non-animating mark at the current cents value
  return;
}
// ...existing phase-drift + stripe-drawing code unchanged
```
If `strobe.js` doesn't exist yet at the time this task is executed, skip this specific sub-step (there's no target) but still complete Step 1 (CSS audit), which is mandatory regardless.

If `web/js/ui/metronome-view.js` already exists (Package E) and its beat-flash is a discrete per-beat CSS class toggle (not continuous canvas motion), prefer gating it via the CSS media query in Step 1 instead of JS — grep for its animation class name and add it there rather than importing `motion.js` for a one-off toggle.

- [ ] **Step 3: Manual verification**

```bash
node serve.mjs 8173
```

In Chrome DevTools → More tools → **Rendering** → "Emulate CSS media feature prefers-reduced-motion" → **reduce**, reload, then: start the mic and confirm the header dot stops pulsing; play notes and confirm the note-swap has no slide/scale animation (the new note appears instantly); open/close the sheet and confirm it appears/disappears instantly with no slide-up; play a note near the in-tune boundary and confirm the reference-tone button (while playing) doesn't pulse. If D/E are present, also confirm: the strobe view shows a static indicator rather than a drifting stripe pattern, and the metronome's beat flash (if CSS-class-driven) is neutralized by the same media query. Toggle the emulation back off and confirm all the animations return.

- [ ] **Step 4: Run the full suite (no regressions)**

Run: `node web/test/run-all.js`
Expected: `ALL TESTS PASSED`.

- [ ] **Step 5: Commit**

```bash
git add web/css/styles.css web/js/ui/motion.js
git commit -m "feat(a11y): honour prefers-reduced-motion across animations"
```

(If Step 2 also touched `strobe.js`/`metronome-view.js`, add those paths too.)

---

### Task 9: Service worker asset list + cache version bump

**Files:**
- Modify: `web/sw.js`

**Interfaces:**
- Consumes: `test-sw-assets` (existing, from Package A) as the guard/oracle for what's missing — no guessing required.

- [ ] **Step 1: Run the guard to find what's missing**

Run: `node web/test/run-all.js`

Expected: FAIL on `sw: CORE_ASSETS covers every shipped runtime asset`, listing the new files this package added — at minimum `./js/theme-cycle.js`, `./js/ui/focus-order.js`, `./js/ui/motion.js`, `./js/ui/note-status.js` (and, if Task 8 added them, `./js/ui/strobe.js`/`./js/ui/metronome-view.js` — though those should already be listed by Package D/E's own plans; if the test also flags THEM as missing here, that means an earlier package's checklist was skipped, and this is the last chance to catch it before ship — add them too).

- [ ] **Step 2: Update `CORE_ASSETS` and bump `CACHE`**

Re-read `web/sw.js` first — **do not** assume the `CACHE` value below is current. This plan was authored against the tree after Package A only, where `CACHE = 'tuner-cache-v2'`; Packages B, D, and E each bump it once more before F starts, per the Cache-list discipline constraint. Read the actual current value and increment it by exactly one (e.g. if B/D/E left it at `'tuner-cache-v5'`, set it to `'tuner-cache-v6'` — not the illustrative `'tuner-cache-v3'` a naive reading of this plan alone might suggest).

Add every path Step 1's failure output listed to the `CORE_ASSETS` array, grouped with the existing `./js/...` entries for readability, e.g.:
```js
  './js/theme-cycle.js',
  './js/store.js',
  ...
  './js/ui/controls.js',
  './js/ui/dial.js',
  './js/ui/focus-order.js',
  './js/ui/graph.js',
  './js/ui/motion.js',
  './js/ui/note-status.js',
```
(exact ordering doesn't matter functionally — `test-sw-assets` checks set membership, not order — but keep it alphabetized within its section to match the file's existing convention).

- [ ] **Step 3: Run tests to verify the guard passes**

Run: `node web/test/run-all.js`
Expected: `ALL TESTS PASSED`, including both `sw:` suites and every suite this package added (Tasks 1, 3, 5, 7).

- [ ] **Step 4: Manual offline verification**

```bash
node serve.mjs 8173
```

At `http://localhost:8173`: DevTools → Application → Service Workers, confirm the new worker activates (may require a manual reload/"skipWaiting" if an old worker is still controlling the tab from a previous package's testing session). Application → Cache Storage → confirm the new `tuner-cache-vN` entry exists and lists all `CORE_ASSETS` including the four new modules. Toggle Network → Offline, hard-reload. Expected: the app boots fully, the sheet still opens/traps focus, and the theme cycle still works, entirely from cache. Uncheck Offline when done.

- [ ] **Step 5: Commit**

```bash
git add web/sw.js
git commit -m "feat(sw): add Package F modules to CORE_ASSETS; bump cache version"
```

---

## Self-Review

**Spec coverage (spec §8 Package F):**
- Spoken note (`aria-live="polite"`, throttled to note/state changes, not per frame) → Tasks 1–2. ✓ Sharp pronunciation ("F#" → "F sharp") and the exact throttle key (note+octave+inTune, not a timer) are both resolved and unit-tested.
- Focus-trapped sheet (focus-in, Tab trap, Escape, return-focus, without breaking scrim-tap/Done) → Tasks 3–4. ✓ Scrim-tap and Done are unmodified (both already called `closeSheet()`, which now also returns focus); trap stepping is pure and unit-tested, DOM wiring is manual-only and explicitly says so.
- Labels/roles on string, instrument, theme, tone, mode, and display-toggle controls → Task 5 (existing controls, concrete code) + Task 5 Step 6 (B/D/E controls, grep-first checklist, since they don't exist in this tree yet) + Task 7 (theme button specifically, co-located with the 3-way cycle it labels). ✓
- Redundant (non-colour) in-tune cue → Task 1 (✓ prefix on the text label, unit-tested) + Task 6 (dial ring shape + string checkmark badge, CSS). ✓ Exact visual form stated and justified.
- High-contrast/colour-blind-safe theme → Task 7. ✓ Exact token values given with computed WCAG contrast ratios; 3-way cycle (not a picker) chosen and justified.
- Reduced motion across every animation → Task 8. ✓ Extends the pre-existing partial media query, adds a JS helper for canvas-driven motion, and gives a `grep`-based audit step for whatever B/D/E added since this plan can't see their final class names.

**Placeholder scan:** every code block is complete, runnable code with real values (no `TODO`/`...`/lorem ipsum). The two spots that reference not-yet-existing files (Task 8's `strobe.js` gate, Task 5 Step 6's B/D/E checklist) are explicitly labelled as illustrative/verify-first rather than presented as already-integrated, and each gives a concrete fallback ("skip this sub-step if the target doesn't exist" / "grep for the real markup first") — this is a resolved design decision (see Global Constraints "Sequential shared-file integration"), not an unresolved placeholder.

**Unit-tested vs. manual-only, explicitly:**
- Unit-tested (Node, `node web/test/run-all.js`): `note-status.js` (state label, spoken pronunciation, throttled announcement key logic — Task 1), `focus-order.js` (Tab-trap index stepping — Task 3), `theme-cycle.js` (3-way cycle order — Task 7), plus a static source/markup presence guard (`test-a11y-markup.js`, Task 5) that confirms required attributes exist in source but does **not** exercise behavior.
- Manual-only (no jsdom in this repo, per Global Constraints): the live region actually reaching a screen reader and not spamming (Task 2 Step 4), focus actually moving/trapping/Escaping/returning (Task 4 Step 3), the full B/D/E label checklist (Task 5 Step 6), colour-blind-simulation legibility of the non-colour cue (Task 6 Step 2), contrast-theme rendering + axe/Lighthouse pass (Task 7 Step 8), and `prefers-reduced-motion` actually suppressing animation (Task 8 Step 3). This split is called out inline in every relevant task, not just here.

**Consistency check:** `note-status.js`'s `announcementFor`/`stateLabelFor` signatures match their call sites in `controls.js` (Task 2) exactly. `focus-order.js`'s `nextFocusIndex(count, currentIndex, shiftKey)` signature matches its use in `_onSheetKeydown` (Task 4) exactly. `theme-cycle.js`'s `nextTheme`/`THEME_LABEL` match their use in both `controls.js` (button click + label) and are consumed the same way in both places (Task 7). `THEME_COLORS` (app.js) and the `[data-theme="contrast"]` CSS block (styles.css) both key off the identical string `'contrast'`. All four new modules are added to `CORE_ASSETS` (Task 9), gated by the pre-existing `test-sw-assets` guard rather than a hand-counted list, so this can't silently drift.

**Design ambiguities resolved (per the brief's request to decide, not defer):**
- Announcement throttle: keyed on `note+octave+inTune`, not a timer — recomputed every frame (cheap) but only writes to the DOM when the key changes; blanking clears the key silently and the next active reading (even the same note) re-announces, with a clear-then-reflow DOM write to defeat AT's "identical string = no re-announce" gotcha.
- "F#" pronounced "F sharp"; the DSP only ever emits sharps (never flats), so no flat-handling branch was needed.
- Theme control: a 3-way **cycle** on the existing single button (dark → light → contrast → dark), not a new picker UI — keeps the change minimal and consistent with the existing one-tap interaction; the button's `aria-label` always states both the current and next theme so the state is discoverable without a picker.
- High-contrast tokens: pure black background, white/high-luminance greys for text, a blue/yellow accent pair (avoids the red-green confusion pairs; the shape cues from Task 6 cover the rarer blue-yellow deficiency this pair doesn't). Ratios computed and stated inline in the CSS comment (Task 7 Step 5).
- Non-colour in-tune cue: three redundant signals layered together — text (`✓ IN TUNE`), dial indicator shape (filled dot → ring), and a checkmark badge on the active string circle.
- Focus trap: re-queries focusable elements from the currently-visible panel on every keypress (not cached), so it survives the sheet's dynamic re-renders (tuning list changes, editor row count changes) without stale references; Escape and the trap share the same `closeSheet()`/`openSheet()` entry points as the pre-existing scrim-tap/Done handlers, so none of that logic was duplicated.
