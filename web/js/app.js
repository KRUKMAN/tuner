// BROWSER. Composition root: creates the AudioContext on the start gesture,
// instantiates every module, owns the rAF loop and app state.

import { CONFIG } from './config.js';
import * as store from './store.js';
import { MPMDetector } from './dsp/mpm.js';
import { createPreFilter } from './dsp/filters.js';
import { Stabilizer } from './dsp/stabilizer.js';
import { frequencyFromMidi } from './music/theory.js';
import { TUNINGS, makeCustomTuning, validateTuningStrings } from './music/tunings.js';
import { defaultTuningIdFor } from './music/instruments.js';
import { MicCapture } from './audio/capture.js';
import { ReferenceTone, raisedCosineCurve } from './audio/tone.js';
import { TrailBuffer } from './dsp/trail.js';
import { Dial } from './ui/dial.js';
import { Strobe } from './ui/strobe.js';
import { Graph } from './ui/graph.js';
import { Controls } from './ui/controls.js';
import { Metronome } from './audio/metronome.js';
import { MetronomeView } from './ui/metronome-view.js';
import { makeAdditiveBar, tapTempoBpm } from './music/meter.js';

const LS_CUSTOM = 'tuner-custom-tunings';
const LS_LAST = 'tuner-last-tuning';

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
  uiMode: 'tuner',           // 'tuner' | 'metronome' — mutually exclusive
  wasRunning: false,         // was the mic running when we left the tuner?
  metBpm: CONFIG.metronome.bpmDefault,
  metBar: makeAdditiveBar([4]),
};

/** @type {AudioContext} */ let audioCtx = null;
/** @type {MicCapture} */   let capture = null;
/** @type {MPMDetector} */  let detector = null;
let preFilter = null;
/** @type {Stabilizer} */   let stabilizer = null;
/** @type {ReferenceTone} */ let tone = null;
/** @type {GainNode} */     let masterGain = null;
let rawBuf = null;
let procBuf = null;
let analysisN = 0;
let rafId = 0;
let lastStringIndex = null;
/** @type {Metronome} */ let metronome = null;
let metRafId = 0;
let tapTimes = [];

const root = document.documentElement;

// ?debug live signal readout — reveals WHY a note is or isn't detected on-device
// (the numbers that decide the gate/clarity/harmonicity, which we otherwise can't see
// on a phone). Off unless the URL contains ?debug.
const DEBUG = /[?&]debug\b/.test(location.search);
const dbgEl = document.getElementById('dbg');
if (DEBUG && dbgEl) dbgEl.hidden = false;
function renderDebug(frame, ds) {
  if (!DEBUG || !dbgEl) return;
  const c = CONFIG;
  const openDb = c.adaptiveGate
    ? Math.min(c.gateOpenDbMax, Math.max(c.gateOpenDbMin, ds.noiseFloorDb + c.gateOpenAboveFloorDb))
    : c.gateOpenDb;
  const n = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '–');
  const gate = ds.rmsDb >= openDb ? 'OPEN' : 'shut';
  const harm = frame.harmonicity != null ? frame.harmonicity : 1;
  dbgEl.textContent =
    `status ${ds.status}   ${ds.noteName != null ? ds.noteName + (ds.octave ?? '') + ' ' + n(ds.cents, 1) + 'c' : '—'}\n` +
    `level ${n(ds.rmsDb, 0)}dBFS   floor ${n(ds.noiseFloorDb, 0)}   gate@${n(openDb, 0)} ${gate}\n` +
    `clarity ${n(ds.clarity, 2)} (need ${c.clarityThreshold})   harm ${n(harm, 2)} (need ${c.harmonicityMin})\n` +
    `conf ${n(ds.confidence, 2)}   rawHz ${n(ds.rawFrequency, 1)}   sr ${audioCtx ? audioCtx.sampleRate : '–'}`;
}

