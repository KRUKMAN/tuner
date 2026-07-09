# Tuner Feature Roadmap — Design

**Date:** 2026-07-09
**Status:** Draft for review
**Author:** Jakub + Claude

## Summary

The tuner today is a single-screen, monophonic, guitar/bass-only PWA with a strong
DSP core (FFT-based MPM/NSDF pitch engine, adaptive-gate stabilizer, dial + pitch
trail). This roadmap adds six work-packages that broaden it into a practice hub
without disturbing the DSP core:

- **A. Offline-first** — real precache, self-hosted fonts, per-theme colour, CI test gate.
- **B. Instrument registry + custom-tuning fixes** — data-driven instruments (ukulele,
  mandolin, violin, banjo, baritone), and a repaired/expanded custom-tuning editor.
- **C. Capo/transpose + calibration** — capo/transpose shift, wider/finer A4 calibration.
  (Alternate temperaments + per-string offsets are deferred — designed in
  `future-temperament-engine.md`.)
- **D. Strobe display + feedback polish** — dial⇄strobe toggle, in-tune haptics/snap,
  first-run mic primer + error recovery.
- **E. Metronome + mode navigation** — Tuner|Metronome switch and a custom-meter metronome.
- **F. Accessibility pass** — spoken note (`aria-live`), focus-trapped sheet, non-colour
  in-tune cues, high-contrast theme.

Explicitly **out of scope this round:** alternate temperaments + per-string cent offsets
(designed and documented for later in `future-temperament-engine.md`), URL/QR tuning
sharing, polyphonic "strum-all" full-neck tuning, ear-training/play-along.

Delivery: this single roadmap spec is approved up front; packages are then built in
order **A → B → C → D → E → F**, each with its own implementation plan, verification,
and a light check-in before the next begins.

---

## 1. Architecture invariants (every package must preserve these)

These are the load-bearing properties of the current codebase. No package may break them.

1. **No build step.** Static ES modules served as-is. No bundler, no transpile, no npm
   runtime deps. New code is hand-authored ESM.
2. **Pure vs. browser module split.** `js/config.js`, `js/music/*`, and `js/dsp/*` are
   **pure and Node-safe** (no `window`, `document`, `AudioContext`, `performance`,
   `Date`). They are unit-tested in Node via `web/test/run-all.js`. Only `js/audio/*`,
   `js/ui/*`, and `js/app.js` touch browser APIs. **New pure logic goes in pure modules
   so it stays testable;** browser wrappers stay thin.
3. **`CONFIG` is the single source of truth**, deep-frozen (`config.js`). All new numeric
   parameters go into `CONFIG` (or a sub-block), never inline literals or globals.
4. **The Stabilizer is the only numeric smoother** and emits one `DisplayState` per frame;
   the UI renders `DisplayState` and nothing else. New display features consume
   `DisplayState`; they do not reach into the DSP.
5. **Timestamps are injected**, never read from `Date`/`performance` inside pure modules.
6. **Web Audio is created lazily on a user gesture** in `app.js#ensureAudioContext()` and
   resumed if suspended. Everything that makes sound shares that one `AudioContext`.
7. **localStorage access is always wrapped in try/catch** and tolerant of absence.

---

## 2. Cross-cutting infrastructure (introduced early, reused by later packages)

Three small shared pieces are introduced before/within the packages that first need them.

### 2.1 `js/store.js` — tiny persistence helper (Package A)
A thin wrapper over the existing per-key try/catch localStorage pattern:
`get(key, fallback)` / `set(key, value)` with JSON encode/decode and silent failure.
Existing keys (`tuner-custom-tunings`, `tuner-last-tuning`, `tuner-theme`) are migrated to
it opportunistically as each is touched. New settings use it. No global settings blob —
one key per concern keeps it debuggable and matches the current style.

### 2.2 Master gain bus (introduced in Package D, reused by tone + chime + metronome)
`ensureAudioContext()` also creates a single **master `GainNode`** connected to
`destination`. `ReferenceTone`, the in-tune chime (D), and the metronome (E) connect to the
master bus instead of `destination` directly, so simultaneous voices (e.g. a held reference
tone + an in-tune chime) can't clip. `ReferenceTone` gains an optional `destination`
constructor arg (defaults to `ctx.destination` to stay backward compatible). The bus is
first created in Package D (the first feature that can sound a second concurrent voice);
Package E connects the metronome to the same bus.

