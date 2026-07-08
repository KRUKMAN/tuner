# Web Tuner — Architecture & Module Contracts (v1)

**Status: FROZEN CONTRACT.** Implementation agents build exactly against the signatures below. Any change requires a doc revision, not an ad-hoc code change.

---

## 1. File / Directory Tree

```
web/
├── index.html                  # <script type="module" src="./js/app.js">; all markup shells
├── css/
│   └── styles.css              # single stylesheet, no preprocessor
├── js/
│   ├── app.js                  # BROWSER. Composition root: wiring, rAF loop, state
│   ├── config.js               # PURE.   Frozen defaults (per-mode), deep-frozen objects
│   ├── dsp/
│   │   ├── fft.js              # PURE.   Radix-2 real-signal FFT class
│   │   ├── mpm.js              # PURE.   MPM/NSDF pitch detector (uses fft.js)
│   │   ├── filters.js          # PURE.   DCBlocker, Biquad (Butterworth), PreFilter chain
│   │   ├── one-euro.js         # PURE.   OneEuroFilter class
│   │   └── stabilizer.js       # PURE.   Gates, median, octave check, one-euro, note hysteresis, hold
│   ├── music/
│   │   ├── theory.js           # PURE.   freq<->MIDI<->name<->cents math
│   │   └── tunings.js          # PURE.   Tuning data (MIDI source of truth) + lookup helpers
│   ├── audio/
│   │   ├── capture.js          # BROWSER. getUserMedia -> AnalyserNode wrapper
│   │   └── tone.js             # BROWSER. Reference sine with raised-cosine envelope
│   └── ui/
│       ├── meter.js            # BROWSER. Canvas needle/meter renderer
│       └── controls.js         # BROWSER. Selectors, buttons, A4 input, debug readout
└── test/
    ├── synth.js                # PURE.   Signal synthesis (sine, harmonics, noise)
    ├── assert.js               # PURE.   Tiny assertion + reporter helpers (no npm deps)
    ├── test-theory.js          # Node.   theory.js + tunings.js cases
    ├── test-pitch.js           # Node.   MPM accuracy across guitar+bass range
    ├── test-filters.js         # Node.   Filter sanity (DC removal, passband)
    ├── test-stabilizer.js      # Node.   Gate/median/hysteresis behavior
    └── run-all.js              # Node.   `node web/test/run-all.js` — imports & runs all suites
```

Rules:
- Everything under `js/dsp/`, `js/music/`, `js/config.js`, and `test/` MUST NOT reference `window`, `document`, `AudioContext`, `performance`, or any Web API. Timestamps are always passed **in** as parameters.
- All imports use explicit relative paths **with `.js` extensions** (required for both browser-native ESM and Node): `import { MPMDetector } from './dsp/mpm.js';`
- No npm, no bundler, no top-level await outside `app.js` event handlers.

---

## 2. Module Contracts

### 2.0 Shared typedefs (canonical — declared in `mpm.js` and `stabilizer.js`, referenced everywhere)

```js
/**
 * Per-frame raw output of the pitch detector. Produced by MPMDetector.detect().
 * @typedef {Object} PitchFrame
 * @property {number} frequency  Detected fundamental in Hz, or -1 if no acceptable peak.
 * @property {number} clarity    NSDF peak height in [-1, 1]; -1 when frequency === -1.
 * @property {number} rmsDb      Frame RMS level in dBFS (20*log10(rms)), -Infinity for silence.
 */

/**
 * What the stabilizer emits to the UI every frame. UI renders this and nothing else.
 * @typedef {Object} DisplayState
 * @property {'silent'|'rejected'|'active'|'hold'} status
 *   silent   = gate closed (no signal) -> UI blanks note, needle parks.
 *   rejected = gate open but clarity too low AND hold expired -> blank.
 *   active   = fresh confirmed reading this frame.
 *   hold     = no fresh reading, but within holdMs of last good one -> keep displaying.
 * @property {string|null} noteName   e.g. 'E', 'F#' (sharps only), null when blank.
 * @property {number|null} octave     Scientific pitch octave (A4 = 440 zone), e.g. 2 for E2.
 * @property {number|null} midi       MIDI number of displayed note.
 * @property {number|null} cents      SMOOTHED cents offset vs. reference (nearest note or target string).
 * @property {number|null} frequency  Smoothed frequency in Hz (derived from smoothed cents), for display.
 * @property {boolean} inTune         |cents| <= config.inTuneCents while status is active/hold.
 * @property {number|null} stringIndex Index into current tuning's strings (0 = lowest) when a
 *   tuning is set (auto-selected or manual); null in chromatic mode.
 * @property {number|null} targetMidi  MIDI of the target string when stringIndex !== null.
 * @property {number} rawFrequency    Last raw detector Hz (-1 if none) — debug readout.
 * @property {number} clarity         Last raw clarity — debug readout.
 * @property {number} rmsDb           Last raw RMS dBFS — debug readout.
 */
```

