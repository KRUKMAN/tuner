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

const root = document.documentElement;

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
const THEME_COLORS = { dark: '#0b0d10', light: '#efe9df' };
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
    capture = new MicCapture({ audioContext: audioCtx, windowSize: 2 * CONFIG.modes[mode].windowSize });
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
  selectTuning(defaultTuningIdFor(instrument));
  controls.setInstrument(instrument);
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
  if (capture) capture.stop();
});