### 2.3 `state.uiMode` + mode navigation (Package E)
`app.js` gains `state.uiMode: 'tuner' | 'metronome'`. Tuner and metronome are **mutually
exclusive**: entering metronome stops capture (`capture.stop()`, cancel rAF) and releases
the mic; returning to tuner restarts it. A segmented control in the header switches modes.

---

## 3. Package A — Offline-first

**Goal.** Make "nothing leaves the device" true and make the app genuinely usable offline,
including a cold first-offline launch.

### Design
- **Service worker rewrite (`web/sw.js`)**, strategy **stale-while-revalidate over a
  precached app shell**:
  - `install`: `caches.open(CACHE).addAll(CORE_ASSETS)` then `skipWaiting()`. `CORE_ASSETS`
    is an explicit, hand-maintained list of every shipped file (HTML, CSS, all JS modules,
    manifest, icons, fonts).
  - `activate`: delete every cache whose name ≠ current `CACHE`, then `clients.claim()`.
  - `fetch` (GET, same-origin): respond from cache immediately if present, and in the
    background fetch + update the cache (only when `response.ok`). Cache miss → network,
    cache if ok. Navigation requests fall back to cached `index.html` when offline.
  - **Never cache non-OK responses** (drops the current bug where a 404/500 body is cached).
  - `CACHE` name carries a version string bumped on release (e.g. `tuner-cache-v2`).
- **Cache-list discipline.** Because `CORE_ASSETS` is hand-maintained, **every later package
  that adds a JS/font/asset file MUST add it to `CORE_ASSETS` and bump `CACHE`.** This is a
  checklist item in each subsequent plan. A tiny node test (`test-sw-assets`) cross-checks
  the `CORE_ASSETS` list against the module import graph / file list to catch omissions.
- **Self-host fonts.** Download the Latin-subset `woff2` files for Space Grotesk + JetBrains
  Mono into `web/fonts/`, add `@font-face` rules to `styles.css` with `font-display: swap`,
  and remove the three Google Fonts `<link>`s from `index.html`. Add `.woff2 →
  font/woff2` to the `serve.mjs` MIME map. (Google's served subset files are used as-is; no
  custom subsetting pipeline, to respect the no-build ethos.)
- **Dynamic `theme-color`.** `applyTheme()` updates `<meta name="theme-color">` to match
  the active theme's background so the mobile status bar matches light/dark.
- **CI test gate.** `.github/workflows/deploy.yml` runs `node web/test/run-all.js` before
  the publish step (the runner already exits non-zero on failure). Add a `"test"` script to
  `web/package.json`.
- **(Optional, low-cost) update toast.** On SW `controllerchange` / a new worker activating,
  show a small "New version — tap to reload" toast. Included if cheap; cut if it complicates.

### Files
New: `web/fonts/*.woff2`, `web/js/store.js`, `web/test/test-sw-assets.js`.
Changed: `web/sw.js`, `web/index.html`, `web/css/styles.css`, `serve.mjs`,
`.github/workflows/deploy.yml`, `web/package.json`, `web/js/app.js` (theme-color; store.js migration).

### Tests
- `test-sw-assets`: `CORE_ASSETS` covers all shipped JS modules + assets (guards the
  hand-maintained list).
- Manual: DevTools offline, hard-reload → app boots; fonts render with no network; theme
  toggle updates status-bar colour.

### Risks
- Hand-maintained asset list drifts → mitigated by `test-sw-assets` + per-package checklist.
- Font subset missing a glyph (♯, ♭, ·, note letters) → verify the used glyph set.

---

## 4. Package B — Instrument registry + custom-tuning fixes

**Goal.** Replace the hardcoded `'guitar'|'bass'` union with data so instruments are just
table rows, and repair/expand the custom-tuning editor.

### Design

**4.1 Instrument registry (`js/music/instruments.js`, pure).**
```
INSTRUMENTS = [
  { id, label, defaultTuningId, order }
  ...
]
```
Registry is the single source for: the instrument selector, `DEFAULT_TUNING`,
`tuningsFor()` grouping, and custom-tuning classification. DSP profile is **still derived
from frequency** by the existing `engineModeFor()` (lowest string < 70 Hz → bass engine),
so most new instruments need only a row + presets — no DSP change.