---

### 2.1 `js/config.js` — PURE

Responsibility: single source of truth for every numeric parameter. Exports deep-frozen config objects; modules take a config in their constructor and never read globals.

```js
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

/** @type {TunerConfig} */ export const CONFIG; // Object.freeze'd, values per Section 4 table
```

---

### 2.2 `js/dsp/fft.js` — PURE

Responsibility: fixed-size radix-2 complex FFT with preallocated tables. No allocation in `forward`/`inverse`.

```js
export class FFT {
  /** @param {number} size Power of two. Throws if not. */
  constructor(size) {}
  /** @returns {number} */ get size() {}
  /**
   * Forward FFT of a real signal.
   * @param {Float32Array} realIn  length === size
   * @param {Float32Array} reOut   length === size (caller-allocated)
   * @param {Float32Array} imOut   length === size (caller-allocated)
   */
  forward(realIn, reOut, imOut) {}
  /**
   * Inverse FFT, returning real part only (normalized by 1/size).
   * @param {Float32Array} reIn @param {Float32Array} imIn
   * @param {Float32Array} realOut length === size
   */
  inverse(reIn, imIn, realOut) {}
}

/** @param {number} n @returns {number} smallest power of two >= n */
export function nextPow2(n) {}
```

---

### 2.3 `js/dsp/mpm.js` — PURE

Responsibility: McLeod Pitch Method. Per `detect()` call: (a) autocorrelation r(tau) via FFT — zero-pad window to `2 * nextPow2(windowSize)`, forward FFT, power spectrum (re² + im², im := 0), inverse FFT; (b) m'(tau) energy term computed **incrementally**: `m'(0) = 2*Σx²`, then `m'(tau) = m'(tau-1) − x[tau-1]² − x[N-tau]²`; (c) NSDF `n(tau) = 2*r(tau) / m'(tau)`; (d) key-maxima picking: collect the highest local maximum between each positive-going and negative-going zero crossing of NSDF, take global max height `nMax`, choose the **first** key maximum with height `>= k * nMax`; (e) **parabolic interpolation** through the three NSDF samples around the chosen peak for fractional tau and refined peak height (this refined height is the clarity). Reject if resulting frequency is outside [fMin, fMax] or no key maximum exists → `frequency: -1, clarity: -1`.

```js
/** @typedef {import('./mpm.js').PitchFrame} PitchFrame */ // canonical typedef lives here

export class MPMDetector {
  /**
   * @param {Object} opts
   * @param {number} opts.sampleRate  e.g. 44100 / 48000 (from AudioContext at runtime).
   * @param {number} opts.windowSize  Power of two (4096 or 2048).
   * @param {number} [opts.k=0.93]    Key-maxima relative threshold.
   * @param {number} [opts.fMin=25]   Hz. tauMax = floor(sampleRate/fMin), clamped to windowSize-1.
   * @param {number} [opts.fMax=1200] Hz. tauMin = ceil(sampleRate/fMax).
   * All buffers preallocated here; detect() is allocation-free.
   */
  constructor(opts) {}
  /**
   * @param {Float32Array} buffer  length === windowSize, pre-filtered time-domain samples.
   * @returns {PitchFrame}  Also computes rmsDb from Σx² (free — reuses m'(0)/2).
   */
  detect(buffer) {}
}
```

