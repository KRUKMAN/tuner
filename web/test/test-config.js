// Node. Guards the shape, freeze, and internal relationships of CONFIG.metronome.
// Pure: config.js is Node-safe.
import { suite, assert } from './assert.js';
import { CONFIG } from '../js/config.js';

/** Registers and runs the CONFIG.metronome guard suite. */
export default function run() {
  suite('config: metronome block exists + deep-frozen', () => {
    const m = CONFIG.metronome;
    assert(!!m && typeof m === 'object', 'CONFIG.metronome is an object');
    assert(Object.isFrozen(m), 'CONFIG.metronome is frozen');
    assert(Object.isFrozen(m.levels), 'CONFIG.metronome.levels is frozen');
    assert(Object.isFrozen(m.levels.accent), 'levels.accent is frozen');
  });

  suite('config: bpm + beat-count bounds are ordered', () => {
    const m = CONFIG.metronome;
    assert(m.bpmMin < m.bpmDefault && m.bpmDefault < m.bpmMax, 'bpmMin < bpmDefault < bpmMax');
    assert(m.beatCountMin >= 1, 'beatCountMin >= 1');
    assert(m.beatCountMin < m.beatCountMax, 'beatCountMin < beatCountMax');
  });

  suite('config: subdivisions list', () => {
    const subs = CONFIG.metronome.subdivisions;
    assert(Array.isArray(subs) && subs.length > 0, 'subdivisions is a non-empty array');
    assert(subs.includes(1), 'subdivisions includes 1 (the un-subdivided beat)');
    assert(subs.every((s) => Number.isInteger(s) && s >= 1), 'all subdivisions are positive integers');
  });

  suite('config: scheduler window exceeds the pump period', () => {
    const m = CONFIG.metronome;
    // The look-ahead window MUST be larger than the pump interval, or a click can
    // fall between two pumps and never get scheduled.
    assert(m.scheduleAheadSec > m.lookaheadMs / 1000, 'scheduleAheadSec > lookaheadMs (seconds)');
    assert(m.lookaheadMs > 0 && m.scheduleAheadSec > 0, 'both scheduler constants are positive');
  });

  suite('config: click envelope + tap-tempo sanity', () => {
    const m = CONFIG.metronome;
    assert(m.clickAttackMs > 0 && m.clickAttackMs < m.clickMs, '0 < clickAttackMs < clickMs');
    assert(typeof m.clickType === 'string' && m.clickType.length > 0, 'clickType is a non-empty string');
    assert(m.tapMaxTaps >= 2, 'tapMaxTaps >= 2 (need at least one interval)');
    assert(m.tapResetMs > 0, 'tapResetMs > 0');
  });

  suite('config: per-level voices (freq + gain, accent loudest, ghost quietest)', () => {
    const L = CONFIG.metronome.levels;
    for (const name of ['accent', 'normal', 'ghost', 'sub']) {
      assert(L[name] && L[name].freq > 0, `${name}.freq > 0`);
      assert(L[name] && L[name].gain > 0 && L[name].gain <= 1, `${name}.gain in (0,1]`);
    }
    assert(L.ghost.gain < L.normal.gain, 'ghost is quieter than normal');
    assert(L.normal.gain <= L.accent.gain, 'accent is at least as loud as normal');
  });
}