New instruments (as tuning data in `tunings.js`, tagged with their `instrument` id):
- **Ukulele** — standard reentrant (G4 C4 E4 A4) and Low-G variant.
- **Mandolin** — G3 D4 A4 E5 (4 courses as 4 pitches).
- **Violin** — G3 D4 A4 E5.
- **Banjo** — 5-string open G (g D G B D, reentrant).
- **Baritone guitar** — B1 E2 A2 D3 F#3 B3.

**Reentrant caveat:** the tuning model orders strings low→high by pitch (index 0 = lowest).
Reentrant instruments (ukulele high-G, banjo 5th) are stored in **pitch order**; physical
string layout labelling is a known simplification, acceptable for a tuner. Documented, not
solved this round.

**4.2 Instrument selector UI.** The two hardcoded `.seg` buttons become a **horizontally
scrollable row of instrument chips** rendered from the registry (reusing `.seg-btn`
styling). Selecting an instrument selects its `defaultTuningId`. Fits the existing sheet.

**4.3 Custom-tuning editor fixes (`controls.js`, `app.js`, `tunings.js`).**
Concrete defects fixed:
- **Misclassification:** `onCustomSave` gains an `instrument` argument; `controls.js`
  passes `this._instrument`; `app.js#saveCustom` forwards it to `makeCustomTuning(...,
  instrument)`. A low custom guitar tuning is no longer saved as bass.
- **Edit-in-place:** wire the currently-dead `_editId`. Add an "edit" affordance on each
  custom tuning row (`_renderTuningList`); `_openEditor(seed, id)` seeds `_editId` so Save
  upserts the existing entry instead of creating a duplicate.
- **1–8 strings:** replace the fixed `[4,5,6,7]` count control with a −/＋ stepper spanning
  1–8 (the data model + `validateTuningStrings` already allow 1–8).
- **Note picker:** each string row gets a note-name + octave picker (dropdown) in addition
  to the −/＋ semitone nudge, so users can set a pitch directly.
- **Focus-preserving render:** editing a string re-renders only the affected row (or
  preserves the name-input value/focus across re-render) so a typed name isn't lost when
  nudging a string.

### Files
New: `web/js/music/instruments.js`, `web/test/test-instruments.js`.
Changed: `web/js/music/tunings.js` (presets + registry-aware helpers),
`web/js/ui/controls.js` (selector + editor), `web/js/app.js` (`DEFAULT_TUNING` from
registry, `saveCustom` instrument arg), `web/index.html` (selector container),
`web/css/styles.css` (chips, note picker), `web/sw.js` (`CORE_ASSETS` + version bump).

### Tests
- `test-instruments`: registry integrity (unique ids, valid `defaultTuningId`), `tuningsFor`
  covers every instrument, `makeCustomTuning` honours explicit instrument.
- Extend `test-theory`/tunings tests for new presets' note math.
- Manual: create/edit/delete a custom tuning; verify low custom guitar stays "guitar".

### Risks
- Selector must stay usable with 6–8 instruments on a narrow phone → horizontal scroll +
  clear active state.
- Reentrant labelling simplification — documented above.

---

## 5. Package C — Capo/transpose + A4 calibration

**Goal.** Let players shift the whole instrument (capo/transpose) and calibrate the
reference pitch more widely and finely — without touching the octave-snap logic.

> Alternate temperaments + per-string cent offsets were removed from this package and
> **deferred**; their full design lives in `future-temperament-engine.md`. That is the only
> part of the original Package C that needed a Stabilizer refactor, so this package is now
> small and low-risk.

### Design

**5.1 Capo / transpose.** A global integer **capo** setting (range −5…+12 semitones) shifts
every string's MIDI before the engine is built (`buildEngine`). Because targets already flow
through `frequencyFromMidi(midi, a4)`, a MIDI shift makes `engineModeFor`, reference tones,
string labels, and octave-snap all shift consistently (capo = sounding pitch). It is a pure
one-line transform on `tuning.strings`; **no Stabilizer changes.** One stepper in the sheet;
0 by default; clearly labelled (sounding pitch).