---

### 2.4 `js/dsp/filters.js` — PURE

Responsibility: sample-domain pre-filtering. Direct Form II Transposed biquads, RBJ cookbook coefficients, Butterworth Q = `Math.SQRT1_2`.

```js
export class DCBlocker {
  /** @param {number} [r=0.995] pole radius; y[n] = x[n] - x[n-1] + r*y[n-1] */
  constructor(r) {}
  /** In-place capable. @param {Float32Array} input @param {Float32Array} output */
  process(input, output) {}
  reset() {}
}

export class Biquad {
  /** Use static factories, not the raw constructor. */
  /** @param {number} sampleRate @param {number} freq @param {number} [q=Math.SQRT1_2] @returns {Biquad} */
  static lowpass(sampleRate, freq, q) {}
  /** @param {number} sampleRate @param {number} freq @param {number} [q=Math.SQRT1_2] @returns {Biquad} */
  static highpass(sampleRate, freq, q) {}
  /** @param {Float32Array} input @param {Float32Array} output In-place capable. */
  process(input, output) {}
  reset() {}
}

/**
 * Builds the per-mode chain. Guitar: DCBlocker -> HPF(hpfHz) -> LPF(lpfHz).
 * Bass (hpfHz === null): DCBlocker -> LPF(lpfHz). NO high-pass in bass mode.
 * @param {'guitar'|'bass'} mode
 * @param {number} sampleRate
 * @param {ModeConfig} modeConfig  from CONFIG.modes[mode]
 * @returns {{ process(input: Float32Array, output: Float32Array): void, reset(): void }}
 */
export function createPreFilter(mode, sampleRate, modeConfig) {}
```

---

### 2.5 `js/dsp/one-euro.js` — PURE

```js
export class OneEuroFilter {
  /**
   * Casiez One-Euro filter. Timestamps are injected — no Date/performance calls.
   * @param {Object} opts
   * @param {number} [opts.fcMin=1.0]  Minimum cutoff Hz.
   * @param {number} [opts.beta=0.007] Speed coefficient.
   * @param {number} [opts.dCutoff=1.0] Derivative cutoff Hz.
   */
  constructor(opts) {}
  /**
   * @param {number} value       Sample to filter (we feed CENTS, never raw Hz).
   * @param {number} timestampMs Monotonic ms from the caller.
   * @returns {number} filtered value. First call returns value unchanged.
   */
  filter(value, timestampMs) {}
  reset() {}
}
```

---

### 2.6 `js/dsp/stabilizer.js` — PURE

Responsibility: turns noisy `PitchFrame`s into a rock-steady `DisplayState`. Owns the entire chain, in this exact order:

1. **RMS gate w/ hysteresis** — opens when `rmsDb >= gateOpenDb` (instant attack); once open, closes only after `rmsDb < gateCloseDb` continuously for `gateReleaseMs`. Closed gate → `status:'silent'` (subject to hold), all filters reset on close.
2. **Clarity gate** — `clarity < clarityThreshold` or `frequency === -1` → frame dropped (not displayed); previous good reading held (`status:'hold'`) until `holdMs` expires, then `'rejected'`.
3. **Octave sanity check** — maintain a short history (the median buffer, in Hz). If history has ≥ 3 entries with median `h`: for `cand of [f, f/2, f/3]`, if `|cents(cand, h)| <= octaveCheckCents` and `|cents(f, h)| > 150`, replace `f` with the first matching `cand`. (Kills harmonic/octave jumps against established context.)
4. **Median filter (window 5)** on the resulting frequency (stored as Hz internally, compared in cents).
5. **Reference selection** — chromatic: nearest note to median Hz (via `theory.noteFromFrequency`). Tuning set: nearest string in cents (`tunings`/`theory.nearestString`), or the manually locked string. Compute raw cents vs. that reference.
6. **One-Euro filter on cents** (never on Hz). If the reference note/string changed this frame, reset the One-Euro filter and reseed (avoids a slew across note boundaries).
7. **Note-name hysteresis** — displayed note switches only after `noteSwitchFrames` consecutive frames agree on the new note AND raw cents vs. the *currently displayed* note exceeds ±`noteDeadBandCents`. Within the dead-band, keep displaying the current note (cents may exceed ±50).
8. **Hold/blank** — any frame with no fresh accepted reading: if `now - lastGoodMs <= holdMs`, re-emit last DisplayState with `status:'hold'`; else blank.

