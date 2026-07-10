// Node test for js/audio/metronome.js. Two halves:
//   1. Construction/clamp smoke tests against a minimal fake context.
//   2. A fuller fake AudioContext with a hand-advanced currentTime that drives the
//      real scheduler via the extracted _pumpOnce() (no real setTimeout, no real
//      Web Audio) so the look-ahead grid math and the Fix-1 past-due guard are
//      actually exercised deterministically, not just smoke-tested.
import { suite, assert, assertClose } from './assert.js';
import { Metronome } from '../js/audio/metronome.js';
import { raisedCosineCurve } from '../js/audio/tone.js';
import { CONFIG } from '../js/config.js';

// Minimal fake context: the ctor and setBpm/isRunning never call ctx methods.
const fakeCtx = () => ({ currentTime: 0 });

/**
 * Full fake AudioContext for driving the real scheduler. `time.now` is the only
 * clock; the ctx.currentTime getter reads it, and tests advance it by hand — no
 * setTimeout/Date/performance involved anywhere. Every osc.start(when) call is
 * recorded (with the frequency set just before it) so tests can assert on the
 * exact grid of scheduled click times.
 */
function makeFakeAudioContext() {
  const time = { now: 0 };
  const starts = []; // { when, freq }
  const ctx = {
    get currentTime() { return time.now; },
    destination: {},
    createGain() {
      return {
        gain: {
          value: 0,
          setValueAtTime(v) { this.value = v; },
          cancelScheduledValues() { /* no-op fake */ },
          setValueCurveAtTime() { /* no-op fake */ },
        },
        connect() {},
        disconnect() {},
      };
    },
    createOscillator() {
      let freq = null;
      return {
        type: '',
        frequency: { setValueAtTime(f) { freq = f; } },
        onended: null,
        connect() {},
        disconnect() {},
        start(when) { starts.push({ when, freq }); },
        stop() {},
      };
    },
  };
  return { ctx, time, starts };
}

/**
 * Start the metronome without letting the real setTimeout pump escape into Node's
 * event loop: start() arms exactly one real timer via _pump(), which we cancel
 * immediately (synchronously, before the event loop can ever fire it). Every
 * subsequent tick in these tests drives _pumpOnce() directly by hand.
 */
function startDeterministic(m) {
  m.start();
  if (m._timer != null) { clearTimeout(m._timer); m._timer = null; }
}

const FOUR_FOUR = [
  { accent: 'accent', subdivision: 1 },
  { accent: 'normal', subdivision: 1 },
  { accent: 'normal', subdivision: 1 },
  { accent: 'normal', subdivision: 1 },
];