**5.2 A4 calibration.** Widen `CONFIG.a4Min/a4Max` to **410…470** (covers 415 baroque, 432,
440, 444+). Support **fractional** A4 (0.1 Hz): `changeA4` no longer rounds to integer; the
display shows one decimal when non-integer; `Stabilizer.setA4` already clamps. Quick-preset
chips **415 / 432 / 440 / 444**. Steppers get **long-press auto-repeat** (rAF-driven) for
fast travel; fine step 0.1 Hz on the A4 stepper.

### Files
Changed: `web/js/config.js` (a4 range + presets, capo default),
`web/js/app.js` (capo state + MIDI shift in `buildEngine`; fractional A4 in `changeA4`),
`web/js/ui/controls.js` + `web/index.html` + `web/css/styles.css` (capo stepper, A4 presets,
fractional display, long-press repeat), `web/sw.js` (assets + version).

### Tests
- Extend tuning/theory tests: capo shift produces the expected target frequencies; fractional
  A4 produces the expected cents.
- Manual: capo +2 retargets standard to F♯–B–E–A–C♯–F♯; 432 Hz preset; long-press ramps A4.

### Risks
- Fractional A4 removes an integer assumption in the readout formatting → audit the A4
  display + cents rounding (small, covered by tests).
- A large capo can push the lowest string across the guitar↔bass engine boundary in
  `engineModeFor` — that is correct/intended behaviour; verify the boundary.

---

## 6. Package D — Strobe display + feedback polish

**Goal.** A precise strobe view, a rewarding in-tune moment, and a friendlier first run.

### Design

**6.1 Strobe display (`js/ui/strobe.js`, browser).** A **dial ⇄ strobe toggle** in the
sheet (default dial; choice persisted via `store.js`). Strobe is a horizontal band of
repeating stripes (or a ring of segments reusing `dial.js` polar math) whose phase
accumulates over time at a rate proportional to `ds.cents`: **drifts left when flat, right
when sharp, visually frozen when in tune.** Consumes `DisplayState.cents` + an injected
timestamp; no DSP change. Rendered on a small dedicated canvas shown/hidden opposite the
dial.

**6.2 In-tune feedback (edge-triggered).** On the `ds.inTune` **false→true** edge (a
`wasInTune` latch): `navigator.vibrate` (short), a one-frame dial "snap"/ring pulse (reuse
existing `tonepulse`/`autopulse` CSS keyframes). Optional soft raised-cosine **chime**
(reusing `tone.js#raisedCosineCurve`, routed through the master bus), **default off**.
All gated behind a settings toggle and `prefers-reduced-motion`; **haptic default on**
(no-op on iOS Safari — progressive enhancement). Debounced to the edge so stabilizer jitter
doesn't retrigger.

**6.3 Mic primer + error recovery (`app.js`, `controls.js`, `capture.js`).**
- **Primer:** the start overlay gains one line explaining why the mic is needed and that
  audio never leaves the device (reuses `.overlay`).
- **Error mapping:** `capture.start()` already re-throws the original DOMException; map
  `NotAllowedError`→"blocked, here's how + Retry", `NotFoundError`→"no mic found". Add a
  **Retry** button (re-runs `startMic`).
- **Mid-session loss:** attach `track.onended` in `capture.start()` to surface a "mic
  disconnected — Retry" state instead of silently freezing.

### Files
New: `web/js/ui/strobe.js`, `web/test/test-strobe.js` (pure phase-accumulation math
extracted to a testable helper).
Changed: `web/js/app.js` (display-mode state, in-tune edge, mic error/retry, track.onended,
**master gain bus in `ensureAudioContext`**), `web/js/ui/controls.js` (toggle, primer,
error/retry UI, settings toggles), `web/js/audio/capture.js` (track.onended),
`web/js/audio/tone.js` (export `raisedCosineCurve`; optional master-bus `destination` arg),
`web/index.html`, `web/css/styles.css`, `web/sw.js`.

### Tests
- `test-strobe`: phase-accumulation helper (given cents + dt → phase delta; zero at 0 cents).
- Manual: strobe freezes in tune; haptic fires once per lock; deny mic → friendly + retry;
  unplug mic → recovery state.

### Risks
- `navigator.vibrate` ignored on iOS → treat as enhancement, never depend on it.
- Strobe render cost on low-end phones → cap redraw to rAF, simple geometry.

---

## 7. Package E — Metronome + mode navigation

