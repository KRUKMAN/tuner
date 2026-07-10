# Package D — Strobe Display + Feedback Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a strobe-display alternative to the cents dial, a rewarding debounced in-tune moment (haptic + visual snap + optional chime) routed through a new master audio bus, and a friendlier mic first-run/error-recovery experience — without touching the DSP core.

**Architecture:** A new `js/ui/strobe.js` exposes a pure, Node-tested phase-accumulation function plus a browser `Strobe` canvas renderer that mirrors the existing `Dial`/`Graph` classes; both are driven purely by `DisplayState`. A sheet toggle (persisted via `store.js`) swaps which of `#dial`/`#strobe` is visible. `app.js#ensureAudioContext` gains a master `GainNode` bus that `ReferenceTone` and a new one-shot chime (built from `tone.js`'s now-exported `raisedCosineCurve`) both route through, and a debounced `ds.inTune` false→true edge in the render loop fires a haptic buzz, a CSS `tonepulse` snap on the dial, and the optional chime. `capture.js` gains a `track.onended` hook, and `app.js`/`controls.js` map `MicCapture`'s re-thrown `DOMException`s and mid-session track loss to friendly overlay states with a Retry button.

**Tech Stack:** Vanilla ES modules (no build step), Web Audio API (`GainNode` bus, raised-cosine envelopes), Canvas 2D (strobe renderer, mirrors the existing `Graph`), `navigator.vibrate` (progressive enhancement), the repo's zero-dependency Node test harness (`web/test/assert.js` + `run-all.js`).

## Global Constraints

- **No build step.** Hand-authored ES modules served as-is; no bundler/transpiler; no npm runtime dependencies. (verbatim from spec §1.1)
- **Pure vs. browser split.** `js/config.js`, `js/music/*`, and `js/dsp/*` stay Node-safe (no `window`/`document`/`AudioContext`/`performance`/`Date`) and are unit-tested in Node. Only `js/audio/*`, `js/ui/*`, and `js/app.js` touch browser APIs. (spec §1.2) — **this package's spec explicitly asks for one exception**: `js/ui/strobe.js` exports a pure, Node-safe helper (`strobePhaseDelta`) alongside its browser-only `Strobe` class. Nothing at that module's top level touches `window`/`document`/`AudioContext` (only inside `Strobe`'s methods, called at runtime), so importing just the helper in Node is safe — the same reason `js/ui/dial.js` is technically Node-importable today even though it's categorized as a browser module.
- **`CONFIG` is the single source of truth**, deep-frozen. No new inline numeric literals or globals in logic modules. (spec §1.3)
- **The Stabilizer is the only numeric smoother** and emits one `DisplayState` per frame; the UI renders `DisplayState` and nothing else. `Strobe` and the in-tune feedback logic consume `DisplayState`; they do not reach into the DSP. (spec §1.4)
- **Web Audio is created lazily on a user gesture** in `app.js#ensureAudioContext()` and resumed if suspended. Everything that makes sound shares that one `AudioContext`. (spec §1.6)
- **localStorage access is always wrapped in try/catch** and tolerant of absence — `store.js` already guarantees this. (spec §1.7)
- **Master gain bus** (spec §2.2): `ensureAudioContext()` also creates a single master `GainNode` connected to `destination`. `ReferenceTone` and the new in-tune chime connect to the master bus instead of `destination` directly, so simultaneous voices can't clip. `ReferenceTone` gains an optional `destination` constructor arg (defaults to `ctx.destination`, backward compatible). Package E's metronome will reuse this same bus — do not rename it.
- **Cache-list discipline:** `CORE_ASSETS` is hand-maintained; any file added/removed later must be reflected in it, and `CACHE` is bumped per *released* package. `test-sw-assets` enforces coverage. (spec §3)
- **`navigator.vibrate` is a no-op on iOS Safari** — progressive enhancement only, never depend on it. (spec §6 risks)
- Test harness idiom: each suite file default-exports a `run()` that calls `suite(name, fn)` + `assert`/`assertClose`, and is registered in `web/test/run-all.js`. Full suite is `node web/test/run-all.js` (exit 1 on any failure).
- **Sequencing note (not verbatim spec text):** per the task brief's explicit shared-file integration chain "B → D → E → F," this plan is written against the current repo plus Package B's landed changes only — it does **not** assume Package C (capo/A4 calibration) has landed, even though the roadmap's delivery order is A→B→C→D. All edits in this plan are anchored on code outside the areas Package B's own plan touches (the instrument-selector chips and the custom-tuning editor), so they should apply cleanly regardless of B's exact diff. If Package C lands before this plan is executed in practice, re-check the "Reference A4" section anchors in Tasks 3 and 4's `index.html` edits (Package C adds capo/preset UI there) before applying.

---

## File Structure

- `web/js/ui/strobe.js` **(new)** — pure `strobePhaseDelta(cents, dtSec)` phase-accumulation helper (Task 2) + browser `Strobe` canvas renderer (Task 3), mirroring `Dial`/`Graph`.
- `web/test/test-strobe.js` **(new)** — unit tests for `strobePhaseDelta`.
- `web/js/config.js` **(modify)** — new entries: `masterGain`, `strobeVelocityScale`, `strobeStripeCount`, `strobeBandHeightFrac`, `displayModeDefault`, `inTuneFeedbackDebounceMs`, `hapticVibrateMs`, `hapticDefaultOn`, `chimeDefaultOn`, `chimeFrequencyHz`, `chimeGain`, `chimeAttackMs`, `chimeReleaseMs`.
- `web/js/audio/tone.js` **(modify)** — export `raisedCosineCurve`; `ReferenceTone` gains an optional `destination` constructor arg.
- `web/js/audio/capture.js` **(modify)** — `MicCapture` gains an optional `onTrackEnded` constructor callback, wired to each track's `onended`.
- `web/js/app.js` **(modify)** — master gain bus in `ensureAudioContext`; `Strobe` instantiation + display-mode state/toggle/persistence; debounced in-tune edge → haptic/pulse/chime; mic error-name mapping + Retry; `handleMicDisconnected`.
- `web/js/ui/controls.js` **(modify)** — display-mode/haptic/chime toggle UI + `pulseInTune()`; overlay primer/status/Retry wiring; `setMicState` extended states.
- `web/index.html` **(modify)** — `#strobe` canvas + `#dialWrap` id; sheet "Display" + "In-tune feedback" sections; overlay primer/status/Retry markup.
- `web/css/styles.css` **(modify)** — shared `.dial, .strobe` box; `.in-tune-snap` animation (+ reduced-motion); `.feedback-row`/`.feedback-label`/`.seg-sm`; `.overlay-status`/`.retry-btn`.
- `web/sw.js` **(modify)** — add `./js/ui/strobe.js` to `CORE_ASSETS`; bump `CACHE`.
- `web/test/run-all.js` **(modify)** — register `test-strobe.js`.

---

### Task 1: Master gain bus + `ReferenceTone.destination` arg + export `raisedCosineCurve`

**Files:**
- Modify: `web/js/audio/tone.js`
- Modify: `web/js/config.js`
- Modify: `web/js/app.js`

**Interfaces:**
- Produces: `raisedCosineCurve(peak: number, rising: boolean, points?: number) => Float32Array` (exported); `new ReferenceTone({ audioContext, destination?, amplitude?, fadeInMs?, fadeOutMs? })` — `destination` defaults to `audioContext.destination`; `CONFIG.masterGain: number`; a module-level `masterGain: GainNode` in `app.js`, created once in `ensureAudioContext()`, consumed by Task 4's chime.

- [ ] **Step 1: Add `CONFIG.masterGain`**

In `web/js/config.js`, find:

```js
  detectLpfHarmonics: 5,         // detection LPF = maxTargetFundamental * this
  detectLpfMinHz: 500,           // floor so high strings keep enough harmonics
  harmonicityMin: 0.55,          // reject frames below this (broadband buzz/noise)
  targetSnapCents: 45,           // tuning-mode octave snap window to a target string

  modes: {
```

Replace with:

```js
  detectLpfHarmonics: 5,         // detection LPF = maxTargetFundamental * this
  detectLpfMinHz: 500,           // floor so high strings keep enough harmonics
  harmonicityMin: 0.55,          // reject frames below this (broadband buzz/noise)
  targetSnapCents: 45,           // tuning-mode octave snap window to a target string

  // --- Package D: master gain bus -------------------------------------------
  masterGain: 0.9,                // master bus gain (headroom so tone + chime can't clip)

  modes: {
```

- [ ] **Step 2: Export `raisedCosineCurve` and add a `destination` arg to `ReferenceTone`**

In `web/js/audio/tone.js`, change:

```js
function raisedCosineCurve(peak, rising, points = 64) {
```

to:

```js
/** Exported for reuse by the in-tune chime (js/app.js) and Package E's metronome click synth. */
export function raisedCosineCurve(peak, rising, points = 64) {
```

Then change the constructor:

```js
  constructor({ audioContext, amplitude = 0.25, fadeInMs = 10, fadeOutMs = 20 }) {
    if (!audioContext) throw new Error('ReferenceTone: audioContext is required');
    /** @private */ this._ctx = audioContext;
    /** @private */ this._amplitude = amplitude;
    /** @private */ this._fadeInMs = fadeInMs;
    /** @private */ this._fadeOutMs = fadeOutMs;
```

to:

```js
  constructor({ audioContext, destination, amplitude = 0.25, fadeInMs = 10, fadeOutMs = 20 }) {
    if (!audioContext) throw new Error('ReferenceTone: audioContext is required');
    /** @private */ this._ctx = audioContext;
    /** @private */ this._destination = destination || audioContext.destination;
    /** @private */ this._amplitude = amplitude;
    /** @private */ this._fadeInMs = fadeInMs;
    /** @private */ this._fadeOutMs = fadeOutMs;
```

And update the constructor's JSDoc block above it:

```js
  /**
   * @param {Object} opts
   * @param {AudioContext} opts.audioContext Shared context.
   * @param {AudioNode} [opts.destination]   Node to connect into; defaults to
   *   audioContext.destination. Pass the master bus so this shares headroom
   *   with other voices (e.g. the in-tune chime).
   * @param {number} [opts.amplitude=0.25]
   * @param {number} [opts.fadeInMs=10]
   * @param {number} [opts.fadeOutMs=20]
   */
```

Finally, in `play()`, change:

```js
    osc.connect(gain);
    gain.connect(ctx.destination);
```

to:

```js
    osc.connect(gain);
    gain.connect(this._destination);
```

- [ ] **Step 3: Create the master bus in `ensureAudioContext` and pass it to `ReferenceTone`**

In `web/js/app.js`, add a module-level variable next to the others near the top. Find:

```js
/** @type {AudioContext} */ let audioCtx = null;
/** @type {MicCapture} */   let capture = null;
/** @type {MPMDetector} */  let detector = null;
let preFilter = null;
/** @type {Stabilizer} */   let stabilizer = null;
/** @type {ReferenceTone} */ let tone = null;
```

Replace with:

```js
/** @type {AudioContext} */ let audioCtx = null;
/** @type {MicCapture} */   let capture = null;
/** @type {MPMDetector} */  let detector = null;
let preFilter = null;
/** @type {Stabilizer} */   let stabilizer = null;
/** @type {ReferenceTone} */ let tone = null;
/** @type {GainNode} */     let masterGain = null;
```

Then find:

```js
async function ensureAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    tone = new ReferenceTone({ audioContext: audioCtx });
  }
  if (audioCtx.state === 'suspended') await audioCtx.resume();
}
```

Replace with:

```js
async function ensureAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = CONFIG.masterGain;
    masterGain.connect(audioCtx.destination);
    tone = new ReferenceTone({ audioContext: audioCtx, destination: masterGain });
  }
  if (audioCtx.state === 'suspended') await audioCtx.resume();
}
```

- [ ] **Step 4: Run the test suite (no regressions)**

Run: `node web/test/run-all.js`
Expected: `ALL TESTS PASSED` — this task only touches browser audio code, so the Node suite must stay green.

- [ ] **Step 5: Manual verification**

```bash
node serve.mjs 8173
```

At `http://localhost:8173`: tap to start listening, pin or tap a string, tap the reference-tone (speaker) button. Expected: the tone is still clearly audible (routed through the new master bus, not silenced), no console errors. Optional: DevTools → Sources → open the page, or use the browser's Web Audio inspector (if available) to confirm the graph is `Oscillator → Gain → GainNode(master) → destination`.

- [ ] **Step 6: Commit**

```bash
git add web/js/audio/tone.js web/js/config.js web/js/app.js
git commit -m "feat(audio): master gain bus; ReferenceTone destination arg; export raisedCosineCurve"
```

---

### Task 2: Strobe phase-accumulation pure helper + tests

**Files:**
- Create: `web/js/ui/strobe.js` (pure helper only — the canvas renderer is added in Task 3)
- Create: `web/test/test-strobe.js`
- Modify: `web/js/config.js`
- Modify: `web/test/run-all.js`

**Interfaces:**
- Consumes: `CONFIG.inTuneCents` (existing), `CONFIG.strobeVelocityScale` (new, this task).
- Produces: `strobePhaseDelta(cents: number|null, dtSec: number) => number` — consumed by Task 3's `Strobe.render`.

**Design decision (documented here since it's not spelled out numerically in the spec):** "frozen when in tune" is implemented as a **dead-band at the exact same threshold `ds.inTune` uses** (`|cents| <= CONFIG.inTuneCents`), not literal point-proportionality that's merely zero at exactly 0 cents. Pure proportionality would still drift slowly at, say, 3 cents — which the rest of the UI already calls "in tune" (the label reads "IN TUNE", the dial recolors). Tying the freeze to the same `inTuneCents` constant makes the strobe visually lock at exactly the moment every other in-tune cue agrees, which is what "frozen when in tune" means in context. Outside that band, velocity is linearly proportional to `cents` as the spec asks.

- [ ] **Step 1: Add `CONFIG.strobeVelocityScale`**

In `web/js/config.js`, find:

```js
  // --- Package D: master gain bus -------------------------------------------
  masterGain: 0.9,                // master bus gain (headroom so tone + chime can't clip)

  modes: {
```

Replace with:

```js
  // --- Package D: master gain bus -------------------------------------------
  masterGain: 0.9,                // master bus gain (headroom so tone + chime can't clip)

  // --- Package D: strobe display ---------------------------------------------
  strobeVelocityScale: 1.2,       // px/sec phase drift per cent of mistuning, outside the dead-band

  modes: {
```

- [ ] **Step 2: Write the failing test**

Create `web/test/test-strobe.js`:

```js
// Node. Cases for js/ui/strobe.js's pure phase-accumulation helper.
import { suite, assert, assertClose } from './assert.js';
import { CONFIG } from '../js/config.js';
import { strobePhaseDelta } from '../js/ui/strobe.js';

/** Registers and runs the strobe-math suite. */
export default function run() {
  suite('strobe: zero at 0 cents', () => {
    assert(strobePhaseDelta(0, 1) === 0, 'strobePhaseDelta(0, dt) === 0');
  });

  suite('strobe: frozen inside the in-tune dead-band', () => {
    assert(strobePhaseDelta(CONFIG.inTuneCents, 1) === 0, 'exactly at +inTuneCents -> 0 (dead-band is inclusive)');
    assert(strobePhaseDelta(-CONFIG.inTuneCents, 1) === 0, 'exactly at -inTuneCents -> 0');
    assert(strobePhaseDelta(2, 1) === 0, 'well inside the dead-band -> 0');
  });

  suite('strobe: proportional to cents outside the dead-band', () => {
    const beyond = CONFIG.inTuneCents + 5; // clear of the dead-band
    assertClose(strobePhaseDelta(beyond, 1), beyond * CONFIG.strobeVelocityScale, 1e-9, 'sharp (positive) cents -> positive (rightward) delta');
    assertClose(strobePhaseDelta(-beyond, 1), -beyond * CONFIG.strobeVelocityScale, 1e-9, 'flat (negative) cents -> negative (leftward) delta');
  });

  suite('strobe: scales linearly with dt', () => {
    const beyond = CONFIG.inTuneCents + 10;
    const full = strobePhaseDelta(beyond, 1);
    const half = strobePhaseDelta(beyond, 0.5);
    assertClose(half, full / 2, 1e-9, 'half the elapsed time -> half the delta');
  });

  suite('strobe: sign flips exactly at the dead-band edge', () => {
    const justOutside = CONFIG.inTuneCents + 0.01;
    assert(strobePhaseDelta(justOutside, 1) > 0, 'just above +inTuneCents -> positive delta');
    assert(strobePhaseDelta(-justOutside, 1) < 0, 'just below -inTuneCents -> negative delta');
  });

  suite('strobe: degenerate inputs are inert', () => {
    assert(strobePhaseDelta(null, 1) === 0, 'null cents -> 0');
    assert(strobePhaseDelta(NaN, 1) === 0, 'NaN cents -> 0');
    assert(strobePhaseDelta(20, 0) === 0, 'zero dt -> 0');
    assert(strobePhaseDelta(20, -1) === 0, 'negative dt -> 0');
  });
}
```

Register it in `web/test/run-all.js` — add the import after the existing imports and the call after the existing calls:

```js
import runStrobe from './test-strobe.js';
```
```js
runStrobe();
```

(Place `import runStrobe` alongside the other `import run…` lines near the top, and `runStrobe();` alongside the other `run…();` calls before `const ok = report();`.)

- [ ] **Step 3: Run test to verify it fails**

Run: `node web/test/run-all.js`
Expected: FAIL — the `strobe:` suites throw with something like `Cannot find module '../js/ui/strobe.js'` reported as `[strobe: …] THREW`, and the final summary shows FAILED.

- [ ] **Step 4: Write the minimal implementation**

Create `web/js/ui/strobe.js`:

```js
// js/ui/strobe.js
// The pure helper (strobePhaseDelta) is Node-safe: this file has no top-level
// window/document/AudioContext access, so it is directly importable from Node
// tests. The browser-only Strobe canvas renderer is appended to this file in
// a later step of this plan.
//
// Strobe display: an alternative to the cents dial — a horizontal band of
// repeating stripes whose phase accumulates at a rate proportional to
// DisplayState.cents: drifts left when flat, right when sharp, and is frozen
// (zero velocity) whenever the reading is within the SAME |cents| <=
// CONFIG.inTuneCents dead-band that DisplayState.inTune itself uses — so the
// strobe visually locks at exactly the moment the rest of the UI calls the
// note "in tune". Consumes DisplayState + an injected timestamp only; no DSP
// change.

import { CONFIG } from '../config.js';

/**
 * Pure phase-accumulation step for one frame.
 * @param {number|null} cents  DisplayState.cents (may be null when blank)
 * @param {number} dtSec       elapsed seconds since the previous frame (>= 0)
 * @returns {number} signed phase delta in px contributed by this frame; 0
 *   when cents is null/non-finite, dtSec is not a positive finite number, or
 *   |cents| <= CONFIG.inTuneCents (frozen).
 */
export function strobePhaseDelta(cents, dtSec) {
  if (cents == null || !Number.isFinite(cents)) return 0;
  if (!Number.isFinite(dtSec) || dtSec <= 0) return 0;
  if (Math.abs(cents) <= CONFIG.inTuneCents) return 0;
  return cents * CONFIG.strobeVelocityScale * dtSec;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node web/test/run-all.js`
Expected: PASS — the six `strobe:` suites all print `PASS`, and the summary ends with `ALL TESTS PASSED`.

- [ ] **Step 6: Commit**

```bash
git add web/js/ui/strobe.js web/test/test-strobe.js web/test/run-all.js web/js/config.js
git commit -m "feat(strobe): pure phase-accumulation helper + tests"
```

---

### Task 3: Strobe canvas display + dial⇄strobe toggle

**Files:**
- Modify: `web/js/ui/strobe.js` (append the `Strobe` class)
- Modify: `web/js/config.js`
- Modify: `web/sw.js`
- Modify: `web/index.html`
- Modify: `web/css/styles.css`
- Modify: `web/js/app.js`
- Modify: `web/js/ui/controls.js`

**Interfaces:**
- Consumes: `strobePhaseDelta` (Task 2), `store.get`/`store.set` (existing), `DisplayState` (existing).
- Produces: `new Strobe(canvas, opts?) => { setColors(colors), reset(), resize(), render(ds, nowMs) }`; `Controls#setDisplayModeUI(mode: 'dial'|'strobe')`; `cb.onDisplayModeChange(mode)`.

**Design decisions:**
- **DOM placement:** the `<canvas id="strobe">` lives inside `.dial-wrap`, right next to `#dial`, sized identically (same `clamp(220px, 80vw, 320px)` square, same `z-index: 4`) so toggling doesn't reflow the layout. Internally it only paints a horizontal band across the vertical middle (`CONFIG.strobeBandHeightFrac` of the canvas height) so it reads as a "band of stripes," not a filled square, and the note name/octave text (`z-index: 3`, underneath) stays legible either way.
- **Toggle ownership:** `controls.js`'s header comment states it "owns all non-dial/non-trail DOM" — the dial and (now) the strobe canvas are owned directly by `app.js`, which already does `dial.render(ds)` in `loop()` without going through `controls`. So `app.js` toggles `#dial`/`#strobe`'s `hidden` attribute directly; `controls.js` only owns the **seg-button toggle control** in the sheet and reports clicks via `cb.onDisplayModeChange`.

- [ ] **Step 1: Add the remaining strobe CONFIG entries**

In `web/js/config.js`, find:

```js
  // --- Package D: strobe display ---------------------------------------------
  strobeVelocityScale: 1.2,       // px/sec phase drift per cent of mistuning, outside the dead-band

  modes: {
```

Replace with:

```js
  // --- Package D: strobe display ---------------------------------------------
  strobeVelocityScale: 1.2,       // px/sec phase drift per cent of mistuning, outside the dead-band
  strobeStripeCount: 12,          // stripes across the band at rest
  strobeBandHeightFrac: 0.22,     // stripe band height as a fraction of the canvas size
  displayModeDefault: 'dial',     // 'dial' | 'strobe'

  modes: {
```

- [ ] **Step 2: Append the `Strobe` canvas renderer**

At the end of `web/js/ui/strobe.js` (after the `strobePhaseDelta` function), add:

```js

export class Strobe {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {Object} [opts]
   * @param {number} [opts.stripeCount]
   */
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.stripeCount = opts.stripeCount ?? CONFIG.strobeStripeCount;
    this.w = 0;
    this.h = 0;
    this._phase = 0;       // px, wrapped to one stripe-pair spacing
    this._lastMs = null;
    this._colors = { accent: '#4cc2f2', accentIn: '#34d399' };
    this.resize();
  }

  /** @param {{accent:string, accentIn:string}} colors */
  setColors(colors) {
    this._colors = {
      accent: colors.accent ?? this._colors.accent,
      accentIn: colors.accentIn ?? this._colors.accentIn,
    };
  }

  /**
   * Resets the phase clock. Call before showing the strobe again after it was
   * hidden, so a stale elapsed-time gap doesn't produce one large phase jump.
   */
  reset() {
    this._phase = 0;
    this._lastMs = null;
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    const size = Math.max(1, Math.round(rect.width || this.canvas.clientWidth || 1));
    this.w = size;
    this.h = size;
    this.canvas.width = Math.round(size * dpr);
    this.canvas.height = Math.round(size * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /**
   * @param {import('../dsp/stabilizer.js').DisplayState} ds
   * @param {number} nowMs  performance.now()
   */
  render(ds, nowMs) {
    const active = ds.status === 'active' || ds.status === 'hold';
    const dtSec = this._lastMs == null ? 0 : Math.max(0, (nowMs - this._lastMs) / 1000);
    this._lastMs = nowMs;

    const spacing = this.w / this.stripeCount;
    if (active && ds.cents != null && spacing > 0) {
      const delta = strobePhaseDelta(ds.cents, dtSec);
      this._phase = ((this._phase + delta) % spacing + spacing) % spacing;
    }

    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    if (!active) return;

    const bandH = this.h * CONFIG.strobeBandHeightFrac;
    const bandY = (this.h - bandH) / 2;
    ctx.fillStyle = ds.inTune ? this._colors.accentIn : this._colors.accent;
    for (let x = -spacing + this._phase; x < this.w + spacing; x += spacing) {
      ctx.fillRect(x, bandY, spacing / 2, bandH);
    }
  }
}
```

- [ ] **Step 3: Register `strobe.js` in the service-worker precache and bump `CACHE`**

In `web/sw.js`, add the new module to `CORE_ASSETS`. Find:

```js
  './js/ui/controls.js',
  './js/ui/dial.js',
  './js/ui/graph.js',
```

Replace with:

```js
  './js/ui/controls.js',
  './js/ui/dial.js',
  './js/ui/graph.js',
  './js/ui/strobe.js',
```

Then bump the `CACHE` version by one integer from whatever it currently reads (this repo snapshot has it at `tuner-cache-v2`; if Package B already landed and bumped it per the spec §3 discipline, bump one further from B's value instead — e.g. `tuner-cache-v2` → `tuner-cache-v3`, or `tuner-cache-v3` → `tuner-cache-v4` if B already moved it to v3). Find:

```js
const CACHE = 'tuner-cache-v2';
```

Replace with (adjust the number to be exactly one higher than whatever is currently in the file):

```js
const CACHE = 'tuner-cache-v3';
```

- [ ] **Step 4: Add the `#strobe` canvas and `#dialWrap` id to `index.html`**

In `web/index.html`, find:

```html
        <div class="dial-wrap">
```

Replace with:

```html
        <div class="dial-wrap" id="dialWrap">
```

Then find:

```html
          <svg class="dial" id="dial" viewBox="0 0 300 300" aria-hidden="true">
            <path id="dialTrack" class="dial-track" d="M 56.72 243.28 A 132 132 0 1 1 243.28 243.28" />
            <path id="dialZone" class="dial-zone" d="M 119.16 21.55 A 132 132 0 0 1 180.84 21.55" />
            <g id="dialTicks" class="dial-ticks"></g>
            <path id="dialProgress" class="dial-progress" d="" />
            <circle id="dialIndicator" class="dial-indicator" cx="150" cy="18" r="7" />
          </svg>
          <div class="note-main" id="noteMain">
```

Replace with:

```html
          <svg class="dial" id="dial" viewBox="0 0 300 300" aria-hidden="true">
            <path id="dialTrack" class="dial-track" d="M 56.72 243.28 A 132 132 0 1 1 243.28 243.28" />
            <path id="dialZone" class="dial-zone" d="M 119.16 21.55 A 132 132 0 0 1 180.84 21.55" />
            <g id="dialTicks" class="dial-ticks"></g>
            <path id="dialProgress" class="dial-progress" d="" />
            <circle id="dialIndicator" class="dial-indicator" cx="150" cy="18" r="7" />
          </svg>
          <canvas class="strobe" id="strobe" aria-hidden="true" hidden></canvas>
          <div class="note-main" id="noteMain">
```

- [ ] **Step 5: Add the "Display" toggle to the sheet**

In `web/index.html`, find:

```html
        <div class="a4-row">
          <button class="a4-step" id="a4Down" type="button">−</button>
          <div class="a4-display"><span id="a4Big">440</span> Hz</div>
          <button class="a4-step" id="a4Up" type="button">+</button>
        </div>
        <button class="sheet-done" id="sheetDone" type="button">Done</button>
```

Replace with:

```html
        <div class="a4-row">
          <button class="a4-step" id="a4Down" type="button">−</button>
          <div class="a4-display"><span id="a4Big">440</span> Hz</div>
          <button class="a4-step" id="a4Up" type="button">+</button>
        </div>
        <div class="sheet-section-title">Display</div>
        <div class="seg" id="displaySeg">
          <button class="seg-btn is-on" data-display="dial" type="button">Dial</button>
          <button class="seg-btn" data-display="strobe" type="button">Strobe</button>
        </div>
        <button class="sheet-done" id="sheetDone" type="button">Done</button>
```

- [ ] **Step 6: Share the dial/strobe box CSS**

In `web/css/styles.css`, find:

```css
.dial {
  position: absolute;
  z-index: 4;
  pointer-events: none;
  width: clamp(220px, 80vw, 320px);
  height: clamp(220px, 80vw, 320px);
  opacity: calc(0.35 + 0.65 * var(--conf, 0));
  transition: opacity 160ms linear;
}
```

Replace with:

```css
.dial, .strobe {
  position: absolute;
  z-index: 4;
  pointer-events: none;
  width: clamp(220px, 80vw, 320px);
  height: clamp(220px, 80vw, 320px);
  opacity: calc(0.35 + 0.65 * var(--conf, 0));
  transition: opacity 160ms linear;
}
```

- [ ] **Step 7: Wire `app.js` — instantiate `Strobe`, add display-mode state + persistence + toggle**

In `web/js/app.js`, add the import. Find:

```js
import { Dial } from './ui/dial.js';
```

Replace with:

```js
import { Dial } from './ui/dial.js';
import { Strobe } from './ui/strobe.js';
```

Add display-mode to `state`. Find:

```js
const state = {
  instrument: 'guitar',      // which preset list is shown
  mode: 'guitar',            // DSP profile (CONFIG.modes key) — derived from the tuning
  tuningId: 'guitar-standard',
  a4: CONFIG.a4Default,
  running: false,
  starting: false,
  tonePlaying: null,
  lockedString: null,        // pinned string index; null = auto string select
  customTunings: [],         // [{id,name,instrument,strings}]
};
```

Replace with:

```js
const state = {
  instrument: 'guitar',      // which preset list is shown
  mode: 'guitar',            // DSP profile (CONFIG.modes key) — derived from the tuning
  tuningId: 'guitar-standard',
  a4: CONFIG.a4Default,
  running: false,
  starting: false,
  tonePlaying: null,
  lockedString: null,        // pinned string index; null = auto string select
  customTunings: [],         // [{id,name,instrument,strings}]
  displayMode: CONFIG.displayModeDefault,  // 'dial' | 'strobe'
};
```

Update the graph-colors pusher to also feed the strobe. Find:

```js
function pushGraphColors() {
  graph.setColors({ accent: accentColor, accentIn: accentInColor, grid: cssVar('--muted-2') || '#556' });
}
```

Replace with:

```js
function pushGraphColors() {
  const colors = { accent: accentColor, accentIn: accentInColor, grid: cssVar('--muted-2') || '#556' };
  graph.setColors(colors);
  strobe.setColors(colors);
}
```

Restore the persisted display mode. Find:

```js
(() => {
  const saved = store.get('tuner-theme', null);
  if (saved) { root.setAttribute('data-theme', saved); applyThemeColor(saved); }
})();
```

Replace with:

```js
(() => {
  const saved = store.get('tuner-theme', null);
  if (saved) { root.setAttribute('data-theme', saved); applyThemeColor(saved); }
})();
(() => {
  const dm = store.get('tuner-display-mode', null);
  if (dm === 'dial' || dm === 'strobe') state.displayMode = dm;
})();
```

Instantiate `Strobe` alongside `Dial`. Find:

```js
/* ---------- UI modules ---------- */
cacheColors();
const trail = new TrailBuffer({ capacity: 1024, windowMs: 5000 });
const dial = new Dial(document.getElementById('dial'), { rangeCents: 50 });
const graph = new Graph(document.getElementById('trail'), { rangeCents: 50, windowMs: 5000, inTuneCents: CONFIG.inTuneCents });
pushGraphColors();
graph.resize();
```

Replace with:

```js
/* ---------- UI modules ---------- */
cacheColors();
const trail = new TrailBuffer({ capacity: 1024, windowMs: 5000 });
const dialEl = document.getElementById('dial');
const strobeEl = document.getElementById('strobe');
const dial = new Dial(dialEl, { rangeCents: 50 });
const strobe = new Strobe(strobeEl, {});
const graph = new Graph(document.getElementById('trail'), { rangeCents: 50, windowMs: 5000, inTuneCents: CONFIG.inTuneCents });
pushGraphColors();
graph.resize();
```

Add the `setDisplayMode` handler, right after `changeA4`. Find:

```js
function toggleTone(index) {
```

Replace with:

```js
/** @param {'dial'|'strobe'} mode */
function setDisplayMode(mode) {
  state.displayMode = mode === 'strobe' ? 'strobe' : 'dial';
  store.set('tuner-display-mode', state.displayMode);
  dialEl.hidden = state.displayMode !== 'dial';
  strobeEl.hidden = state.displayMode !== 'strobe';
  if (state.displayMode === 'strobe') { strobe.reset(); strobe.resize(); }
  controls.setDisplayModeUI(state.displayMode);
}

function toggleTone(index) {
```

Wire the callback into `Controls`. Find:

```js
const controls = new Controls(document, {
  onMicStart: startMic,
  onModeChange: changeInstrument,
  onTuningChange: changeTuning,
  onA4Change: changeA4,
  onStringSelect: selectString,
  onAuto: handleAuto,
  onToneToggle: toggleTone,
  onThemeToggle: applyTheme,
  onCustomSave: saveCustom,
  onCustomDelete: deleteCustom,
});
```

Replace with:

```js
const controls = new Controls(document, {
  onMicStart: startMic,
  onModeChange: changeInstrument,
  onTuningChange: changeTuning,
  onA4Change: changeA4,
  onStringSelect: selectString,
  onAuto: handleAuto,
  onToneToggle: toggleTone,
  onThemeToggle: applyTheme,
  onCustomSave: saveCustom,
  onCustomDelete: deleteCustom,
  onDisplayModeChange: setDisplayMode,
});
```

Apply the restored mode to the DOM at startup. Find:

```js
// initial UI reflects (possibly restored) default state
controls.setInstrument(state.instrument);
controls.setCustomTunings(state.customTunings);
controls.setA4(state.a4);
controls.setTuning(resolveTuning(state.tuningId), state.a4);
controls.setMicState('idle');
```

Replace with:

```js
// initial UI reflects (possibly restored) default state
controls.setInstrument(state.instrument);
controls.setCustomTunings(state.customTunings);
controls.setA4(state.a4);
controls.setTuning(resolveTuning(state.tuningId), state.a4);
controls.setMicState('idle');
setDisplayMode(state.displayMode);
```

Resize the strobe on window resize too. Find:

```js
window.addEventListener('resize', () => graph.resize());
```

Replace with:

```js
window.addEventListener('resize', () => { graph.resize(); strobe.resize(); });
```

Render whichever display is active in the loop. Find:

```js
  const active = ds.status === 'active' || ds.status === 'hold';
  trail.push(now, active && ds.cents != null ? ds.cents : NaN, ds.confidence, ds.inTune);
  graph.render(trail, now);
  dial.render(ds);
  controls.update(ds);
```

Replace with:

```js
  const active = ds.status === 'active' || ds.status === 'hold';
  trail.push(now, active && ds.cents != null ? ds.cents : NaN, ds.confidence, ds.inTune);
  graph.render(trail, now);
  if (state.displayMode === 'strobe') strobe.render(ds, now); else dial.render(ds);
  controls.update(ds);
```

- [ ] **Step 8: Wire `controls.js` — the Display seg toggle**

In `web/js/ui/controls.js`, update the constructor's JSDoc. Find:

```js
   * @param {(theme:'dark'|'light') => void} cb.onThemeToggle
```

Replace with:

```js
   * @param {(theme:'dark'|'light') => void} cb.onThemeToggle
   * @param {(mode:'dial'|'strobe') => void} cb.onDisplayModeChange
```

Cache the new DOM ref. Find:

```js
    this.tuningList = this.$('tuningList');
```

Replace with:

```js
    this.tuningList = this.$('tuningList');
    this.displaySeg = this.$('displaySeg');
```

Wire the click handlers. Find:

```js
    this.$('themeBtn').addEventListener('click', () => {
      const cur = this.doc.documentElement.getAttribute('data-theme') || 'dark';
      cb.onThemeToggle(cur === 'dark' ? 'light' : 'dark');
    });
  }
```

Replace with:

```js
    this.$('themeBtn').addEventListener('click', () => {
      const cur = this.doc.documentElement.getAttribute('data-theme') || 'dark';
      cb.onThemeToggle(cur === 'dark' ? 'light' : 'dark');
    });

    this.displaySeg.querySelectorAll('.seg-btn').forEach((btn) => {
      btn.addEventListener('click', () => cb.onDisplayModeChange(btn.dataset.display));
    });
  }
```

Add the `setDisplayModeUI` method. Find:

```js
  setA4(a4) {
```

Replace with:

```js
  /** @param {'dial'|'strobe'} mode */
  setDisplayModeUI(mode) {
    this.displaySeg.querySelectorAll('.seg-btn').forEach((b) => {
      b.classList.toggle('is-on', b.dataset.display === mode);
    });
  }

  setA4(a4) {
```

- [ ] **Step 9: Run tests (no regressions)**

Run: `node web/test/run-all.js`
Expected: `ALL TESTS PASSED` — this task is entirely browser DOM/canvas/persistence code plus one new `CORE_ASSETS` entry that `test-sw-assets` should now find satisfied.

- [ ] **Step 10: Manual verification**

```bash
node serve.mjs 8173
```

At `http://localhost:8173`: open the sheet, tap **Strobe**. Expected: the dial ring disappears and a horizontal stripe band appears in its place. Start the mic and play/hum a note: when flat, the stripes drift one direction; sharp, the other; as the note locks in tune, the stripes visibly stop moving and the band turns the in-tune accent color. Toggle back to **Dial** — the ring reappears. Reload the page — the previously chosen mode (dial or strobe) persists. Resize the browser window while on strobe — the band re-fits without artifacts.

- [ ] **Step 11: Commit**

```bash
git add web/js/ui/strobe.js web/js/config.js web/sw.js web/index.html web/css/styles.css web/js/app.js web/js/ui/controls.js
git commit -m "feat(strobe): canvas display + dial⇄strobe toggle"
```

---

### Task 4: In-tune feedback — haptic + dial snap + optional chime

**Files:**
- Modify: `web/js/config.js`
- Modify: `web/index.html`
- Modify: `web/css/styles.css`
- Modify: `web/js/ui/controls.js`
- Modify: `web/js/app.js`

**Interfaces:**
- Consumes: `raisedCosineCurve`, `masterGain` (Task 1); `DisplayState.inTune` (existing).
- Produces: `Controls#pulseInTune()`, `Controls#setHaptic(on)`, `Controls#setChime(on)`; `cb.onHapticToggle(on)`, `cb.onChimeToggle(on)`.

**Design decisions:**
- **What's gated by what.** The spec's "gated behind a settings toggle and `prefers-reduced-motion`" is implemented per-mechanism, matching how the rest of this codebase already handles motion preferences (see the existing `@media (prefers-reduced-motion: reduce)` block that neutralizes `.note-swap`/`.dot`/`.tone-btn.is-playing` animations in CSS, not via `matchMedia()` calls in JS): the **haptic buzz** and **chime** are each gated solely by their own persisted settings toggle (haptic default **on**, chime default **off** — vibration and audio aren't "motion"); the **visual dial snap** always fires (it's core in-tune feedback, like the existing `.in-tune` recolor), but its CSS animation is added to the existing reduced-motion media query so it's automatically suppressed for users with that OS preference — no extra JS branching needed.
- **Debounce.** `ds.inTune` is a per-frame boolean with no built-in hysteresis, so cents hovering right at the `±CONFIG.inTuneCents` boundary could flicker true/false across frames. Feedback fires once per sustained streak: a streak-start timestamp is recorded on the first `true` frame, and feedback only fires once `now - streakStart >= CONFIG.inTuneFeedbackDebounceMs` (and only once per streak, via a `fired` latch). Any `false` frame resets both, so the very next sustained streak can fire again — this satisfies "debounce to the edge so stabilizer jitter doesn't retrigger."

- [ ] **Step 1: Add the feedback CONFIG entries**

In `web/js/config.js`, find:

```js
  // --- Package D: strobe display ---------------------------------------------
  strobeVelocityScale: 1.2,       // px/sec phase drift per cent of mistuning, outside the dead-band
  strobeStripeCount: 12,          // stripes across the band at rest
  strobeBandHeightFrac: 0.22,     // stripe band height as a fraction of the canvas size
  displayModeDefault: 'dial',     // 'dial' | 'strobe'

  modes: {
```

Replace with:

```js
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
```

- [ ] **Step 2: Add the "In-tune feedback" toggles to the sheet**

In `web/index.html`, find:

```html
        <div class="sheet-section-title">Display</div>
        <div class="seg" id="displaySeg">
          <button class="seg-btn is-on" data-display="dial" type="button">Dial</button>
          <button class="seg-btn" data-display="strobe" type="button">Strobe</button>
        </div>
        <button class="sheet-done" id="sheetDone" type="button">Done</button>
```

Replace with:

```html
        <div class="sheet-section-title">Display</div>
        <div class="seg" id="displaySeg">
          <button class="seg-btn is-on" data-display="dial" type="button">Dial</button>
          <button class="seg-btn" data-display="strobe" type="button">Strobe</button>
        </div>
        <div class="sheet-section-title">In-tune feedback</div>
        <div class="sheet-row feedback-row">
          <span class="feedback-label">Haptic</span>
          <div class="seg seg-sm" id="hapticSeg">
            <button class="seg-btn is-on" data-on="1" type="button">On</button>
            <button class="seg-btn" data-on="0" type="button">Off</button>
          </div>
        </div>
        <div class="sheet-row feedback-row">
          <span class="feedback-label">Chime</span>
          <div class="seg seg-sm" id="chimeSeg">
            <button class="seg-btn" data-on="1" type="button">On</button>
            <button class="seg-btn is-on" data-on="0" type="button">Off</button>
          </div>
        </div>
        <button class="sheet-done" id="sheetDone" type="button">Done</button>
```

- [ ] **Step 3: Add the snap animation + feedback-row CSS**

In `web/css/styles.css`, find:

```css
.dial-indicator {
  fill: var(--accent);
  filter: drop-shadow(0 0 10px rgba(76, 194, 242, 0.75));
  transition: cx 120ms cubic-bezier(0.33, 1, 0.68, 1),
              cy 120ms cubic-bezier(0.33, 1, 0.68, 1),
              fill 300ms ease;
}
```

Replace with:

```css
.dial-indicator {
  fill: var(--accent);
  filter: drop-shadow(0 0 10px rgba(76, 194, 242, 0.75));
  transition: cx 120ms cubic-bezier(0.33, 1, 0.68, 1),
              cy 120ms cubic-bezier(0.33, 1, 0.68, 1),
              fill 300ms ease;
}
.in-tune-snap { animation: tonepulse 260ms ease-in-out 1; }
```

Add the reduced-motion exemption. Find:

```css
@media (prefers-reduced-motion: reduce) {
  .dot, .str.is-playing, .tone-btn.is-playing { animation: none; }
  .note-swap { animation: none; }
  .note-main, .note-state, .note-sub { transition: opacity 120ms linear; }
  .dial-indicator, .dial-progress { transition: fill 300ms ease, stroke 300ms ease; }
}
```

Replace with:

```css
@media (prefers-reduced-motion: reduce) {
  .dot, .str.is-playing, .tone-btn.is-playing { animation: none; }
  .note-swap { animation: none; }
  .in-tune-snap { animation: none; }
  .note-main, .note-state, .note-sub { transition: opacity 120ms linear; }
  .dial-indicator, .dial-progress { transition: fill 300ms ease, stroke 300ms ease; }
}
```

Add the feedback-row layout, near the A4/sheet-done rules. Find:

```css
.sheet-done {
  width: 100%;
  margin-top: 22px;
  padding: 14px;
  border-radius: 13px;
  border: 0;
  background: var(--accent);
  color: var(--bg-bot);
  font: 600 15px 'Space Grotesk', sans-serif;
  cursor: pointer;
}
```

Replace with:

```css
.feedback-row { display: flex; align-items: center; justify-content: space-between; margin: 10px 0; }
.feedback-label { font: 500 14px 'Space Grotesk', sans-serif; color: var(--ink); }
.seg-sm .seg-btn { padding: 6px 14px; font: 500 13px 'Space Grotesk', sans-serif; }
.sheet-done {
  width: 100%;
  margin-top: 22px;
  padding: 14px;
  border-radius: 13px;
  border: 0;
  background: var(--accent);
  color: var(--bg-bot);
  font: 600 15px 'Space Grotesk', sans-serif;
  cursor: pointer;
}
```

- [ ] **Step 4: Wire `controls.js` — haptic/chime toggles + `pulseInTune`**

In `web/js/ui/controls.js`, update the constructor JSDoc. Find:

```js
   * @param {(mode:'dial'|'strobe') => void} cb.onDisplayModeChange
```

Replace with:

```js
   * @param {(mode:'dial'|'strobe') => void} cb.onDisplayModeChange
   * @param {(on:boolean) => void} cb.onHapticToggle
   * @param {(on:boolean) => void} cb.onChimeToggle
```

Cache the new DOM refs. Find:

```js
    this.tuningList = this.$('tuningList');
    this.displaySeg = this.$('displaySeg');
```

Replace with:

```js
    this.tuningList = this.$('tuningList');
    this.displaySeg = this.$('displaySeg');
    this.dialWrap = this.$('dialWrap');
    this.hapticSeg = this.$('hapticSeg');
    this.chimeSeg = this.$('chimeSeg');
```

Wire the click handlers. Find:

```js
    this.displaySeg.querySelectorAll('.seg-btn').forEach((btn) => {
      btn.addEventListener('click', () => cb.onDisplayModeChange(btn.dataset.display));
    });
  }
```

Replace with:

```js
    this.displaySeg.querySelectorAll('.seg-btn').forEach((btn) => {
      btn.addEventListener('click', () => cb.onDisplayModeChange(btn.dataset.display));
    });
    this.hapticSeg.querySelectorAll('.seg-btn').forEach((btn) => {
      btn.addEventListener('click', () => cb.onHapticToggle(btn.dataset.on === '1'));
    });
    this.chimeSeg.querySelectorAll('.seg-btn').forEach((btn) => {
      btn.addEventListener('click', () => cb.onChimeToggle(btn.dataset.on === '1'));
    });
  }
```

Add the new methods, right after `setDisplayModeUI`. Find:

```js
  setA4(a4) {
```

Replace with:

```js
  /** @param {boolean} on */
  setHaptic(on) {
    this.hapticSeg.querySelectorAll('.seg-btn').forEach((b) => {
      b.classList.toggle('is-on', (b.dataset.on === '1') === !!on);
    });
  }

  /** @param {boolean} on */
  setChime(on) {
    this.chimeSeg.querySelectorAll('.seg-btn').forEach((b) => {
      b.classList.toggle('is-on', (b.dataset.on === '1') === !!on);
    });
  }

  /** One-shot visual "snap" on the in-tune false->true edge; reuses the tonepulse keyframe. */
  pulseInTune() {
    this.dialWrap.classList.remove('in-tune-snap');
    void this.dialWrap.offsetWidth; // restart the animation
    this.dialWrap.classList.add('in-tune-snap');
  }

  setA4(a4) {
```

- [ ] **Step 5: Wire `app.js` — settings state, debounce, chime playback**

In `web/js/app.js`, import `raisedCosineCurve`. Find:

```js
import { ReferenceTone } from './audio/tone.js';
```

Replace with:

```js
import { ReferenceTone, raisedCosineCurve } from './audio/tone.js';
```

Extend `state` with the settings + debounce fields. Find:

```js
const state = {
  instrument: 'guitar',      // which preset list is shown
  mode: 'guitar',            // DSP profile (CONFIG.modes key) — derived from the tuning
  tuningId: 'guitar-standard',
  a4: CONFIG.a4Default,
  running: false,
  starting: false,
  tonePlaying: null,
  lockedString: null,        // pinned string index; null = auto string select
  customTunings: [],         // [{id,name,instrument,strings}]
  displayMode: CONFIG.displayModeDefault,  // 'dial' | 'strobe'
};
```

Replace with:

```js
const state = {
  instrument: 'guitar',      // which preset list is shown
  mode: 'guitar',            // DSP profile (CONFIG.modes key) — derived from the tuning
  tuningId: 'guitar-standard',
  a4: CONFIG.a4Default,
  running: false,
  starting: false,
  tonePlaying: null,
  lockedString: null,        // pinned string index; null = auto string select
  customTunings: [],         // [{id,name,instrument,strings}]
  displayMode: CONFIG.displayModeDefault,  // 'dial' | 'strobe'
  haptic: CONFIG.hapticDefaultOn,
  chime: CONFIG.chimeDefaultOn,
  inTuneStreakStartMs: null,  // ms timestamp the current in-tune streak started, null when not in tune
  inTuneFired: false,         // true once feedback has fired for the current streak
};
```

Restore the persisted toggles. Find:

```js
(() => {
  const dm = store.get('tuner-display-mode', null);
  if (dm === 'dial' || dm === 'strobe') state.displayMode = dm;
})();
```

Replace with:

```js
(() => {
  const dm = store.get('tuner-display-mode', null);
  if (dm === 'dial' || dm === 'strobe') state.displayMode = dm;
})();
(() => {
  const h = store.get('tuner-haptic', null);
  if (typeof h === 'boolean') state.haptic = h;
  const c = store.get('tuner-chime', null);
  if (typeof c === 'boolean') state.chime = c;
})();
```

Reset the debounce fields whenever the engine is rebuilt (mirrors the existing `lastStringIndex = null` reset). Find:

```js
  stabilizer.setLockedString(state.lockedString);
  trail.clear();
  lastStringIndex = null;
}
```

Replace with:

```js
  stabilizer.setLockedString(state.lockedString);
  trail.clear();
  lastStringIndex = null;
  state.inTuneStreakStartMs = null;
  state.inTuneFired = false;
}
```

Add the setters, right after `stopTone()`. Find:

```js
function stopTone() {
  if (tone) tone.stop();
  state.tonePlaying = null;
  controls.setTonePlaying(null);
}
```

Replace with:

```js
function stopTone() {
  if (tone) tone.stop();
  state.tonePlaying = null;
  controls.setTonePlaying(null);
}

function setHaptic(on) {
  state.haptic = !!on;
  store.set('tuner-haptic', state.haptic);
  controls.setHaptic(state.haptic);
}

function setChime(on) {
  state.chime = !!on;
  store.set('tuner-chime', state.chime);
  controls.setChime(state.chime);
}

/** Fires haptic + a visual dial snap + optional chime; called once per debounced in-tune edge. */
function triggerInTuneFeedback() {
  if (state.haptic && navigator.vibrate) {
    try { navigator.vibrate(CONFIG.hapticVibrateMs); } catch { /* ignore */ }
  }
  controls.pulseInTune();
  if (state.chime) playChime();
}

/** One-shot soft chime: a raised-cosine attack/release envelope through the master bus. */
function playChime() {
  if (!audioCtx || !masterGain) return;
  const ctx = audioCtx;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(CONFIG.chimeFrequencyHz, now);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, now);
  osc.connect(gain);
  gain.connect(masterGain);
  const attack = CONFIG.chimeAttackMs / 1000;
  const release = CONFIG.chimeReleaseMs / 1000;
  gain.gain.setValueCurveAtTime(raisedCosineCurve(CONFIG.chimeGain, true), now, attack);
  gain.gain.setValueCurveAtTime(raisedCosineCurve(CONFIG.chimeGain, false), now + attack, release);
  osc.start(now);
  osc.stop(now + attack + release);
  osc.onended = () => {
    try { osc.disconnect(); } catch { /* ignore */ }
    try { gain.disconnect(); } catch { /* ignore */ }
  };
}
```

Wire the two new callbacks into `Controls`. Find:

```js
  onCustomSave: saveCustom,
  onCustomDelete: deleteCustom,
  onDisplayModeChange: setDisplayMode,
});
```

Replace with:

```js
  onCustomSave: saveCustom,
  onCustomDelete: deleteCustom,
  onDisplayModeChange: setDisplayMode,
  onHapticToggle: setHaptic,
  onChimeToggle: setChime,
});
```

Sync the initial toggle UI. Find:

```js
controls.setMicState('idle');
setDisplayMode(state.displayMode);
```

Replace with:

```js
controls.setMicState('idle');
setDisplayMode(state.displayMode);
controls.setHaptic(state.haptic);
controls.setChime(state.chime);
```

Add the debounced edge-detection to the render loop. Find:

```js
  const active = ds.status === 'active' || ds.status === 'hold';
  trail.push(now, active && ds.cents != null ? ds.cents : NaN, ds.confidence, ds.inTune);
```

Replace with:

```js
  const active = ds.status === 'active' || ds.status === 'hold';

  // In-tune feedback: fire once per sustained false->true streak (debounced so
  // single-frame stabilizer jitter right at the threshold can't retrigger it).
  if (ds.inTune) {
    if (state.inTuneStreakStartMs == null) state.inTuneStreakStartMs = now;
    if (!state.inTuneFired && now - state.inTuneStreakStartMs >= CONFIG.inTuneFeedbackDebounceMs) {
      state.inTuneFired = true;
      triggerInTuneFeedback();
    }
  } else {
    state.inTuneStreakStartMs = null;
    state.inTuneFired = false;
  }

  trail.push(now, active && ds.cents != null ? ds.cents : NaN, ds.confidence, ds.inTune);
```

- [ ] **Step 6: Run tests (no regressions)**

Run: `node web/test/run-all.js`
Expected: `ALL TESTS PASSED`.

- [ ] **Step 7: Manual verification**

```bash
node serve.mjs 8173
```

At `http://localhost:8173`: start the mic and tune a string into pitch. Expected: as the note crosses into tune, the dial (or strobe) area briefly flashes/pulses once, and — on a phone or a device that honors `navigator.vibrate` — a short buzz fires. It should not re-fire repeatedly while holding the note in tune (only once per approach). Open the sheet and flip **Chime** to On, tune a string again: a soft, short "ding" plays through the speakers alongside the pulse. Flip **Haptic** off and confirm no vibration call is attempted (no error either way, since `navigator.vibrate` is a no-op on unsupported browsers). In DevTools → Rendering → "Emulate CSS media feature prefers-reduced-motion: reduce," tune a string in: the pulse animation no longer visibly plays, but haptic/chime (if enabled) still fire.

- [ ] **Step 8: Commit**

```bash
git add web/js/config.js web/index.html web/css/styles.css web/js/ui/controls.js web/js/app.js
git commit -m "feat(feedback): in-tune haptic + dial snap + optional chime"
```

---

### Task 5: Mic primer + friendly error mapping + Retry

**Files:**
- Modify: `web/index.html`
- Modify: `web/css/styles.css`
- Modify: `web/js/ui/controls.js`
- Modify: `web/js/app.js`

**Interfaces:**
- Consumes: `startMic` (existing, reused directly as `cb.onRetry`).
- Produces: `Controls#setMicState(state, message)` extended to accept `'notfound'` and (Task 6) `'disconnected'` in addition to the existing `'idle'|'requesting'|'running'|'denied'|'error'`.

- [ ] **Step 1: Split the overlay into a static primer + a dynamic status/Retry area**

In `web/index.html`, find:

```html
    <!-- Start overlay -->
    <div class="overlay" id="overlay">
      <div class="overlay-card">
        <div class="overlay-title">Tuner</div>
        <div class="overlay-sub" id="overlaySub">Guitar &amp; bass · precise &amp; steady · on‑device</div>
        <button class="start-btn" id="startBtn" type="button">Tap to start listening</button>
        <div class="overlay-note" id="overlayNote">Uses your microphone. Nothing leaves the device.</div>
      </div>
    </div>
```

Replace with:

```html
    <!-- Start overlay -->
    <div class="overlay" id="overlay">
      <div class="overlay-card">
        <div class="overlay-title">Tuner</div>
        <div class="overlay-sub" id="overlaySub">Guitar &amp; bass · precise &amp; steady · on‑device</div>
        <button class="start-btn" id="startBtn" type="button">Tap to start listening</button>
        <div class="overlay-note">Needs your microphone to detect pitch. Audio is analyzed on this device and never leaves it.</div>
        <div class="overlay-status" id="overlayStatus" hidden></div>
        <button class="retry-btn" id="retryBtn" type="button" hidden>Retry</button>
      </div>
    </div>
```

- [ ] **Step 2: Add `.overlay-status`/`.retry-btn` CSS**

In `web/css/styles.css`, find:

```css
.overlay-note { margin-top: 16px; font: 400 12px 'JetBrains Mono', monospace; color: var(--muted-2); }
.overlay-note.is-error { color: var(--accent-flat); }
```

Replace with:

```css
.overlay-note { margin-top: 16px; font: 400 12px 'JetBrains Mono', monospace; color: var(--muted-2); }
.overlay-status { margin-top: 10px; font: 400 12px 'JetBrains Mono', monospace; color: var(--muted-2); }
.overlay-status.is-error { color: var(--accent-flat); }
.retry-btn {
  margin-top: 14px;
  padding: 11px 22px;
  border-radius: 12px;
  border: 1px solid var(--surface-brd);
  background: var(--surface);
  color: var(--ink);
  font: 600 14px 'Space Grotesk', sans-serif;
  cursor: pointer;
}
.retry-btn:active { transform: scale(0.97); }
```

- [ ] **Step 3: Wire `controls.js` — Retry button + extended `setMicState`**

In `web/js/ui/controls.js`, update the constructor JSDoc. Find:

```js
   * @param {(id:string) => void} cb.onCustomDelete
   */
```

Replace with:

```js
   * @param {(id:string) => void} cb.onCustomDelete
   * @param {() => void} cb.onRetry Retry button on the mic error/disconnected overlay.
   */
```

Replace the dead `overlayNote` DOM ref with the new ones. Find:

```js
    this.overlay = this.$('overlay');
    this.overlayNote = this.$('overlayNote');
```

Replace with:

```js
    this.overlay = this.$('overlay');
    this.overlayStatus = this.$('overlayStatus');
    this.retryBtn = this.$('retryBtn');
```

Wire the Retry click. Find:

```js
    this.$('sheetDone').addEventListener('click', () => this.closeSheet());
    this.scrim.addEventListener('click', () => this.closeSheet());
```

Replace with:

```js
    this.$('sheetDone').addEventListener('click', () => this.closeSheet());
    this.scrim.addEventListener('click', () => this.closeSheet());
    this.retryBtn.addEventListener('click', () => cb.onRetry());
```

Rewrite `setMicState`. Find:

```js
  setMicState(state, message) {
    this._micRunning = state === 'running';
    this.autoDot.classList.toggle('is-idle', state !== 'running');
    if (state === 'running') { this.overlay.classList.add('is-hidden'); return; }
    this.overlay.classList.remove('is-hidden');
    this.overlayNote.classList.toggle('is-error', state === 'denied' || state === 'error');
    if (message) this.overlayNote.textContent = message;
    else if (state === 'requesting') this.overlayNote.textContent = 'Requesting microphone…';
    else if (state === 'denied') this.overlayNote.textContent = 'Microphone blocked. Allow it in your browser and reload.';
  }
```

Replace with:

```js
  setMicState(state, message) {
    this._micRunning = state === 'running';
    this.autoDot.classList.toggle('is-idle', state !== 'running');
    if (state === 'running') {
      this.overlay.classList.add('is-hidden');
      this.overlayStatus.hidden = true;
      this.retryBtn.hidden = true;
      return;
    }
    this.overlay.classList.remove('is-hidden');
    const isError = state === 'denied' || state === 'notfound' || state === 'error' || state === 'disconnected';
    this.overlayStatus.classList.toggle('is-error', isError);
    this.retryBtn.hidden = !isError;
    if (message) {
      this.overlayStatus.textContent = message;
      this.overlayStatus.hidden = false;
    } else if (state === 'requesting') {
      this.overlayStatus.textContent = 'Requesting microphone…';
      this.overlayStatus.hidden = false;
    } else {
      this.overlayStatus.hidden = true;
    }
  }
```

- [ ] **Step 4: Map error names + wire Retry in `app.js`**

In `web/js/app.js`, replace the `startMic` catch block. Find:

```js
  } catch (err) {
    const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
    controls.setMicState(denied ? 'denied' : 'error',
      denied ? undefined : `Could not start audio: ${err && err.message ? err.message : err}`);
  } finally {
    state.starting = false;
  }
}
```

Replace with:

```js
  } catch (err) {
    const name = err && err.name;
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      controls.setMicState('denied', 'Microphone access is blocked. Allow it for this site in your browser settings, then retry.');
    } else if (name === 'NotFoundError') {
      controls.setMicState('notfound', 'No microphone found. Connect one and retry.');
    } else {
      controls.setMicState('error', `Could not start audio: ${err && err.message ? err.message : err}`);
    }
  } finally {
    state.starting = false;
  }
}
```

Wire `onRetry` to the existing `startMic` function. Find:

```js
  onHapticToggle: setHaptic,
  onChimeToggle: setChime,
});
```

Replace with:

```js
  onHapticToggle: setHaptic,
  onChimeToggle: setChime,
  onRetry: startMic,
});
```

- [ ] **Step 5: Run tests (no regressions)**

Run: `node web/test/run-all.js`
Expected: `ALL TESTS PASSED`.

- [ ] **Step 6: Manual verification**

```bash
node serve.mjs 8173
```

At `http://localhost:8173`: confirm the overlay shows the permanent primer line ("Needs your microphone…") before tapping start. Tap **Tap to start listening** and deny the browser's mic permission prompt. Expected: the overlay shows "Microphone access is blocked…" in the amber error color, with a **Retry** button. Click Retry — the browser either re-prompts or (if already permanently blocked at the browser level) shows the same denied state again, which is correct. (The `NotFoundError` → "No microphone found" path is symmetric code and is verified by inspection here; it's awkward to trigger locally without physically removing all audio input devices.)

- [ ] **Step 7: Commit**

```bash
git add web/index.html web/css/styles.css web/js/ui/controls.js web/js/app.js
git commit -m "feat(mic): primer copy + friendly error mapping + retry"
```

---

### Task 6: Mid-session mic disconnect recovery

**Files:**
- Modify: `web/js/audio/capture.js`
- Modify: `web/js/app.js`

**Interfaces:**
- Consumes: `Controls#setMicState('disconnected', message)` (Task 5's extended states already cover this — no further `controls.js` change needed).
- Produces: `new MicCapture({ audioContext, windowSize, onTrackEnded? })` — `onTrackEnded` is called at most once per `start()`, only while `state === 'running'`.

- [ ] **Step 1: Add the `onTrackEnded` hook to `MicCapture`**

In `web/js/audio/capture.js`, update the constructor. Find:

```js
  constructor({ audioContext, windowSize }) {
    if (!audioContext) throw new Error('MicCapture: audioContext is required');
    /** @private */ this._ctx = audioContext;
    /** @private */ this._windowSize = windowSize;
```

Replace with:

```js
  constructor({ audioContext, windowSize, onTrackEnded }) {
    if (!audioContext) throw new Error('MicCapture: audioContext is required');
    /** @private */ this._ctx = audioContext;
    /** @private */ this._windowSize = windowSize;
    /** @private @type {(() => void)|null} */
    this._onTrackEnded = typeof onTrackEnded === 'function' ? onTrackEnded : null;
```

Wire it up in `start()`. Find:

```js
      this._stream = stream;
      this._source = this._ctx.createMediaStreamSource(stream);
      this._source.connect(this._analyser);
      // Deliberately do NOT connect analyser -> destination (avoid feedback loop).

      this._state = 'running';
```

Replace with:

```js
      this._stream = stream;
      this._source = this._ctx.createMediaStreamSource(stream);
      this._source.connect(this._analyser);
      // Deliberately do NOT connect analyser -> destination (avoid feedback loop).

      // Surface mid-session mic loss (device unplugged, permission revoked while
      // running, etc). track.stop() in stop() below does NOT dispatch 'ended' per
      // spec, so this only fires for genuine external loss — the `_state !==
      // 'running'` guard is defensive belt-and-braces on top of that.
      for (const track of stream.getTracks()) {
        track.onended = () => {
          if (this._state !== 'running') return;
          this._state = 'error';
          if (this._onTrackEnded) this._onTrackEnded();
        };
      }

      this._state = 'running';
```

- [ ] **Step 2: Handle disconnect in `app.js`**

Pass the hook when constructing `MicCapture`. Find:

```js
    capture = new MicCapture({ audioContext: audioCtx, windowSize: 2 * CONFIG.modes[mode].windowSize });
```

Replace with:

```js
    capture = new MicCapture({ audioContext: audioCtx, windowSize: 2 * CONFIG.modes[mode].windowSize, onTrackEnded: handleMicDisconnected });
```

Add the handler right after `startMic`. Find:

```js
  } finally {
    state.starting = false;
  }
}

/* ---------- controls handlers ---------- */
```

Replace with:

```js
  } finally {
    state.starting = false;
  }
}

