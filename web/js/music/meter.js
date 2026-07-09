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