```js
/** @typedef {import('./stabilizer.js').DisplayState} DisplayState */ // canonical typedef lives here

export class Stabilizer {
  /**
   * @param {Object} opts
   * @param {TunerConfig} opts.config
   * @param {number} [opts.a4=440]
   * @param {number[]|null} [opts.tuning=null]  MIDI array (index 0 = lowest string), null = chromatic.
   * @param {number|null} [opts.lockedString=null] Index into tuning; null = auto string select.
   */
  constructor(opts) {}
  /**
   * Feed one detector frame. Call once per rAF tick.
   * @param {PitchFrame} frame
   * @param {number} timestampMs  Monotonic ms (caller supplies performance.now() in browser).
   * @returns {DisplayState}
   */
  update(frame, timestampMs) {}
  /** @param {number} a4 Clamped to [430,450]. Resets smoothing. */
  setA4(a4) {}
  /** @param {number[]|null} midiArray null = chromatic mode. Resets smoothing. */
  setTuning(midiArray) {}
  /** @param {number|null} index null = auto string select. */
  setLockedString(index) {}
  /** Full reset (gate closed, history cleared). */
  reset() {}
}
```

---

### 2.7 `js/music/theory.js` — PURE

```js
/**
 * @typedef {Object} NoteInfo
 * @property {number} midi     Nearest MIDI note number.
 * @property {string} name     'C','C#','D',...,'B' (sharps only).
 * @property {number} octave   Scientific pitch notation (MIDI 69 = A4).
 * @property {number} cents    Signed offset of freq from that note, in cents.
 * @property {number} refFreq  Exact Hz of the nearest note at this a4.
 */

/** @param {number} midi @param {number} [a4=440] @returns {number} Hz = a4 * 2^((midi-69)/12) */
export function frequencyFromMidi(midi, a4) {}

/** @param {number} freq Hz > 0 @param {number} [a4=440] @returns {NoteInfo} */
export function noteFromFrequency(freq, a4) {}

/** @param {number} f @param {number} fRef @returns {number} 1200 * log2(f / fRef) */
export function centsBetween(f, fRef) {}

/** @param {number} midi @returns {{name: string, octave: number}} */
export function midiToName(midi) {}

/**
 * Auto string select: string whose pitch is nearest in |cents| to freq.
 * @param {number} freq Hz
 * @param {number[]} midiArray tuning strings, index 0 = lowest
 * @param {number} [a4=440]
 * @returns {{index: number, midi: number, cents: number}}
 */
export function nearestString(freq, midiArray, a4) {}
```

---

### 2.8 `js/music/tunings.js` — PURE

Responsibility: tuning catalogue (see Section 5 for the exact literal) + helpers.

```js
/**
 * @typedef {Object} Tuning
 * @property {string} id          e.g. 'guitar-standard'
 * @property {string} name        Display name.
 * @property {'guitar'|'bass'} instrument
 * @property {number[]} strings   MIDI numbers, index 0 = LOWEST-pitched string.
 */

/** @type {Object.<string, Tuning>} */ export const TUNINGS; // frozen, keyed by id
/** @param {'guitar'|'bass'} instrument @returns {Tuning[]} in catalogue order */
export function tuningsFor(instrument) {}
/**
 * @param {number[]} midiArray  arbitrary per-string MIDI numbers, low->high
 * @param {string} [name='Custom']
 * @returns {Tuning} with id 'custom', instrument inferred: 'bass' if min(midi) < 36 else 'guitar'
 */
export function makeCustomTuning(midiArray, name) {}
```

---

### 2.9 `js/audio/capture.js` — BROWSER ONLY