function handleMicDisconnected() {
  state.running = false;
  cancelAnimationFrame(rafId);
  controls.setMicState('disconnected', 'Microphone disconnected. Tap Retry to reconnect.');
}

/* ---------- controls handlers ---------- */
```

- [ ] **Step 3: Run tests (no regressions)**

Run: `node web/test/run-all.js`
Expected: `ALL TESTS PASSED`.

- [ ] **Step 4: Manual verification**

```bash
node serve.mjs 8173
```

At `http://localhost:8173`: start the mic. If using an external/USB microphone, physically unplug it. Expected: the tuner stops updating, the overlay reappears with "Microphone disconnected. Tap Retry to reconnect." and a **Retry** button, and no errors spam the console (the rAF loop is cancelled). Plug the mic back in and click **Retry** — the mic restarts normally. (If no external mic is available, an equivalent trigger is revoking the site's mic permission mid-session from the browser's page-info/site-settings panel, which most browsers also surface as a track `ended` event.)

- [ ] **Step 5: Commit**

```bash
git add web/js/audio/capture.js web/js/app.js
git commit -m "feat(mic): detect mid-session disconnect via track.onended"
```

---

## Self-Review

**Spec coverage (spec §6 Package D + §2.2 master bus):**
- §2.2 master gain bus + `ReferenceTone.destination` arg → Task 1. ✓
- §6.1 strobe display: dial⇄strobe toggle (default dial, persisted), phase proportional to cents, frozen when in tune, pure Node-testable helper, dedicated canvas shown/hidden opposite the dial → Tasks 2 (pure math + tests) + 3 (canvas + toggle). ✓
- §6.2 in-tune feedback: `wasInTune`-style edge (implemented as a debounced streak, stronger than a bare latch), `navigator.vibrate`, one-frame dial snap reusing `tonepulse`, optional chime from `raisedCosineCurve` via the master bus (default off), haptic default on, gated behind settings + `prefers-reduced-motion`, debounced → Task 4. ✓
- §6.3 mic primer + error recovery: overlay primer line (why + on-device), `NotAllowedError`→blocked+Retry, `NotFoundError`→no mic found, `track.onended`→disconnected+Retry → Tasks 5 (primer + denied/notfound + Retry) + 6 (mid-session `track.onended`). ✓
- Cache-list discipline: `strobe.js` added to `CORE_ASSETS` + `CACHE` bumped in the same task that introduces the file (Task 3), per spec §3 — it's the only new shipped file in this package. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full, exact content (complete functions/classes, not fragments described in prose) and exact commands with expected output. The one place I deliberately left an adjustable value (the `CACHE` version-bump target in Task 3 Step 3) is flagged explicitly as depending on Package B's actual landed state, with a concrete worked example given either way — this is a real external dependency, not an unresolved placeholder. ✓