/* ---------- tuning resolution + persistence ---------- */
function resolveTuning(id) {
  return TUNINGS[id] || state.customTunings.find((t) => t.id === id) || null;
}
function loadCustoms() {
  try {
    const raw = localStorage.getItem(LS_CUSTOM);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) state.customTunings = arr.filter((t) => t && Array.isArray(t.strings));
    }
  } catch { /* ignore */ }
}
function saveCustoms() {
  try { localStorage.setItem(LS_CUSTOM, JSON.stringify(state.customTunings)); } catch { /* ignore */ }
}
function rememberTuning(id) {
  try { localStorage.setItem(LS_LAST, id); } catch { /* ignore */ }
}

/** DSP profile from the tuning's lowest string: low tunings use the bass engine. */
function engineModeFor(tuning, a4) {
  const lowestHz = frequencyFromMidi(Math.min(...tuning.strings), a4);
  return lowestHz < 70 ? 'bass' : 'guitar';
}

/* ---------- theme ---------- */
let accentColor = '#4cc2f2';
let accentInColor = '#34d399';

function cssVar(name) { return getComputedStyle(root).getPropertyValue(name).trim(); }
function cacheColors() {
  accentColor = cssVar('--accent') || accentColor;
  accentInColor = cssVar('--accent-in') || accentInColor;
}
function pushGraphColors() {
  const colors = { accent: accentColor, accentIn: accentInColor, grid: cssVar('--muted-2') || '#556' };
  graph.setColors(colors);
  strobe.setColors(colors);
}
// Status-bar / theme-color per theme (matches --bg-bot in css/styles.css).
const THEME_COLORS = { dark: '#0b0d10', light: '#efe9df', contrast: '#000000' };
function applyThemeColor(theme) {
  const meta = document.getElementById('themeColorMeta');
  if (meta) meta.setAttribute('content', THEME_COLORS[theme] || THEME_COLORS.dark);
}
function applyTheme(theme) {
  root.setAttribute('data-theme', theme);
  store.set('tuner-theme', theme);
  applyThemeColor(theme);
  cacheColors();
  pushGraphColors();
  controls.setTheme(theme);
}
(() => {
  const saved = store.get('tuner-theme', null);
  if (saved) { root.setAttribute('data-theme', saved); applyThemeColor(saved); }
})();
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

/* ---------- restore persisted state ---------- */
loadCustoms();
(() => {
  let last = null;
  try { last = localStorage.getItem(LS_LAST); } catch { /* ignore */ }
  const t = last && resolveTuning(last);
  if (t) { state.tuningId = t.id; state.instrument = t.instrument; }
})();
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
  onHapticToggle: setHaptic,
  onChimeToggle: setChime,
  onRetry: startMic,
});

// initial UI reflects (possibly restored) default state
controls.setInstrument(state.instrument);
controls.setCustomTunings(state.customTunings);
controls.setA4(state.a4);
controls.setTuning(resolveTuning(state.tuningId), state.a4);
controls.setMicState('idle');
setDisplayMode(state.displayMode);
controls.setHaptic(state.haptic);
controls.setChime(state.chime);
controls.setTheme(root.getAttribute('data-theme') || 'dark');

