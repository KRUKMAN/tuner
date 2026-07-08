// Node. Cases for js/dsp/trail.js — fixed-capacity ring buffer of pitch readings.

import { suite, assert } from './assert.js';
import { TrailBuffer } from '../js/dsp/trail.js';

/** Collects forEach output into an array of tuples for easy assertions. */
function collect(buf, nowMs) {
  const out = [];
  buf.forEach(nowMs, (tMs, cents, conf, inTune) => {
    out.push({ tMs, cents, conf, inTune });
  });
  return out;
}

/** Registers and runs the trail suite. */
export default function run() {
  suite('trail: push/forEach oldest -> newest order', () => {
    const buf = new TrailBuffer({ capacity: 8, windowMs: 100000 });
    buf.push(10, 1, 0.5, false);
    buf.push(20, 2, 0.6, true);
    buf.push(30, 3, 0.7, false);
    const got = collect(buf, 30);
    assert(got.length === 3, 'three samples iterated');
    assert(got[0].tMs === 10 && got[1].tMs === 20 && got[2].tMs === 30, 'iterated oldest -> newest');
    assert(got[0].cents === 1 && got[2].cents === 3, 'cents carried through');
    assert(got[1].inTune === true && got[0].inTune === false, 'inTune flag preserved');
    assert(Math.abs(got[1].conf - 0.6) < 1e-6, 'confidence preserved');
  });

  suite('trail: wraparound at capacity', () => {
    const cap = 16;
    const buf = new TrailBuffer({ capacity: cap, windowMs: 1e12 });
    // Push cap + 10 samples with tMs = index so survivors are identifiable.
    for (let i = 0; i < cap + 10; i++) buf.push(i, i, 1, false);
    assert(buf.count === cap, `count caps at capacity (${cap})`);
    const got = collect(buf, cap + 10);
    assert(got.length === cap, 'forEach yields exactly capacity samples');
    // Oldest survivor is sample index 10 (first 10 overwritten); newest is cap+9.
    assert(got[0].tMs === 10, 'oldest survivor is sample 10');
    assert(got[got.length - 1].tMs === cap + 9, `newest is sample ${cap + 9}`);
    // Monotonic increasing order preserved across the wrap.
    let ordered = true;
    for (let i = 1; i < got.length; i++) if (got[i].tMs <= got[i - 1].tMs) ordered = false;
    assert(ordered, 'survivors remain in oldest -> newest order across wrap');
  });

  suite('trail: windowMs trimming', () => {
    const buf = new TrailBuffer({ capacity: 32, windowMs: 5000 });
    buf.push(1000, 1, 1, false);   // old, outside window at now=7000
    buf.push(1500, 2, 1, false);   // old, exactly at cutoff (7000-5000=2000) -> excluded
    buf.push(2000, 3, 1, false);   // at cutoff boundary -> excluded (t <= cutoff)
    buf.push(3000, 4, 1, false);   // inside window
    buf.push(6000, 5, 1, false);   // inside window
    const got = collect(buf, 7000);
    assert(got.length === 2, 'only samples newer than nowMs-windowMs are yielded');
    assert(got[0].tMs === 3000 && got[1].tMs === 6000, 'trimmed to in-window samples');
  });

  suite('trail: NaN cents preserved', () => {
    const buf = new TrailBuffer({ capacity: 8, windowMs: 100000 });
    buf.push(10, 5, 1, false);
    buf.push(20, NaN, 0, false);   // a gap
    buf.push(30, 7, 1, true);
    const got = collect(buf, 30);
    assert(got.length === 3, 'gap sample not dropped from iteration');
    assert(Number.isNaN(got[1].cents), 'NaN cents preserved through forEach');
    assert(got[0].cents === 5 && got[2].cents === 7, 'surrounding samples intact');
  });

  suite('trail: clear() empties it', () => {
    const buf = new TrailBuffer({ capacity: 8, windowMs: 100000 });
    buf.push(10, 1, 1, false);
    buf.push(20, 2, 1, true);
    buf.clear();
    assert(buf.count === 0, 'count is 0 after clear');
    const got = collect(buf, 100);
    assert(got.length === 0, 'forEach yields nothing after clear');
    // Reusable after clear.
    buf.push(40, 9, 1, true);
    const got2 = collect(buf, 40);
    assert(got2.length === 1 && got2[0].tMs === 40, 'buffer reusable after clear');
  });
}