Responsibility: mic permission, AudioContext, MediaStreamSource → AnalyserNode. Exposes a pull API: the app calls `readFrame()` each rAF tick.

```js
export class MicCapture {
  /**
   * @param {Object} opts
   * @param {AudioContext} opts.audioContext  Shared context created by app.js.
   * @param {number} opts.windowSize          Sets analyser.fftSize (2048 or 4096).
   * getUserMedia constraints: { audio: { echoCancellation:false, noiseSuppression:false,
   *   autoGainControl:false } } — all three MUST be disabled for tuning accuracy.
   */
  constructor(opts) {}
  /** @returns {Promise<void>} resolves once stream is connected. Rejects with the
   *  original DOMException (NotAllowedError / NotFoundError) — UI maps these to messages. */
  async start() {}
  /** Disconnects nodes and stops all MediaStream tracks. Idempotent. */
  stop() {}
  /**
   * Copies latest windowSize samples via analyser.getFloatTimeDomainData.
   * @param {Float32Array} out length === windowSize
   * @returns {boolean} false if not running.
   */
  readFrame(out) {}
  /** Rebuild analyser with a new size (mode switch). @param {number} windowSize */
  setWindowSize(windowSize) {}
  /** @returns {'idle'|'running'|'stopped'|'error'} */ get state() {}
  /** @returns {number} audioContext.sampleRate */ get sampleRate() {}
}
```

---

### 2.10 `js/audio/tone.js` — BROWSER ONLY

```js
export class ReferenceTone {
  /**
   * @param {Object} opts
   * @param {AudioContext} opts.audioContext Shared context.
   * @param {number} [opts.amplitude=0.25]
   * @param {number} [opts.fadeInMs=10]
   * @param {number} [opts.fadeOutMs=20]
   */
  constructor(opts) {}
  /**
   * Starts (or retargets, if already playing) a sine at freq. Envelope: gain ramps
   * 0 -> amplitude over fadeInMs using setValueCurveAtTime with a raised-cosine
   * (0.5 - 0.5*cos(pi*t/T)) curve; retarget uses oscillator.frequency.setTargetAtTime.
   * @param {number} frequency Hz
   */
  play(frequency) {}
  /** Raised-cosine fade to 0 over fadeOutMs, then oscillator.stop(). Idempotent. */
  stop() {}
  /** @returns {boolean} */ get isPlaying() {}
  /** @returns {number|null} current frequency or null */ get frequency() {}
}
```

---

### 2.11 `js/ui/meter.js` — BROWSER ONLY

```js
export class Meter {
  /**
   * Canvas needle + arc, ticks at every 10 cents, colored in-tune zone.
   * Handles devicePixelRatio scaling and resize internally.
   * @param {HTMLCanvasElement} canvas
   * @param {Object} [opts]
   * @param {number} [opts.rangeCents=50]  Full-scale deflection = +/-50 cents.
   * @param {number} [opts.inTuneCents=5]
   */
  constructor(canvas, opts) {}
  /**
   * Draw one frame. status 'silent'/'rejected' parks the needle at center, dimmed.
   * Needle position uses ds.cents directly — NO additional smoothing in the UI;
   * the stabilizer is the only smoother.
   * @param {DisplayState} ds
   */
  render(ds) {}
}
```

---

### 2.12 `js/ui/controls.js` — BROWSER ONLY

Responsibility: owns all non-meter DOM (note display, cents text, selectors, A4 input, string buttons, mic button, debug line). Pure view: callbacks out, `update()` in. It never talks to audio/dsp modules directly.

