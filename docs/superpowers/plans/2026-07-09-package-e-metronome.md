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
- Test harness idiom: each suite file default-exports a `run()` that calls `suite(name, fn)` + `assert`/`assertClose`, and is registered in `web/test/run-all.js`. Full suite is `node web/test/run-all.js` (exit 1 on any failure). Baseline before this package: **294 assertions pass**.
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