/* ---------- metronome view + mode nav ---------- */
// Practice + saved-meter state (persisted via store.js).
let metCountIn = 0;
let metAccel = 0;
let metSaved = [];
let metCountingIn = false;
let metCountInTarget = 0;
let lastAccelBar = -1;
(() => {
  const ci = store.get('tuner-met-countin', 0); if (typeof ci === 'number') metCountIn = ci;
  const ac = store.get('tuner-met-accel', 0); if (typeof ac === 'number') metAccel = ac;
  const sv = store.get('tuner-met-saved', []); if (Array.isArray(sv)) metSaved = sv.filter((m) => m && Array.isArray(m.bar));
})();

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
    // While running, only push edits to the scheduler when NOT counting in (the
    // real bar is staged for after the count-in) — otherwise the edit would replace
    // the count-in bar mid-count.
    if (metronome && !metCountingIn) metronome.setBar(bar);
    persistMet();
  },
  onCountInChange: (bars) => { metCountIn = bars; store.set('tuner-met-countin', bars); },
  onAccelChange: (step) => { metAccel = step; store.set('tuner-met-accel', step); },
  onSaveMeter: () => {
    metSaved.unshift({ label: meterLabel(state.metBar), bar: state.metBar.map((b) => ({ ...b })) });
    metSaved = metSaved.slice(0, CONFIG.metronome.savedMetersMax);
    store.set('tuner-met-saved', metSaved);
    metView.setSavedMeters(metSaved);
  },
  onLoadSaved: (id) => {
    const m = metSaved[id];
    if (!m) return;
    state.metBar = m.bar.map((b) => ({ ...b }));
    if (metronome && !metCountingIn) metronome.setBar(state.metBar);
    metView.setBar(state.metBar);
    persistMet();
  },
  onDeleteSaved: (id) => {
    metSaved.splice(id, 1);
    store.set('tuner-met-saved', metSaved);
    metView.setSavedMeters(metSaved);
  },
});
metView.setBpm(state.metBpm);
metView.setBar(state.metBar);
metView.setSavedMeters(metSaved);

document.getElementById('navTuner').addEventListener('click', () => setUiMode('tuner'));
document.getElementById('navMet').addEventListener('click', () => setUiMode('metronome'));

async function toggleMetronome() {
  await ensureAudioContext();
  if (metronome.isRunning) {
    metronome.stop();
    metView.setRunning(false);
    metCountingIn = false;
  } else {
    metronome.setBpm(state.metBpm);
    lastAccelBar = -1;
    if (metCountIn > 0) {
      // Count-in: play N bars of a plain pulse of the real bar's length, then the
      // scheduler swaps to the real bar (staged in metLoop when barCount reaches N).
      metCountingIn = true;
      metCountInTarget = metCountIn;
      metronome.setBar(makeAdditiveBar([state.metBar.length]));
    } else {
      metCountingIn = false;
      metronome.setBar(state.metBar);
    }
    metronome.start();
    metView.setRunning(true);
  }
}

function handleTap() {
  const now = performance.now();
  if (tapTimes.length && now - tapTimes[tapTimes.length - 1] > CONFIG.metronome.tapResetMs) tapTimes = [];
  tapTimes.push(now);
  metView.flashTap();
  const bpm = tapTempoBpm(tapTimes);
  if (bpm != null) {
    state.metBpm = bpm;
    metView.setBpm(bpm);
    if (metronome) metronome.setBpm(bpm);
    persistMet();
  }
}

/**
 * Metronome visual loop. Reads the sample-clock transport (never wall time) to drive a
 * continuous playhead + discrete beat brighten, applies auto-accelerate at bar
 * boundaries, and swaps the real bar in once a count-in finishes. Also drains the
 * beat queue so it can't grow across a session.
 */
function metLoop() {
  metRafId = requestAnimationFrame(metLoop);
  if (!audioCtx || !metronome || !metronome.isRunning) return;
  const now = audioCtx.currentTime;
  metronome.pollBeat(now);                       // drain queue (result unused; phase drives the UI)
  const tr = metronome.getTransport();
  if (!tr.running || tr.barDurSec <= 0) return;

  let phase = ((now - tr.barStartTime) / tr.barDurSec) % 1;
  if (phase < 0) phase += 1;
  const beat = tr.barLength ? Math.floor(phase * tr.barLength) : 0;
  metView.setTransport(phase, beat, tr.barCount);

  // Count-in → real bar swap (staged; applies at the next bar boundary).
  // Stage the real bar ONE boundary early: setBar while running applies at the NEXT bar
  // boundary (staged _pendingBar). Observing barCount === target would then swap only at
  // target+1, playing an extra count-in bar. -1 makes exactly `target` count-in bars.
  if (metCountingIn && tr.barCount >= metCountInTarget - 1) {
    metCountingIn = false;
    metronome.setBar(state.metBar);
  }
  // Auto-accelerate: once per qualifying bar boundary.
  if (metAccel > 0 && !metCountingIn && tr.barCount > 0 &&
      tr.barCount !== lastAccelBar && tr.barCount % CONFIG.metronome.accelEveryBars === 0) {
    lastAccelBar = tr.barCount;
    const next = Math.min(CONFIG.metronome.bpmMax, state.metBpm + metAccel);
    if (next !== state.metBpm) {
      state.metBpm = next;
      metronome.setBpm(next);
      metView.setBpm(next);
      persistMet();
    }
  }
}