**Goal.** A metronome that is trivially simple on its face (big BPM, tap, start/stop, default
4/4) but supports **any** meter: arbitrary beat counts, additive/asymmetric groups
(3+2+2), per-beat 4-state accents (accent/normal/ghost/rest), and per-beat subdivision.

### Design

**7.1 Mode navigation.** Header segmented control **Tuner | Metronome** drives
`state.uiMode`. Switching to metronome stops capture and the rAF tuner loop and releases the
mic; switching back restarts. Views are separate DOM sections toggled by `hidden`.

**7.2 Meter model (`js/music/meter.js`, pure, Node-tested).**
A bar is an array of beats:
```
beat = { accent: 'accent'|'normal'|'ghost'|'rest', subdivision: 1|2|3|4, group?: number }
```
There is **no fixed set of signatures** — any array length is a valid meter; 5/8 is 5
beats, 3+2+2 is 7 beats whose group-first beats carry the 'accent' level. **BPM counts the
pulse: one pill = one beat = one 60/bpm interval.** A displayed time-signature label (e.g.
"7/8") is cosmetic; the array is the source of truth. A pure `expandBar(bar, bpm) →
[{ timeOffsetSec, level }]` computes click event times for one bar (beat duration = 60/bpm;
`subdivision` inserts N evenly-spaced clicks inside the beat, first at the beat's accent
level, the rest at a fixed 'sub' level). Fully unit-testable without audio.

**7.3 Scheduler + click synth (`js/audio/metronome.js`, browser — the one genuinely new
Web-Audio primitive).** A **look-ahead scheduler** ("Tale of Two Clocks"): a `setTimeout`
pump (~25 ms) schedules every click whose time falls within a ~100 ms look-ahead window
using `ctx.currentTime` + `osc.start(when)`. **Never** `setInterval`-driven beats. Each
click is a short (few-ms) oscillator burst shaped by `raisedCosineCurve` (click-free),
routed through the **master gain bus**. Accent levels map to distinct click voices (pitch +
gain); 'rest' schedules nothing. Timbre defaults to triangle/square (sine is weak on phone
speakers). The scheduler reads the latest meter array at each bar boundary, so edits apply
live without a restart. All constants live in a new **`CONFIG.metronome`** block (bpm
min/max, look-ahead/schedule-ahead seconds, per-accent freq+gain, subdivision options).

**7.4 UI (two-tier).**
- **Face (zero-config):** big BPM number, tap-tempo area (average last ~4 taps), start/stop,
  and a compact beat-pill row reflecting the current meter (4 dots for 4/4). Active beat
  highlights on each downbeat (visual indicator reuses `.str-circle` styling / dial ring
  geometry).
- **Editor (one tap deeper, in a bottom sheet reusing `.sheet`/`.seg`):** preset chips
  (4/4, 3/4, 6/8, 5/8, 7/8, +), −/＋ beat count, tap-a-pill to cycle the 4 accent states,
  a small per-pill subdivision selector, and additive grouping (auto-accent each group's
  first beat).
- Cheap once the scheduler exists (include if low-cost, else defer within this package):
  count-in bar, bar/loop counter, auto-accelerate (bump BPM every N bars) — pure scheduling.
- Last BPM + meter persisted via `store.js`.

### Files
New: `web/js/music/meter.js`, `web/js/audio/metronome.js`, `web/js/ui/metronome-view.js`,
`web/test/test-meter.js`.
Changed: `web/js/config.js` (`CONFIG.metronome`), `web/js/app.js` (`uiMode`, mode switching,
tuner stop/start, connect metronome to the existing master bus from D),
`web/index.html` (mode nav + metronome view), `web/css/styles.css`, `web/sw.js`.

### Tests
- `test-meter`: `expandBar` click times for 4/4, 5/8, 3+2+2, subdivisions, accents; tap-tempo
  averaging (pure helper).
- Manual (timing-critical): steady click under tab-backgrounding; no drift over minutes; no
  pops; simultaneous with a reference tone doesn't clip.

### Risks
- **Timing is the whole feature** — must be scheduler-based; verify no jitter/drift.
- Scope creep in the editor — the default 4/4 face must stay trivially simple; advanced
  behind the "Edit meter" affordance.
- iOS audio unlock — the shared gesture-gated `ensureAudioContext` handles it.

---

## 8. Package F — Accessibility pass

