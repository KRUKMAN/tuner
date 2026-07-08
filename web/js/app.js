// BROWSER. Composition root: creates the AudioContext on the start gesture,
// instantiates every module, owns the rAF loop and app state.

import { CONFIG } from './config.js';
import { MPMDetector } from './dsp/mpm.js';
import { createPreFilter } from './dsp/filters.js';
import { Stabilizer } from './dsp/stabilizer.js';
import { frequencyFromMidi } from './music/theory.js';
import { TUNINGS, makeCustomTuning, validateTuningStrings } from './music/tunings.js';
import { MicCapture } from './audio/capture.js';
import { ReferenceTone } from './audio/tone.js';
import { TrailBuffer } from './dsp/trail.js';
import { Dial } from './ui/dial.js';
import { Graph } from './ui/graph.js';
import { Controls } from './ui/controls.js';

const DEFAULT_TUNING = { guitar: 'guitar-standard', bass: 'bass-4-standard' };
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
  customTunings: [],         // [{id,name,instrument,strings}]
};

/** @type {AudioContext} */ let audioCtx = null;
/** @type {MicCapture} */   let capture = null;
/** @type {MPMDetector} */  let detector = null;
let preFilter = null;
/** @type {Stabilizer} */   let stabilizer = null;
/** @type {ReferenceTone} */ let tone = null;
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
  graph.setColors({ accent: accentColor, accentIn: accentInColor, grid: cssVar('--muted-2') || '#556' });
}
function applyTheme(theme) {
  root.setAttribute('data-theme', theme);
  try { localStorage.setItem('tuner-theme', theme); } catch { /* ignore */ }
  cacheColors();
  pushGraphColors();
}
(() => {
  let saved = null;
  try { saved = localStorage.getItem('tuner-theme'); } catch { /* ignore */ }
  if (saved) root.setAttribute('data-theme', saved);
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
const dial = new Dial(document.getElementById('dial'), { rangeCents: 50 });
const graph = new Graph(document.getElementById('trail'), { rangeCents: 50, windowMs: 5000, inTuneCents: CONFIG.inTuneCents });
pushGraphColors();
graph.resize();

const controls = new Controls(document, {
  onMicStart: startMic,
  onModeChange: changeInstrument,
  onTuningChange: changeTuning,
  onA4Change: changeA4,
  onToneToggle: toggleTone,
  onThemeToggle: applyTheme,
  onCustomSave: saveCustom,
  onCustomDelete: deleteCustom,
});

// initial UI reflects (possibly restored) default state
controls.setInstrument(state.instrument);
controls.setCustomTunings(state.customTunings);
controls.setA4(state.a4);
controls.setTuning(resolveTuning(state.tuningId), state.a4);
controls.setMicState('idle');

window.addEventListener('resize', () => graph.resize());

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
  trail.clear();
  lastStringIndex = null;
}

/* ---------- mic lifecycle ---------- */
async function ensureAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    tone = new ReferenceTone({ audioContext: audioCtx });
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
    const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
    controls.setMicState(denied ? 'denied' : 'error',
      denied ? undefined : `Could not start audio: ${err && err.message ? err.message : err}`);
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
  rememberTuning(id);
  controls.setInstrument(t.instrument);
  controls.setTuning(t, state.a4);
  stopTone();
  if (state.running) buildEngine();
}

function changeInstrument(instrument) {
  state.instrument = instrument;
  selectTuning(DEFAULT_TUNING[instrument]);
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

/* ---------- custom tunings ---------- */
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
function deleteCustom(id) {
  state.customTunings = state.customTunings.filter((t) => t.id !== id);
  saveCustoms();
  controls.setCustomTunings(state.customTunings);
  if (state.tuningId === id) selectTuning(DEFAULT_TUNING[state.instrument]);
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
  trail.push(now, active && ds.cents != null ? ds.cents : NaN, ds.confidence, ds.inTune);
  graph.render(trail, now);
  dial.render(ds);
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