**Type/name consistency:** `strobePhaseDelta(cents, dtSec)` — same signature in Task 2's tests, Task 2's implementation, and Task 3's `Strobe.render` caller. `Strobe` class methods (`setColors`, `reset`, `resize`, `render`) are defined once in Task 3 and match every call site in Task 3 (`app.js`) and Task 4 (no strobe calls there). `CONFIG` keys (`masterGain`, `strobeVelocityScale`, `strobeStripeCount`, `strobeBandHeightFrac`, `displayModeDefault`, `inTuneFeedbackDebounceMs`, `hapticVibrateMs`, `hapticDefaultOn`, `chimeDefaultOn`, `chimeFrequencyHz`, `chimeGain`, `chimeAttackMs`, `chimeReleaseMs`) are each introduced once and referenced with identical spelling in every later task that uses them. `store` keys (`tuner-display-mode`, `tuner-haptic`, `tuner-chime`) match between the `set()` calls (in `setDisplayMode`/`setHaptic`/`setChime`) and the `get()` restores. `MicCapture`'s `onTrackEnded` constructor option name matches the `handleMicDisconnected` reference passed at the `new MicCapture(...)` call site in Task 6. `Controls#setMicState` states (`'idle'|'requesting'|'running'|'denied'|'notfound'|'error'|'disconnected'`) are consistent between Task 5's rewrite and Task 6's `handleMicDisconnected` call. ✓

**Ordering:** Task 1 (master bus + `raisedCosineCurve` export) precedes Task 4 (chime, which consumes both). Task 2 (pure strobe math) precedes Task 3 (canvas renderer, which imports `strobePhaseDelta`). Task 5 (adds the `'denied'`/`'notfound'`/Retry states + button) precedes Task 6 (adds `'disconnected'`, reusing the same button/CSS/JSDoc pattern Task 5 established). Tasks 3 and 4 both insert into the sheet immediately before `#sheetDone`, in that order, so the final sheet layout is Tuning → Reference A4 → Display → In-tune feedback → Done. ✓