```js
/**
 * @typedef {Object} ControlCallbacks
 * @property {() => void} onMicStart
 * @property {(mode: 'guitar'|'bass') => void} onModeChange
 * @property {(tuningId: string) => void} onTuningChange       'custom' opens custom entry UI
 * @property {(midiArray: number[]) => void} onCustomTuning
 * @property {(a4: number) => void} onA4Change
 * @property {(stringIndex: number|null) => void} onStringLock  null = back to auto
 * @property {(stringIndex: number|null) => void} onToneToggle  index to play, null to stop
 */
export class Controls {
  /** @param {Document} doc @param {ControlCallbacks} callbacks */
  constructor(doc, callbacks) {}
  /** Re-render note name, octave, cents text, in-tune light, debug readout.
   *  @param {DisplayState} ds */
  update(ds) {}
  /** Rebuild string buttons + tuning dropdown for the current selection.
   *  @param {Tuning} tuning @param {number} a4 (shows Hz per string) */
  setTuning(tuning, a4) {}
  /** @param {number|null} index Highlight auto/locked string. */
  setActiveString(index) {}
  /** @param {number|null} index Which string's tone button shows "playing". */
  setTonePlaying(index) {}
  /** @param {'idle'|'requesting'|'running'|'denied'|'error'} state @param {string} [message] */
  setMicState(state, message) {}
}
```

---

### 2.13 `js/app.js` — BROWSER ONLY (composition root)

Responsibility: creates the one `AudioContext` (on the mic-start user gesture), instantiates every module, owns the rAF loop, holds app state (mode, tuning, a4, locked string). No DSP logic, no DOM rendering of its own. Not a library — no exports required; runs on load.

rAF tick (the whole pipeline):
```
capture.readFrame(buf) → preFilter.process(buf, buf) → detector.detect(buf)
  → stabilizer.update(frame, performance.now()) → meter.render(ds); controls.update(ds);
  if (ds.stringIndex changed) controls.setActiveString(ds.stringIndex)
```
Mode switch rebuilds: `preFilter`, `MPMDetector`, `capture.setWindowSize()`, and calls `stabilizer.reset()` + `stabilizer.setTuning()`. A4 change: `stabilizer.setA4()`, `controls.setTuning()` refresh, retune playing reference tone.

---

## 3. End-to-End Data Flow

1. User clicks **Start** → `app.js` creates `AudioContext`, `MicCapture.start()` (getUserMedia, echoCancellation/noiseSuppression/autoGainControl all **off**), builds `createPreFilter(mode, sampleRate, CONFIG.modes[mode])` and `new MPMDetector({sampleRate, windowSize, k, fMin, fMax})`.
2. Every `requestAnimationFrame`: `capture.readFrame(buf)` copies the newest `windowSize` samples from the AnalyserNode.
3. `preFilter.process(buf, buf)` — DC block (+ HPF in guitar mode) + LPF, in place.
4. `detector.detect(buf)` → `PitchFrame {frequency, clarity, rmsDb}` (MPM: FFT autocorrelation → incremental m′ → NSDF → key maxima @ k=0.93 → parabolic interpolation).
5. `stabilizer.update(frame, performance.now())` runs: RMS hysteresis gate → clarity gate → octave sanity (f, f/2, f/3 vs. median history) → median-5 → reference pick (nearest note or nearest/locked string via `theory`/`tunings`) → One-Euro on **cents** → note hysteresis (3 frames, ±60c dead-band) → hold 400 ms → `DisplayState`.
6. `meter.render(ds)` draws the needle; `controls.update(ds)` renders note/octave/cents/in-tune/debug; string highlight follows `ds.stringIndex`.
7. Independently of the mic path, string tone buttons → `ReferenceTone.play(frequencyFromMidi(midi, a4))` / `.stop()`.

There is exactly **one** smoothing authority (the Stabilizer). Capture doesn't filter; UI doesn't smooth.

---

## 4. Frozen Defaults