function setUiMode(mode) {
  if (mode === state.uiMode) return;
  state.uiMode = mode;
  const toMet = mode === 'metronome';

  document.getElementById('tunerView').hidden = toMet;
  document.getElementById('metronomeView').hidden = !toMet;
  // The AUTO dot and A=440 chip are tuner-only — they mean nothing in metronome mode.
  document.getElementById('autoBtn').hidden = toMet;
  document.getElementById('a4Btn').hidden = toMet;
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
    metCountingIn = false;                 // don't leave a half-finished count-in armed
    metView.setRunning(false);
    cancelAnimationFrame(metRafId);
    if (state.wasRunning) startMic();
  }
}

window.addEventListener('resize', () => { graph.resize(); strobe.resize(); });

/* ---------- engine (re)build ---------- */
function buildEngine() {
  const t = resolveTuning(state.tuningId);
  state.mode = engineModeFor(t, state.a4);      // smart: derive DSP profile from tuning
  const mc = CONFIG.modes[state.mode];
  const sr = audioCtx.sampleRate;
  analysisN = mc.windowSize;
  const captureSize = 2 * analysisN;            // warm the filter over N, detect on the tail N

  // Adaptive detection low-pass: strip buzz above the top string's useful harmonics.
  const maxHz = frequencyFromMidi(Math.max(...t.strings), state.a4);
  const detectLpf = Math.min(mc.lpfHz, Math.max(CONFIG.detectLpfMinHz, maxHz * CONFIG.detectLpfHarmonics));

  detector = new MPMDetector({ sampleRate: sr, windowSize: analysisN, k: CONFIG.k, fMin: mc.fMin, fMax: mc.fMax });
  preFilter = createPreFilter(state.mode, sr, mc, detectLpf);
  rawBuf = new Float32Array(captureSize);
  procBuf = new Float32Array(captureSize);
  if (capture) capture.setWindowSize(captureSize);

  if (!stabilizer) {
    stabilizer = new Stabilizer({ config: CONFIG, a4: state.a4, tuning: t.strings });
  } else {
    stabilizer.reset();
    stabilizer.setA4(state.a4);
    stabilizer.setTuning(t.strings);
  }
  // reset()/setTuning() don't set lockedString (a fresh Stabilizer never sees it
  // either, since the ctor call above omits it) — always re-apply explicitly.
  stabilizer.setLockedString(state.lockedString);
  trail.clear();
  lastStringIndex = null;
  state.inTuneStreakStartMs = null;
  state.inTuneFired = false;
}

/* ---------- mic lifecycle ---------- */
async function ensureAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = CONFIG.masterGain;
    masterGain.connect(audioCtx.destination);
    tone = new ReferenceTone({ audioContext: audioCtx, destination: masterGain });
    metronome = new Metronome({ audioContext: audioCtx, destination: masterGain });
    metronome.setBpm(state.metBpm);
    metronome.setBar(state.metBar);
  }
  if (audioCtx.state === 'suspended') await audioCtx.resume();
}