/** Registers and runs the metronome test suite. */
export default function run() {
  suite('metronome: construction guard', () => {
    let threw = false;
    try { new Metronome({}); } catch { threw = true; }
    assert(threw, 'ctor throws without audioContext');
    const m = new Metronome({ audioContext: fakeCtx() });
    assert(m.isRunning === false, 'isRunning false before start()');
  });

  suite('metronome: bpm clamp + round', () => {
    const m = new Metronome({ audioContext: fakeCtx() });
    assert(m.bpm === CONFIG.metronome.bpmDefault, 'default bpm = config default');
    m.setBpm(5);
    assert(m.bpm === CONFIG.metronome.bpmMin, 'below min clamps to bpmMin');
    m.setBpm(99999);
    assert(m.bpm === CONFIG.metronome.bpmMax, 'above max clamps to bpmMax');
    m.setBpm(128);
    assert(m.bpm === 128, 'in-range bpm kept');
    m.setBpm(120.6);
    assert(m.bpm === 121, 'fractional bpm rounded');
  });

  suite('metronome: pollBeat with no schedule → -1', () => {
    const m = new Metronome({ audioContext: fakeCtx() });
    assert(m.pollBeat(0) === -1, 'nothing queued → -1');
  });

  suite('metronome: Package-D raisedCosineCurve export present', () => {
    assert(typeof raisedCosineCurve === 'function', 'tone.js exports raisedCosineCurve');
    const c = raisedCosineCurve(1, true, 8);
    assert(c.length === 8, 'curve length honoured');
    assert(c[0] === 0 && Math.abs(c[c.length - 1] - 1) < 1e-9, 'rising curve runs 0 → peak');
  });

  suite('metronome: fake-clock scheduler — exact beat grid across bars (no drift)', () => {
    const { ctx, time, starts } = makeFakeAudioContext();
    const m = new Metronome({ audioContext: ctx });
    const bpm = 120;
    const beatDur = 60 / bpm;
    m.setBpm(bpm);
    m.setBar(FOUR_FOUR);
    startDeterministic(m);

    const leadIn = CONFIG.metronome.scheduleAheadSec;
    const barDur = FOUR_FOUR.length * beatDur;
    const stepSec = CONFIG.metronome.lookaheadMs / 1000;
    const BARS = 3;
    // Stop just after the LAST expected click (not a whole extra bar past it) so the
    // run captures exactly BARS bars of events, no more, no less.
    const lastEventTime = leadIn + (BARS - 1) * barDur + (FOUR_FOUR.length - 1) * beatDur;
    const runUntil = lastEventTime + stepSec;

    // Drive the pump the same way the real setTimeout loop would: small steps, each
    // well inside scheduleAheadSec of the previous, so nothing is ever past-due.
    while (time.now < runUntil) {
      time.now += stepSec;
      m._pumpOnce();
    }

    const expected = [];
    for (let n = 0; n < BARS; n++) {
      for (let k = 0; k < FOUR_FOUR.length; k++) {
        expected.push(leadIn + n * barDur + k * beatDur);
      }
    }
    assert(starts.length === expected.length, `scheduled exactly ${expected.length} clicks (got ${starts.length})`);
    for (let i = 0; i < expected.length && i < starts.length; i++) {
      assertClose(starts[i].when, expected[i], 1e-9, `click #${i} lands on the exact beat grid`);
    }
    // Bar boundaries advance by exactly bar.length * 60/bpm — accumulated over 3
    // bars this would reveal any per-bar rounding drift immediately.
    assertClose(starts[4].when - starts[0].when, barDur, 1e-9, 'bar 1 starts exactly one bar after bar 0');
    assertClose(starts[8].when - starts[4].when, barDur, 1e-9, 'bar 2 starts exactly one bar after bar 1');
    assertClose(starts[8].when - starts[0].when, 2 * barDur, 1e-9, 'bar 2 start vs bar 0 start has zero accumulated drift');
  });

  suite('metronome: transport snapshot drives a correct continuous playhead', () => {
    const { ctx, time } = makeFakeAudioContext();
    const m = new Metronome({ audioContext: ctx });
    const bpm = 120, beatDur = 60 / bpm, barDur = FOUR_FOUR.length * beatDur; // 2.0s
    m.setBpm(bpm);
    m.setBar(FOUR_FOUR);

    // Stopped: transport reports not-running with the current bar's shape.
    let tr = m.getTransport();
    assert(tr.running === false, 'stopped → running false');
    assert(tr.barLength === 4, 'barLength reflects the current bar');

    startDeterministic(m);
    tr = m.getTransport();
    assert(tr.running === true && tr.barCount === 0, 'started → running, barCount 0');
    assertClose(tr.barDurSec, barDur, 1e-9, 'barDurSec = barLength * 60/bpm');
    assertClose(tr.beatDur, beatDur, 1e-9, 'beatDur = 60/bpm');

    // The playhead phase the UI would compute, at a few clock positions. barStartTime
    // runs ahead by the lead-in, but the modulo makes the phase correct regardless.
    const phaseAt = (now) => {
      const t = m.getTransport();
      let p = ((now - t.barStartTime) / t.barDurSec) % 1;
      return p < 0 ? p + 1 : p;
    };
    const leadIn = CONFIG.metronome.scheduleAheadSec;
    assertClose(phaseAt(leadIn), 0, 1e-9, 'phase 0 at the first bar start');
    assertClose(phaseAt(leadIn + beatDur), 0.25, 1e-9, 'phase 0.25 one beat into a 4/4 bar');
    assertClose(phaseAt(leadIn + 2 * beatDur), 0.5, 1e-9, 'phase 0.5 at the half bar');
    assertClose(phaseAt(leadIn + 3.5 * beatDur), 0.875, 1e-9, 'phase wraps correctly late in the bar');
    // And a full bar later the phase is identical (periodic), even though the audible
    // bar has advanced — this is why the modulo trick is valid.
    assertClose(phaseAt(leadIn + barDur + beatDur), 0.25, 1e-9, 'phase is periodic across bars');

    // Drive the pump across two bar boundaries; barCount must increment.
    const stepSec = CONFIG.metronome.lookaheadMs / 1000;
    const runUntil = leadIn + 2 * barDur + 0.5 * beatDur;
    while (time.now < runUntil) { time.now += stepSec; m._pumpOnce(); }
    assert(m.getTransport().barCount >= 2, `barCount advances with bars (got ${m.getTransport().barCount})`);

    m.stop();
    assert(m.getTransport().running === false, 'stop → running false');
  });

  suite('metronome: fake-clock scheduler — past-due guard on a stall (Fix 1)', () => {
    const { ctx, time, starts } = makeFakeAudioContext();
    const m = new Metronome({ audioContext: ctx });
    const bpm = 120;
    const beatDur = 60 / bpm;
    m.setBpm(bpm);
    m.setBar(FOUR_FOUR);
    startDeterministic(m);

    const leadIn = CONFIG.metronome.scheduleAheadSec;      // 0.1
    const barDur = FOUR_FOUR.length * beatDur;              // 2.0 @ 120bpm

    // Stall: jump the clock forward by more than two full bars in a single step —
    // e.g. a backgrounded tab where setTimeout throttles but the audio clock (and
    // therefore ctx.currentTime) keeps advancing.
    time.now = leadIn + 2 * barDur + 0.9;
    const before = starts.length;
    m._pumpOnce();
    const fresh = starts.slice(before);

    assert(fresh.length === 0, 'the stall schedules nothing at all rather than bunching every skipped bar into one instant');
    assert(fresh.every((s) => s.when >= time.now), 'no click is ever scheduled with when < currentTime');

    // Resume: advance one normal pump step and confirm scheduling picks back up.
    time.now += CONFIG.metronome.lookaheadMs / 1000;
    m._pumpOnce();
    assert(starts.length === before + 1, 'scheduling resumes as soon as the clock reaches a real (non-past-due) event');

    const resumed = starts[starts.length - 1];
    assert(resumed.when >= time.now - 1e-9, 'the resumed click is not itself past-due');
    // Phase check: the resumed click must land on the ORIGINAL beat grid
    // (leadIn + k*beatDur, mod beatDur) — the stall must skip whole events, never
    // shift or reset the phase.
    const kFrac = ((resumed.when - leadIn) % beatDur + beatDur) % beatDur;
    const onGrid = kFrac < 1e-9 || beatDur - kFrac < 1e-9;
    assert(onGrid, `resumed click at ${resumed.when}s lands exactly back on the original beat grid (phase preserved)`);
  });
}
