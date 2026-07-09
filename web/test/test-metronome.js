// Node SMOKE test for js/audio/metronome.js. The scheduler + click synth need a
// real AudioContext, so this covers ONLY: construction guards, bpm clamp, and the
// presence of the Package-D raisedCosineCurve export. Timing is verified manually.
import { suite, assert } from './assert.js';
import { Metronome } from '../js/audio/metronome.js';
import { raisedCosineCurve } from '../js/audio/tone.js';
import { CONFIG } from '../js/config.js';

// Minimal fake context: the ctor and setBpm/isRunning never call ctx methods.
const fakeCtx = () => ({ currentTime: 0 });

/** Registers and runs the metronome smoke suite. */
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
}