async function startMic() {
  if (state.running || state.starting) return;
  state.starting = true;
  controls.setMicState('requesting');
  try {
    await ensureAudioContext();
    if (capture) capture.stop();
    const t = resolveTuning(state.tuningId);
    const mode = engineModeFor(t, state.a4);
    capture = new MicCapture({ audioContext: audioCtx, windowSize: 2 * CONFIG.modes[mode].windowSize, onTrackEnded: handleMicDisconnected });
    buildEngine();
    await capture.start();
    state.running = true;
    controls.setMicState('running');
    cancelAnimationFrame(rafId);
    loop();
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

function handleMicDisconnected() {
  state.running = false;
  cancelAnimationFrame(rafId);
  controls.setMicState('disconnected', 'Microphone disconnected. Tap Retry to reconnect.');
}

/* ---------- controls handlers ---------- */
function selectTuning(id) {
  const t = resolveTuning(id);
  if (!t) return;
  state.tuningId = id;
  state.instrument = t.instrument;
  // New tuning may have a different string count — the old pin can't carry over.
  state.lockedString = null;
  rememberTuning(id);
  controls.setInstrument(t.instrument);
  controls.setPinned(null);
  controls.setTuning(t, state.a4);
  stopTone();
  if (state.running) buildEngine();
}

/** Tap a string circle: pin detection to it, or unpin if it's already pinned. */
function selectString(index) {
  state.lockedString = state.lockedString === index ? null : index;
  if (stabilizer) stabilizer.setLockedString(state.lockedString);
  controls.setPinned(state.lockedString);
}

/** Header AUTO/PINNED button while the mic is running: unpin back to auto select. */
function handleAuto() {
  state.lockedString = null;
  if (stabilizer) stabilizer.setLockedString(null);
  controls.setPinned(null);
}

function changeInstrument(instrument) {
  state.instrument = instrument;
  // selectTuning() already syncs the Controls instrument UI internally (the
  // resolved default tuning's instrument always equals this one) — a second,
  // explicit sync call here was redundant and drove _renderTuningList() a third
  // time per switch.
  selectTuning(defaultTuningIdFor(instrument));
}

function changeTuning(tuningId) { selectTuning(tuningId); }

function changeA4(a4) {
  a4 = Math.max(CONFIG.a4Min, Math.min(CONFIG.a4Max, Math.round(a4)));
  state.a4 = a4;
  controls.setA4(a4);
  if (state.running) buildEngine();
  else if (stabilizer) stabilizer.setA4(a4);
  if (tone && tone.isPlaying && state.tonePlaying != null) {
    const t = resolveTuning(state.tuningId);
    const midi = t && t.strings[state.tonePlaying];
    if (midi != null) tone.play(frequencyFromMidi(midi, a4));
  }
}

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
  if (index == null) { stopTone(); return; }
  const t = resolveTuning(state.tuningId);
  if (!t || index < 0 || index >= t.strings.length) return;
  const freq = frequencyFromMidi(t.strings[index], state.a4);
  ensureAudioContext().then(() => {
    tone.play(freq);
    state.tonePlaying = index;
    controls.setTonePlaying(index);
  });
}
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

/* ---------- custom tunings ---------- */
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
function deleteCustom(id) {
  state.customTunings = state.customTunings.filter((t) => t.id !== id);
  saveCustoms();
  controls.setCustomTunings(state.customTunings);
  if (state.tuningId === id) selectTuning(defaultTuningIdFor(state.instrument));
}

/* ---------- render loop ---------- */
function loop() {
  rafId = requestAnimationFrame(loop);
  if (!capture || !capture.readFrame(rawBuf)) return;

  procBuf.set(rawBuf);
  preFilter.reset();
  preFilter.process(procBuf, procBuf);

  const now = performance.now();
  const frame = detector.detect(procBuf.subarray(procBuf.length - analysisN));
  const ds = stabilizer.update(frame, now);
  renderDebug(frame, ds);

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
  graph.render(trail, now);
  if (state.displayMode === 'strobe') strobe.render(ds, now); else dial.render(ds);
  controls.update(ds);
  if (ds.stringIndex !== lastStringIndex) {
    controls.setActiveString(ds.stringIndex);
    lastStringIndex = ds.stringIndex;
  }
}

window.addEventListener('beforeunload', () => {
  cancelAnimationFrame(rafId);
  cancelAnimationFrame(metRafId);
  if (metronome) metronome.stop();
  if (capture) capture.stop();
});
