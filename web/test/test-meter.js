// Node. Full case table for js/music/meter.js — the pure any-meter model.
import { suite, assert, assertClose } from './assert.js';
import {
  expandBar, makeAdditiveBar, cycleAccent, tapTempoBpm,
  groupsFromBar, regroupBar, ACCENT_CYCLE,
} from '../js/music/meter.js';
import { CONFIG } from '../js/config.js';

const beat = (accent = 'normal', subdivision = 1, group = 0) => ({ accent, subdivision, group });
const levels = (evs) => evs.map((e) => e.level);
const times = (evs) => evs.map((e) => e.timeOffsetSec);

/** Registers and runs the meter suite. */
export default function run() {
  suite('meter: plain 4/4 accents (bpm counts the pulse)', () => {
    const bar = makeAdditiveBar([4]);          // [accent, normal, normal, normal]
    const evs = expandBar(bar, 120);            // beatDur = 60/120 = 0.5s
    assert(evs.length === 4, 'four clicks for four beats');
    assert(times(evs).join(',') === '0,0.5,1,1.5', 'beats at 0, 0.5, 1.0, 1.5 (one 60/bpm interval each)');
    assert(levels(evs).join(',') === 'accent,normal,normal,normal', 'downbeat accented, rest normal');
  });

  suite('meter: 5/8 is five beats', () => {
    const bar = makeAdditiveBar([5]);
    const evs = expandBar(bar, 120);
    assert(evs.length === 5, 'five clicks for five beats');
    assert(times(evs).join(',') === '0,0.5,1,1.5,2', 'evenly spaced at 60/bpm');
    assert(levels(evs).join(',') === 'accent,normal,normal,normal,normal', 'single accented downbeat');
  });

  suite('meter: additive 3+2+2 — group-first beats get accent', () => {
    const bar = makeAdditiveBar([3, 2, 2]);     // 7 beats
    assert(bar.length === 7, 'seven beats');
    const evs = expandBar(bar, 120);
    assert(times(evs).join(',') === '0,0.5,1,1.5,2,2.5,3', 'seven pulses');
    assert(levels(evs).join(',') === 'accent,normal,normal,accent,normal,accent,normal',
      'beats 0, 3, 5 (each group start) are accented');
    assert(groupsFromBar(bar).join(',') === '3,2,2', 'groupsFromBar recovers 3,2,2');
  });

  suite('meter: subdivision 1..4 — first click = beat accent, rest = sub', () => {
    // bpm 60 → beatDur 1.0s for clean fractions.
    const s1 = expandBar([beat('normal', 1)], 60);
    assert(levels(s1).join(',') === 'normal' && s1.length === 1, 'sub=1 → one normal click at 0');

    const s2 = expandBar([beat('accent', 2)], 60);
    assert(levels(s2).join(',') === 'accent,sub', 'sub=2 → accent then sub');
    assert(times(s2).join(',') === '0,0.5', 'sub=2 clicks at 0 and 0.5');

    const s3 = expandBar([beat('normal', 3)], 60);
    assert(levels(s3).join(',') === 'normal,sub,sub', 'sub=3 → normal then two subs');
    assertClose(s3[1].timeOffsetSec, 1 / 3, 1e-9, 'second click at 1/3');
    assertClose(s3[2].timeOffsetSec, 2 / 3, 1e-9, 'third click at 2/3');

    const s4 = expandBar([beat('normal', 4)], 60);
    assert(levels(s4).join(',') === 'normal,sub,sub,sub', 'sub=4 → normal then three subs');
    assert(times(s4).join(',') === '0,0.25,0.5,0.75', 'sub=4 quarter-beat clicks');

    // out-of-range subdivision clamps to 1 (no crash, single beat click)
    const bad = expandBar([beat('normal', 7)], 60);
    assert(bad.length === 1 && bad[0].level === 'normal', 'unlisted subdivision falls back to 1');
  });

  suite('meter: rest emits nothing, ghost keeps its level', () => {
    const evs = expandBar([beat('accent', 1), beat('rest', 1), beat('normal', 1)], 60);
    assert(evs.length === 2, 'rest beat produces no click');
    assert(times(evs).join(',') === '0,2', 'the rest leaves a gap: clicks at 0 and 2, none at 1');

    const g = expandBar([beat('ghost', 1)], 60);
    assert(g.length === 1 && g[0].level === 'ghost', "ghost beat's click carries the 'ghost' level");
    // (its gain is CONFIG.metronome.levels.ghost.gain — mapped in metronome.js, guarded in test-config)
  });

  suite('meter: empty / invalid input is safe', () => {
    assert(expandBar([], 120).length === 0, 'empty bar → no events');
    assert(expandBar(makeAdditiveBar([4]), 0).length === 0, 'bpm 0 → no events (no divide-by-zero)');
  });

  suite('meter: ACCENT_CYCLE + cycleAccent', () => {
    assert(ACCENT_CYCLE.join(',') === 'normal,accent,ghost,rest', 'cycle order is normal→accent→ghost→rest');
    assert(cycleAccent('normal') === 'accent', 'normal → accent');
    assert(cycleAccent('accent') === 'ghost', 'accent → ghost');
    assert(cycleAccent('ghost') === 'rest', 'ghost → rest');
    assert(cycleAccent('rest') === 'normal', 'rest wraps to normal');
    assert(cycleAccent('bogus') === 'normal', 'unknown accent → normal');
  });

  suite('meter: tapTempoBpm averaging + clamp + reset', () => {
    assert(tapTempoBpm([1000]) === null, '<2 taps → null');
    assert(tapTempoBpm([0, 500, 1000, 1500]) === 120, '500ms intervals → 120 bpm');
    assert(tapTempoBpm([0, 1000]) === 60, '1000ms interval → 60 bpm');
    // a gap beyond tapResetMs is discarded; only the tight pair remains → too few → null
    const reset = CONFIG.metronome.tapResetMs;
    assert(tapTempoBpm([0, reset + 5000]) === null, 'interval beyond tapResetMs is ignored');
    // absurdly fast taps clamp to bpmMax
    assert(tapTempoBpm([0, 10, 20, 30]) === CONFIG.metronome.bpmMax, 'very fast taps clamp to bpmMax');
    // absurdly slow taps (within reset window is impossible; use exactly reset) clamp to bpmMin
    const slow = tapTempoBpm([0, reset]); // 2000ms → 30 bpm (== bpmMin default)
    assert(slow === CONFIG.metronome.bpmMin, 'slowest in-window tap clamps to bpmMin');
  });

  suite('meter: makeAdditiveBar shape', () => {
    const bar = makeAdditiveBar([3, 2, 2]);
    assert(bar.length === 7, 'flattened length = sum of groups');
    assert(bar[0].accent === 'accent' && bar[3].accent === 'accent' && bar[5].accent === 'accent',
      'each group-first beat is accented');
    assert(bar[1].accent === 'normal' && bar[2].accent === 'normal', 'interior beats normal');
    assert(bar[0].group === 0 && bar[3].group === 1 && bar[5].group === 2, 'group indices assigned');
    assert(bar.every((b) => b.subdivision === 1), 'default subdivision 1');
  });

  suite('meter: regroupBar reassigns groups + accents, preserves subdivision', () => {
    // start as a flat 7/8 single group with a custom subdivision on one beat
    const flat = makeAdditiveBar([7]);
    flat[4].subdivision = 3;            // user set a subdivided beat
    const re = regroupBar(flat, [3, 2, 2]);
    assert(re.length === 7, 'length unchanged');
    assert(groupsFromBar(re).join(',') === '3,2,2', 'new grouping applied');
    assert(re[0].accent === 'accent' && re[3].accent === 'accent' && re[5].accent === 'accent',
      'group-first beats accented');
    assert(re[1].accent === 'normal' && re[4].accent === 'normal', 'former single-group accent demoted to normal');
    assert(re[4].subdivision === 3, 'per-beat subdivision preserved across regroup');
  });
}