**Goal.** Make the tuner usable and correct for screen-reader, colour-blind, low-vision, and
reduced-motion users — covering all UI added in B–E in one pass, hence last.

### Design
- **Spoken note (`aria-live="polite"`).** A visually-hidden live region in `controls.js`
  announces note/octave/state on change only (e.g. "E, in tune" / "A, 8 cents flat"),
  throttled to note/state changes (not per frame). Sourced from `DisplayState`.
- **Focus-trapped sheet.** The sheet is `role="dialog" aria-modal` but has no focus
  management; add focus-in on open, Tab trap, Escape to close, and return-focus to the
  trigger on close — without breaking the existing scrim-tap / Done close paths.
- **Labels/roles.** `aria-pressed` / `aria-label` on string, instrument, theme, tone, mode,
  and display-toggle controls.
- **Redundant (non-colour) in-tune cue.** Encode in-tune with shape/position (filled ring /
  check mark), not hue alone, so it reads without colour.
- **High-contrast / colour-blind-safe theme.** A third theme in the `[data-theme]` token
  system; `graph.setColors()`/`pushGraphColors()` already repaint the canvas from tokens.
- **Reduced motion.** Ensure every animation (note swap, pulses, strobe, beat flash) honours
  `prefers-reduced-motion`.

### Files
Changed: `web/js/ui/controls.js` (live region, focus trap, labels, redundant cue),
`web/index.html` (live-region node, theme option), `web/css/styles.css` (high-contrast
theme tokens, shape cues, reduced-motion guards), `web/js/app.js` (theme cycling),
`web/js/ui/strobe.js` + `metronome-view.js` (labels/reduced-motion), `web/sw.js`.

### Tests
- Manual with a screen reader (note announcements, sheet focus/Escape/return); axe/Lighthouse
  a11y pass; colour-blind simulation; reduced-motion on.
- Optional: a jsdom smoke test for the live-region text and focus-trap wiring.

### Risks
- Announcement chattiness → throttle strictly to changes.
- Focus trap must not fight existing close paths.

---

## 9. Testing strategy (whole roadmap)

- **Pure logic is unit-tested in Node** via the existing `web/test/run-all.js` harness:
  new suites `test-instruments`, `test-meter`, `test-strobe`, `test-sw-assets`; extensions
  to `test-theory`/`test-stabilizer`.
- **Regression guard for C:** capo=0 must leave targets identical to today (capo is a pure
  MIDI shift; the Stabilizer internals are untouched this round).
- **CI gate (from A):** tests run in `deploy.yml` before publish.
- **Browser-only behaviour** (audio timing, haptics, focus, offline) is verified manually
  per package; a lightweight jsdom/Playwright smoke test is optional, not required.

## 10. Defaults chosen (please confirm or adjust at review)

- **A:** stale-while-revalidate + precached shell (vs cache-first); self-host Google's Latin
  woff2 subset as-is (no subsetting build).
- **B:** instruments added = ukulele (reentrant + low-G), mandolin, violin, banjo, baritone;
  selector = scrollable chips; reentrant stored in pitch order.
- **C:** A4 range 410–470, 0.1 Hz fine, presets 415/432/440/444; capo −5…+12.
  (Temperaments + per-string offsets deferred — see `future-temperament-engine.md`.)
- **D:** haptic default on, chime default off; strobe = horizontal stripe band; dial is
  default view.
- **E:** 4-state accents + subdivisions + additive meters; separate tuner/metronome modes;
  click timbre triangle/square.
- **F:** add one high-contrast/colour-blind theme (three themes total).

## 11. Risks & mitigations (summary)

| Risk | Mitigation |
|------|-----------|
| Hand-maintained precache list drifts | `test-sw-assets` + per-package checklist to update `CORE_ASSETS` + bump `CACHE` |
| Capo pushes lowest string across guitar↔bass engine boundary | Intended (`engineModeFor` derives from pitch); verify the boundary |
| Metronome timing jitter/drift | Look-ahead scheduler on `ctx.currentTime`; manual drift + backgrounding test |
| Editor re-render loses input focus | Incremental row render / preserve name value |
| Feature creep buries the simple case | Advanced controls behind disclosures; default faces stay one-tap simple |
| Reentrant instrument labelling | Documented simplification (pitch-order), revisit if needed |