| Parameter | Guitar mode | Bass mode | Lives in |
|---|---|---|---|
| `windowSize` | 2048 | **4096** (app default mode) | ModeConfig |
| `fMin` | 60 Hz | 25 Hz | ModeConfig |
| `fMax` | 1200 Hz | 500 Hz | ModeConfig |
| `hpfHz` (Butterworth HPF, Q=0.7071) | 65 Hz | **null — no HPF** | ModeConfig |
| `lpfHz` (Butterworth LPF, Q=0.7071) | 1300 Hz | 1000 Hz | ModeConfig |
| DC blocker `r` | 0.995 | 0.995 | filters.js default |
| MPM `k` | 0.93 | 0.93 | TunerConfig |
| `clarityThreshold` | 0.90 | 0.90 | TunerConfig |
| `gateOpenDb` / `gateCloseDb` | −45 / −55 dBFS | −45 / −55 | TunerConfig |
| `gateReleaseMs` | 400 | 400 | TunerConfig |
| `medianWindow` | 5 | 5 | TunerConfig |
| One-Euro `fcMin` / `beta` / `dCutoff` | 1.0 / 0.007 / 1.0 | same | TunerConfig |
| `noteSwitchFrames` | 3 | 3 | TunerConfig |
| `noteDeadBandCents` | 60 | 60 | TunerConfig |
| `holdMs` | 400 | 400 | TunerConfig |
| `inTuneCents` | 5 | 5 | TunerConfig |
| `octaveCheckCents` | 40 | 40 | TunerConfig |
| A4 default / min / max | 440 / 430 / 450 | same | TunerConfig |
| Tone amplitude / fadeIn / fadeOut | 0.25 / 10 ms / 20 ms | same | tone.js defaults |
| Meter `rangeCents` | ±50 | ±50 | meter.js default |

Sanity: bass window 4096 @ 44.1 kHz ≈ 92.9 ms ≈ 2.87 periods of B0 (30.87 Hz) — meets the ≥2-period rule. Guitar window 2048 ≈ 46.4 ms ≈ 3.8 periods of E2.

---

## 5. Tunings Data (exact literal for `tunings.js`)

```js
export const TUNINGS = Object.freeze({
  'guitar-standard':  { id: 'guitar-standard',  name: 'Standard E',        instrument: 'guitar', strings: [40, 45, 50, 55, 59, 64] }, // E2 A2 D3 G3 B3 E4
  'guitar-drop-d':    { id: 'guitar-drop-d',    name: 'Drop D',            instrument: 'guitar', strings: [38, 45, 50, 55, 59, 64] }, // D2 A2 D3 G3 B3 E4
  'guitar-dadgad':    { id: 'guitar-dadgad',    name: 'DADGAD',            instrument: 'guitar', strings: [38, 45, 50, 55, 57, 62] }, // D2 A2 D3 G3 A3 D4
  'guitar-eb':        { id: 'guitar-eb',        name: 'Eb Standard',       instrument: 'guitar', strings: [39, 44, 49, 54, 58, 63] }, // Eb2 Ab2 Db3 Gb3 Bb3 Eb4
  'guitar-open-g':    { id: 'guitar-open-g',    name: 'Open G',            instrument: 'guitar', strings: [38, 43, 50, 55, 59, 62] }, // D2 G2 D3 G3 B3 D4
  'bass-4-standard':  { id: 'bass-4-standard',  name: '4-String Standard', instrument: 'bass',   strings: [28, 33, 38, 43] },         // E1 A1 D2 G2
  'bass-5-standard':  { id: 'bass-5-standard',  name: '5-String Standard', instrument: 'bass',   strings: [23, 28, 33, 38, 43] },     // B0 E1 A1 D2 G2
});
```

MIDI is the only stored pitch; Hz is always derived at call time via `frequencyFromMidi(midi, currentA4)`. Custom tunings come from `makeCustomTuning(midiArray, name)`.

---

## 6. Node Test Harness

Run: `node web/test/run-all.js` → prints per-case PASS/FAIL, exits 1 on any failure. No npm packages; `assert.js` provides `assertClose(actual, expected, tol, label)`, `assertCentsClose(fActual, fExpected, centsTol, label)`, `assert(cond, label)`, and a suite runner `suite(name, fn)` / `report()`.

### `test/synth.js` — PURE generators
```js
/** @param {number} freq @param {number} sampleRate @param {number} n
 *  @param {number} [amp=0.5] @param {number} [phase=0] @returns {Float32Array} */
export function sine(freq, sampleRate, n, amp, phase) {}
/** Harmonic-rich tone (guitar-ish). @param {number[]} [harmonicAmps=[1,0.5,0.3,0.2,0.1]]
 *  amplitudes of partials 1..k, normalized to peak amp. @returns {Float32Array} */
export function harmonicTone(freq, sampleRate, n, amp, harmonicAmps) {}
/** Deterministic white noise (mulberry32 PRNG, fixed seed). @returns {Float32Array} */
export function whiteNoise(sampleRate, n, amp, seed) {}
/** @returns {Float32Array} a + b element-wise (same length) */
export function mix(a, b) {}
```

