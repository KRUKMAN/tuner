# Tuner Engine Research — Guitar + Bass, React Native

_Research compiled July 2026. Goal: a rock-solid, low-jitter monophonic tuner (guitar + bass, down to 5-string low B ≈ 30.9 Hz), with custom tunings and a reference sine tone. React Native is the primary target (friend's existing RN app); code ideally shareable with web. Polyphonic is a future stretch._

---

## TL;DR recommendation

**Engine:** Time-domain autocorrelation-family detector — **McLeod Pitch Method (MPM / NSDF)** as the core, with **mandatory parabolic interpolation** for sub-cent precision. (YIN/`yinfft` is co-equal; MPM's built-in "clarity" metric makes display-gating cleaner.) FFT peak-picking, HPS, and cepstrum all fail at bass resolution; neural methods (CREPE/SPICE) are heavier, resample to 16 kHz, and **structurally bottom out at 32.7 Hz so they cannot tune a 5-string low B at all**.

**Architecture (recommended default):** Build the DSP in **JavaScript/TypeScript** and run it inside **`react-native-audio-api`** (Software Mansion, MIT) — it implements the Web Audio API on native, gives you `AudioRecorder → AnalyserNode → getFloatTimeDomainData`, and runs your detection in a **JS Audio Worklet off the JS/UI thread**. The exact same detection module runs on web. Use **`pitchy`** (0BSD license, McLeod method) as the detector, or hand-port MPM.

**Drop to native only if profiling demands it:** copy the **Tuneo** blueprint (open-source, app-store-shipping RN tuner) — native mic → **C++ MPM/YIN via a Nitro module** (zero-copy `ArrayBuffer`) → Skia/Reanimated needle. Permissive C++/Rust cores: **sevagh/pitch-detection (C++, MIT)**, **cycfi/Q (C++, MIT)**, **alesgenova/pitch-detection (Rust, MIT, wasm-ready)**.

**Stability (this is what makes it feel pro):** RMS noise gate (hysteretic) → Butterworth band-pass pre-filter → confidence/clarity gate → **median filter (5 frames) → one-euro filter** on the needle → note-name hysteresis. Values in the cheat-sheet below.

**Polyphonic (future):** Do **not** attempt open transcription. Replicate PolyTune: a **Goertzel / tuned-filterbank against the known expected string frequencies + harmonicity gate**. Trivial on a phone, cent-accurate, matches how the hardware pedals actually work.

**License landmines:** `aubio` (GPL), `pitchfinder` (GPL), `TarsosDSP` (GPL), `Essentia` (AGPL) are all copyleft — avoid for a closed commercial app. Clean picks: **pitchy (0BSD)**, **react-native-audio-api (MIT)**, **sevagh / cycfi Q / alesgenova (MIT)**, **Spotify Basic Pitch (Apache-2.0)**.

---

## 1. The problem, framed by the instrument

Target fundamentals (A4 = 440, 12-TET):

| Note | String | Hz |
|---|---|---|
| B0 | 5-string bass low B | **30.87** |
| E1 | 4-string bass low E | **41.20** |
| A1 / D2 / G2 | bass | 55.00 / 73.42 / 98.00 |
| E2 | guitar low E | **82.41** |
| A2 / D3 / G3 / B3 | guitar | 110.00 / 146.83 / 196.00 / 246.94 |
| E4 | guitar high E | **329.63** |

Two facts drive every design decision:

1. **Musical intervals are geometric.** A semitone is a fixed ratio (+5.95%), so in absolute Hz it shrinks at low pitch. A whole semitone at 41 Hz is only ~2.4 Hz, and **1 cent at B0 (30.9 Hz) is just 0.018 Hz**. A serious tuner targets ±1 cent — your frequency estimator must resolve hundredths of a Hz at the bottom.
2. **On a plucked low string the fundamental is often weaker than its 2nd/3rd harmonic.** This is the root cause of the **octave error**, the dominant tuner failure mode.

---

## 2. Algorithm comparison

| Method | Bass ~31 Hz | Octave-error resistance | Latency/CPU (mobile) | Sub-cent precision | Verdict |
|---|---|---|---|---|---|
| **MPM / NSDF** | Good w/ 4096 win | Good (k≈0.9 relative thr) + **free clarity metric** | O(N log N), light | Yes (parabolic) | **Top pick** |
| **YIN (`yinfft`)** | Good w/ 4096 win | Good (CMNDF + threshold) | O(N log N), light | Yes (parabolic) | **Top pick (co-equal)** |
| pYIN | Good | Best (HMM/Viterbi) | Heavier, needs lookahead | Yes | Optional "stability" mode, not core |
| Plain autocorrelation | OK window, poor picking | Poor (latches onto loudest overtone) | Light | With interp | No — superseded by YIN/MPM |
| FFT peak-pick | **Fails** — bin ≫ semitone at bass | Poor | Light | Only w/ heavy interp | No |
| HPS | Weak < 50 Hz | Upward only, errs an octave high | Light | Bin-bound | No (harmonic aid at best) |
| Cepstrum | Poor (resolution worsens low) | Moderate | ~2× FFT | Needs interp | No for bass |
| CREPE (neural) | **Floor 32.7 Hz** | Excellent | Too slow (full 88 MB); tiny only | Yes | Overkill; can't do < 32.7 Hz |
| SPICE (neural) | **Floor 32.7 Hz** | Very good | Mobile TFLite (~8.7 MB) | ~ | Optional noise fallback; can't do < 32.7 Hz |

**Why FFT peak-picking is disqualified for bass:** bin width Δf = Fs/N. At 44.1 kHz, N=4096 → ~10.77 Hz/bin, but a whole semitone at 41 Hz is 2.4 Hz — **smaller than one bin**. Reaching 1 Hz bins needs a ~1-second window (unusable latency). FFT/phase-vocoder can work but is unnecessary if you go time-domain.

**Universal rule — parabolic interpolation is mandatory.** Neither raw FFT (coarse at low f) nor raw integer-lag autocorrelation (~13 cents/sample at E4) hits 1 cent alone. Quadratic interpolation of the detected NSDF peak / CMNDF dip is required across the whole range (Julius Smith's QIFFT: `p = ½(α−γ)/(α−2β+γ)`).

**MPM vs YIN:** both autocorrelation-family, both strong. YIN is marginally more octave-stable on clean tones; MPM's NSDF is amplitude-independent, bounded to [−1, +1], and the chosen peak height is a **free confidence/"clarity" value (1.0 = perfectly periodic)** — ideal for gating the display. No authoritative published head-to-head exists; treat them as co-equal. **Slight lean to MPM** for a guitar+bass product because of the clarity metric.

---

## 3. Libraries (with licenses)

| Library | Language / Platform | Algorithm(s) | License | Fit | Maintenance |
|---|---|---|---|---|---|
| **pitchy** | JS/TS (browser, Node, RN) | McLeod (MPM) | **0BSD** ✅ (best) | Pure JS — runs in RN + web unchanged | Active, v4.1.0 (2024) |
| **react-native-audio-api** | RN native (Web Audio impl) | — (audio graph/capture) | **MIT** ✅ | Mic + AnalyserNode + worklets; mirrors web | Very active, v0.13.1 (Jul 2026), Software Mansion |
| **sevagh/pitch-detection** | C++ | MPM, YIN, YIN-FFT, pYIN | **MIT** ✅ | Native core (needs your wasm/JNI wrapper) | Active, 2023 |
| **cycfi/Q** | C++ header-only | pitch + onset detection | **MIT** ✅ | Fast native core; Emscripten→wasm w/ effort | Active |
| **alesgenova/pitch-detection** | Rust (+ wasm) | MPM, autocorrelation | **MIT** ✅ | Native + wasm demo shipped; one core → web + RN | Stable, v0.3.0 (2022) |
| **dywapitchtrack** | C single-file | Dynamic Wavelet | **MIT** ✅ | Tiny, embeddable, wasm-able; weak at very low f | Old but stable |
| **react-native-pitchy** | RN native module | (real-time pitch) | verify before shipping | Purpose-built RN — evaluate directly | — |
| **Spotify Basic Pitch** | TF.js / Python | polyphonic note + multipitch | **Apache-2.0** ✅ | Offline audio→MIDI; runs in-browser | Active |
| ~~aubio~~ | C | YINfft, YIN, etc. | **GPL-3.0** ⚠️ | High quality but copyleft | No release since 2019 |
| ~~pitchfinder~~ | JS | YIN, MPM, AMDF, wavelet | **GPL-3.0** ⚠️ | Nice API but copyleft | Modest |
| ~~TarsosDSP~~ | Java/Android | YIN, FastYin, MPM, AMDF | **GPL-3.0** ⚠️ | Reference-grade but copyleft | Active, v2.5 (2023) |
| ~~Essentia~~ | C++ / wasm | YIN, Melodia, CREPE | **AGPL-3.0** ⚠️ | Commercial license available (paid) | Active (UPF/MTG) |

> **Beethoven** is a common trap — it's a Swift/iOS library, **not** a JS/WebAudio one. Not relevant to the RN/web core.

**Shortlist:**
- **Pure JS/TS:** `pitchy` (0BSD) — top pick, TypeScript-native, ESM, `Float32Array`, offline, runs identically in RN and web.
- **Native C++ core:** `sevagh/pitch-detection` or `cycfi/Q` (both MIT).
- **Native Rust core (one core for web + RN via wasm):** `alesgenova/pitch-detection` (MIT).

---

## 4. React Native architecture

The tuner loop: **capture mic PCM → window (2048–4096 samples) → detect pitch → Hz→note/cents → animate needle at 30–60 fps.** Two things dominate: getting PCM somewhere you can compute on with low latency, and doing the DSP without janking the UI thread.

### Option A — recommended default: `react-native-audio-api` + JS detector
- Implements the **Web Audio API on native** (AVAudioEngine iOS / Oboe Android), degrades to real Web Audio on web.
- `AudioRecorder` delivers live PCM via `onAudioReady(buffer)`; wire it to an **`AnalyserNode`** and call `getFloatTimeDomainData()` — exactly what a browser autocorrelation tuner uses, so **tuner code ports 1:1 between web and RN**.
- **JS Audio Worklets** run your detection on the audio thread, keeping the JS/UI thread free for Skia/Reanimated.
- Configurable `bufferLength` / `sampleRate`. MIT, very actively maintained (Software Mansion).
- **Expo:** not in Expo Go; works via **dev build / prebuild** with the official config plugin (handles mic permission, iOS background audio, Android foreground service).

### Option B — lowest latency: native C++ via Nitro (the "Tuneo" pattern)
- **Tuneo** (https://github.com/DonBraulio/tuneo) is an open-source RN tuner shipping in both app stores: native mic modules stream PCM → a **shared C++ TurboModule runs YIN** → **Skia + Reanimated** needle, on RN New Architecture (bridgeless). Copy this shape.
- Build the native bridge with **Nitro Modules** (mrousavy) rather than hand-rolled TurboModules — statically compiled JSI bindings, **zero-copy PCM via `ArrayBuffer`** (`react-native-nitro-audio-record` is built for exactly this). Requires New Architecture; dev build, not Expo Go.

### What to avoid
- **DSP on the RN JS/UI thread** (competes with React reconciliation — jank).
- **`react-native-live-audio-stream`** — base64-encodes PCM to JS (pure overhead + GC churn); effectively stale since 2021. Prefer maintained forks only if you must.
- **WASM in RN** (`Polygen`, `react-native-webassembly`) — pre-production, and offers no advantage over compiling the same C directly as a native module *unless* sharing a wasm DSP core with web is a hard requirement.

### expo-audio (SDK 57+)
Now genuinely capable: `useAudioStream` / `AudioStream` gives real-time PCM (`float32` ±1.0 or `int16`, default 48 kHz mono), ~50–100 ms callbacks. First-party, MIT, needs a dev build. Viable if you want to stay entirely in Expo's stack and do DSP in a JS worklet or small Nitro module — you no longer need a third-party mic lib.

### Web side (shared code)
`getUserMedia → AudioContext → AnalyserNode`, `getFloatTimeDomainData()` each rAF, run detection in an **AudioWorklet** (dedicated audio thread, not the deprecated `ScriptProcessorNode`). Because `react-native-audio-api` mirrors this API exactly, **your detection function can be the same module on web and RN.**

### Expo vs bare — what runs where
Nothing real-time runs in **Expo Go**. Every mic-streaming/native path needs a **dev build (prebuild)**. So the real axis is "managed dev-build vs bare," and all these options work under a managed Expo dev build.

---

## 5. Stability & noise handling (the "no jumping needle" layer)

Perceived stability is almost entirely a **post-detection** problem. Signal chain, in order:

```
mic → [1] RMS noise gate → [2] band-pass pre-filter → detector (MPM/YIN)
    → [3] confidence/clarity gate → [4] median filter → [5] one-euro filter
    → freq→note+cents → [6] note hysteresis / hold → display
```

1. **Noise gate (silence detection).** Gate on **RMS in dBFS** with **two thresholds** (open higher than close) to stop chatter. Open ≈ −45 dBFS, close ≈ −55 dBFS, or adaptive: noise-floor + ~12 dB. Attack fast (~2 ms), release slow (~150 ms) so a decaying note that momentarily dips doesn't drop out. Measure RMS on the *band-pass-filtered* signal so hiss/hum doesn't hold the gate open.
2. **Band-pass pre-filter.** Removes upper harmonics that cause octave-*up* errors and mains hum/rumble behind octave-*down* errors. **Butterworth biquad (Q=0.707)**, cascade HPF + LPF. Guitar: HPF ~60–70 Hz (safe, lowest fundamental 82 Hz). **Bass: do NOT HPF at 60 Hz — it kills E1/B0.** DC-block only for bass, lean on the LPF + level gate. LPF ~1.0–1.3 kHz keeps fundamentals + first 2–3 harmonics.
3. **Confidence/clarity gate.** MPM: require NSDF clarity ≥ ~0.9 (relax to 0.8 for quiet decays). YIN: accept only if a CMNDF dip clears threshold 0.10–0.15. **A failed frame is dropped, not displayed — hold the last good reading.** This alone removes most of the "dancing on noise."
4. **Median filter (window 5).** Non-linear, kills single-frame octave-jump outliers completely (an average would drag toward them). Do this first.
5. **One-euro filter (Casiez, CHI'12).** Adaptive low-pass: heavy smoothing when the note is steady (dead-still needle), light smoothing when the reading moves fast (turning the peg → low lag). Best-in-class for a tuner needle. Start `fcmin=1.0 Hz, β=0.007, dcutoff=1.0 Hz`. (A plain EMA with α=0.1–0.25 is the simpler alternative.) **Smooth cents, not raw Hz** — the scale is logarithmic.
6. **Note hysteresis / hold.** Only change the *displayed note* after a different note is detected confidently for **3–5 consecutive frames**, and add a **±60-cent boundary dead-band** (10-cent overlap past the naïve ±50 midpoint) so it doesn't flicker between neighbors. On a dropout, hold the last note ~300–500 ms then blank.

**Octave-error defenses, layered:** (a) the pre-filter LPF; (b) the detector's own picking (MPM's `k·n_max` relative threshold picks the first "good enough" peak → true fundamental; YIN's "first dip below threshold"); (c) the median filter; (d) an explicit sanity check — test f/2 and f/3 for stronger/consistent periodicity vs recent history before committing.

**How the pros do it:** strobe tuners (Peterson, ±0.1 cent) integrate *phase over many cycles* rather than estimating one period — the display responds to accumulated phase, which is inherently smooth. Software lesson: drive the needle from accumulated phase error and/or heavy adaptive smoothing (one-euro) — that's what feels "locked."

---

## 6. Note/cents math & custom tunings

```
n       = 69 + 12 * log2(f / A4)      // continuous MIDI number
nRound  = round(n)
cents   = 100 * (n - nRound)          // −50..+50; equals 1200*log2(f / f_nearest)
name    = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"][nRound % 12]
octave  = floor(nRound / 12) - 1      // MIDI 69 → A4
```

For a **targeted-string** tuner (you know which string), skip nearest-note lookup and compute directly against the target: `cents = 1200*log2(f / f_target)` — cleaner and immune to boundary ambiguity.

**Tuning data model** — store **MIDI as source of truth**, derive Hz at runtime from the current A4 so custom references (e.g. 432 Hz) and cents math stay consistent; transpositions (drop/half-step) become integer offsets:

```jsonc
// f = A4 * 2^((midi - 69) / 12)
{
  "instrument": "guitar",
  "tunings": [
    { "id": "standard", "name": "Standard E",
      "strings": [ {"label":"E2","midi":40}, {"label":"A2","midi":45},
                   {"label":"D3","midi":50}, {"label":"G3","midi":55},
                   {"label":"B3","midi":59}, {"label":"E4","midi":64} ] },
    { "id": "drop_d",  "name": "Drop D",   "strings": ["D2/38","A2/45","D3/50","G3/55","B3/59","E4/64"] },
    { "id": "dadgad",  "name": "DADGAD",   "strings": ["D2","A2","D3","G3","A3","D4"] },
    { "id": "eb_std",  "name": "Eb Standard" },
    { "id": "open_g",  "name": "Open G",   "strings": ["D2","G2","D3","G3","B3","D4"] }
  ]
}
```

- Support a fully **custom** tuning = arbitrary per-string MIDI array, per-string enable, and an optional per-string cents offset (for sweetened/well-tempered tunings, à la Peterson).
- **Auto string-select:** pick the target string whose frequency is closest in cents to the detected pitch — the user doesn't have to tap strings.
- **Bass reference frequencies** (verified): 4-string E1 A1 D2 G2 = **41.20, 55.00, 73.42, 98.00 Hz**; 5-string adds B0 = **30.87 Hz**. (Watch out: open bass G is **G2 = 98.00 Hz**, not 49 Hz — a bad figure that shows up in some sources.)

---

## 7. Reference tone (tune by ear)

Generate a clean **sine** at the target with a **click-free amplitude envelope** — starting/stopping at nonzero amplitude pops. Use a raised-cosine fade: **fade-in ~10 ms, fade-out ~20 ms**, `gain = 0.5*(1 - cos(π*t/T))`. Keep amplitude ~0.25 for headroom. If looping continuously, keep the buffer **phase-continuous** (integer cycles per buffer, or carry phase across buffers) or you get a click every loop.

```
for i in 0..N:
    t      = i / sampleRate
    env    = fadeEnvelope(i, N, fadeIn, fadeOut)   // cosine ramps, 0..1
    sample = amplitude * env * sin(2π * freq * t)
```

**RN options, in order of preference for a cross-platform ship:**
1. **Pre-render short, fade-enveloped, phase-aligned PCM buffers per note and loop them** — simplest cross-platform path; cache them.
2. **Small native oscillator module** (AVAudioEngine `AVAudioSourceNode` on iOS, Oboe/AudioTrack on Android) if you want arbitrary/continuous frequency and pitch-pipe sustain. `react-native-audio-api` can also just drive an `OscillatorNode` + `GainNode` envelope directly.
3. `react-native-tone` — purpose-built but **iOS-only**.
4. Tone.js `Oscillator` + ADSR is the reference *design* to copy, but needs a Web Audio shim in RN.

---

## 8. Polyphonic tuning (future stretch) — honest assessment

**A PolyTune-style "strum all strings, see them all" tuner is very feasible on mobile — but not because polyphonic transcription got solved.** That product category never did open transcription; it solved a much easier, constrained problem: **detecting a small set of _known, expected_ frequencies and measuring each one's deviation from its target.**

- **Open real-time polyphonic transcription on mobile** is newly *possible* in 2024–2026 (Mobile-AMT reports real-time factors 0.25 MacBook / 0.35 iPad / 0.6 Pixel 6 for piano; Spotify **Basic Pitch** is <17K params, <20 MB, Apache-2.0, runs in-browser via TF.js). **But it's the wrong tool:** transcription models snap to the nearest MIDI semitone and add onset latency — they throw away exactly the **cent-level deviation** a tuner needs.
- **How PolyTune actually works (patent US8309834B2):** FFT the strum → for each *expected* string, search for a peak within a tolerance window around its stored target (e.g. "peak near 82.41 Hz within ±2%") → confirm via a **harmonicity check** (a few integer harmonics present) → report each string's cents deviation. It already knows the tuning, so it's *detection against known targets*, not "what notes are these?" That's why a 2010 pedal DSP did it in real time with ±1 cent.

**Recommended path for a polyphonic-ish feature:**
1. From the selected tuning you have N known target fundamentals (+ their first few harmonics — low-B/E fundamentals are weak, so harmonics carry more reliable energy).
2. **Filterbank of narrowband detectors** at each target + harmonics — a **Goertzel bank** (O(N) per target frequency, the DTMF-detection tool) is cheapest when you only need a few dozen bins. Because standard-tuning open strings are fourths/thirds apart (not octaves), their harmonics mostly don't collide, so per-string attribution is reliable.
3. **Cent-accurate estimation per string:** each isolated band is an almost-monophonic sub-problem — apply the same parabolic-interpolation / instantaneous-frequency refinement as the mono engine.
4. **Harmonicity gate** to reject cross-talk and room noise.

This is a handful of IIR recurrences + small DFT evaluations per frame — orders of magnitude cheaper than any neural model, deterministic, and it produces the cent-level readout transcription can't. It's what the hardware does, and a phone CPU dwarfs a 2010 pedal.

---

## 9. Defaults cheat-sheet

| Parameter | Recommended start |
|---|---|
| Sample rate | Native 44.1 or 48 kHz (read `AudioContext.sampleRate`; don't assume) |
| Window / buffer | **4096 samples (~93 ms) bass-capable default**; 2048 (~46 ms) guitar-only mode |
| Hop / overlap | 256–512 samples (75%+ overlap) — new estimate every few ms |
| Detector | MPM, `k = 0.93` (or YIN `yinfft`, threshold 0.10–0.15) |
| Peak refinement | Parabolic interpolation — **mandatory** for sub-cent |
| Gate open / close (RMS) | −45 / −55 dBFS (hysteretic), or noise-floor + 12 dB |
| Gate attack / release | 2 ms / 150 ms |
| Pre-filter (guitar) | Butterworth HPF ~60–70 Hz + LPF ~1.0–1.3 kHz (Q=0.707) |
| Pre-filter (bass) | DC-block only (NO 60 Hz HPF) + LPF ~1 kHz |
| Confidence gate | MPM clarity ≥ 0.9 / YIN dip below threshold |
| Median window | 5 frames |
| Smoother | One-euro `fcmin=1.0, β=0.007, dcutoff=1.0` (or EMA α=0.1–0.25); smooth **cents**, not Hz |
| Note hysteresis | switch after 3–5 consistent frames; ±60-cent boundary dead-band |
| Note hold on dropout | 300–500 ms before blanking |
| Reference tone | sine, amp ~0.25, cosine fade-in 10 ms / fade-out 20 ms, phase-continuous loop |
| A4 reference | 440 Hz (configurable 430–450) |
| Optional bass optimization | LP ~1 kHz then downsample to ~8 kHz (cuts autocorrelation cost 4–16×; makes interpolation non-negotiable) |

---

## 10. Suggested build path

1. **Prototype on web first** (fastest iteration): `getUserMedia → AnalyserNode → getFloatTimeDomainData`, `pitchy` (MPM) in an AudioWorklet, then layer the full stabilization chain. Validate low-jitter behavior and bass accuracy here.
2. **Port to RN via `react-native-audio-api`** — the same detection + stabilization module drops in behind `AudioRecorder → AnalyserNode`. Skia + Reanimated for the needle. Ship as an Expo dev-build page/component in your friend's app.
3. **Add custom tunings + reference tone.**
4. **Profile.** If the JS worklet can't hold real-time on low-end Androids, move only the detector into a **Nitro C++ module** (sevagh MPM), keeping everything else in JS. Tuneo is the reference implementation.
5. **Later:** polyphonic "strum-all" mode via a Goertzel filterbank against the active tuning's targets.

---

## Key sources

- **MPM:** McLeod & Wyvill, "A Smarter Way to Find Pitch" (cs.otago.ac.nz/graphics/Geoff/tartini/papers) · sevagh/pitch-detection (github.com/sevagh/pitch-detection)
- **YIN/pYIN:** de Cheveigné & Kawahara JASA 2002 (audition.ens.fr/adc/pdf/2002_JASA_YIN.pdf) · Mauch & Dixon pYIN ICASSP 2014 · librosa.yin / librosa.pyin · aubiopitch manpage
- **Interpolation:** CCRMA "Quadratic Interpolation of Spectral Peaks" (ccrma.stanford.edu/~jos/sasp)
- **Neural:** CREPE (arxiv 1802.06182) · SPICE (arxiv 1910.11664) · SwiftF0 latency benchmark (arxiv 2508.18440)
- **Libraries:** pitchy (github.com/ianprime0509/pitchy) · react-native-audio-api (docs.swmansion.com/react-native-audio-api) · Nitro (github.com/mrousavy/nitro) · cycfi/Q · alesgenova/pitch-detection · Essentia licensing (essentia.upf.edu/licensing_information.html)
- **RN reference tuner:** Tuneo (github.com/DonBraulio/tuneo)
- **Stabilization:** One-euro filter (gery.casiez.net/1euro, CHI'12) · BOSS noise-gate guide · Cornell ECE4760 digital tuner · Peterson strobe accuracy
- **Polyphonic:** PolyTune patent US8309834B2 (patents.google.com) · Spotify Basic Pitch (engineering.atspotify.com/2022/6/meet-basic-pitch, Apache-2.0) · Mobile-AMT EUSIPCO 2024 · Goertzel (embedded.com single-tone-detection)
- **Tunings/cents:** Guitar tunings (Wikipedia) · RecordingBlogs "cent"