### Cases & assertions

**test-pitch.js** — for each `sampleRate` in `[44100, 48000]` and each `freq` in `[30.87, 41.20, 82.41, 110, 146.83, 196, 246.94, 329.63]`, using bass config (window 4096, fMin 25, fMax 500) for freqs < 100 and both configs for freqs ≥ 100 (guitar config: window 2048, fMin 60, fMax 1200):
1. **Clean sine** (amp 0.5): detected freq within **±2 cents**; clarity **> 0.95**.
2. **Sine + harmonics** (`harmonicTone`, 5 partials): within **±5 cents** of the fundamental (no octave error — assert detected/expected ratio is within 5 cents of 1.0, explicitly not near 2.0 or 0.5); clarity **> 0.9**.
3. **Sine + noise** (SNR ≈ 20 dB: signal amp 0.5, noise amp 0.05): within **±5 cents**; clarity **> 0.85**.
4. **Pure white noise** (amp 0.3): `clarity < 0.6` **or** `frequency === -1`.
5. Buffers are passed through `createPreFilter(mode, sampleRate, modeConfig)` first — tests the real pipeline, and proves the bass path (no HPF) preserves B0/E1 while the guitar HPF doesn't break E2.

**test-theory.js** — `frequencyFromMidi(69,440)===440`; `frequencyFromMidi(28,440)` within 0.01 Hz of 41.203; `noteFromFrequency(445,440)` → A4 at ≈ +19.56 cents (±0.01); A4=432 shifts all refFreqs correctly; `nearestString(83, [40,45,50,55,59,64])` → index 0; `midiToName(23)` → `{name:'B', octave:0}`.

**test-filters.js** — DCBlocker removes a 0.3 constant offset (mean of output < 1e-3 after settling); guitar HPF attenuates a 30 Hz sine by > 12 dB while passing 110 Hz within 1 dB; bass PreFilter passes 30.87 Hz within 1 dB.

**test-stabilizer.js** — drives `Stabilizer.update()` with hand-built `PitchFrame`s and synthetic timestamps (16.67 ms steps):
1. Frames with `rmsDb:-70` → `status:'silent'`.
2. Loud but `clarity:0.5` frames → never `'active'`; after 400 ms of them following a good reading → blank.
3. Steady stream at 110 Hz, clarity 0.97, rmsDb −20 → `'active'`, note A2, |cents| < 1 after 10 frames.
4. Inject a single 220 Hz outlier mid-stream → displayed cents never jumps by more than 10 (median + octave check absorb it).
5. Sweep 110 → 116.54 Hz (A2→A#2): note switches only after ≥3 consistent frames past the dead-band; no flicker at the boundary.
6. Stop feeding good frames: `'hold'` persists ≤ 400 ms, then blanks.

---

## 7. React Native Port Note

**Move unchanged (100% pure JS, zero browser deps):** `config.js`, `dsp/fft.js`, `dsp/mpm.js`, `dsp/filters.js`, `dsp/one-euro.js`, `dsp/stabilizer.js`, `music/theory.js`, `music/tunings.js`, and the whole `test/` harness (already runs in Node, which is the RN-adjacent runtime).

**Swap:** `audio/capture.js` → a native mic module (e.g. react-native-audio-api or a small native module) that delivers `Float32Array` frames — it only has to satisfy the same `readFrame(out)/sampleRate` contract; `audio/tone.js` → native oscillator or a short pre-rendered sine sample with envelope; `ui/meter.js` + `ui/controls.js` → React Native components (Skia/SVG needle) consuming the identical `DisplayState`; `app.js` → an RN hook/controller doing the same wiring. Because the DisplayState/PitchFrame contracts are the seam, the port touches only the four browser modules.
