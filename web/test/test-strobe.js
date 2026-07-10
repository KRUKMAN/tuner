// Node. Cases for js/ui/strobe.js's pure phase-accumulation helper.
import { suite, assert, assertClose } from './assert.js';
import { CONFIG } from '../js/config.js';
import { strobePhaseDelta } from '../js/ui/strobe.js';

/** Registers and runs the strobe-math suite. */
export default function run() {
  suite('strobe: zero at 0 cents', () => {
    assert(strobePhaseDelta(0, 1) === 0, 'strobePhaseDelta(0, dt) === 0');
  });

  suite('strobe: frozen inside the in-tune dead-band', () => {
    assert(strobePhaseDelta(CONFIG.inTuneCents, 1) === 0, 'exactly at +inTuneCents -> 0 (dead-band is inclusive)');
    assert(strobePhaseDelta(-CONFIG.inTuneCents, 1) === 0, 'exactly at -inTuneCents -> 0');
    assert(strobePhaseDelta(2, 1) === 0, 'well inside the dead-band -> 0');
  });

  suite('strobe: proportional to cents outside the dead-band', () => {
    const beyond = CONFIG.inTuneCents + 5; // clear of the dead-band
    assertClose(strobePhaseDelta(beyond, 1), beyond * CONFIG.strobeVelocityScale, 1e-9, 'sharp (positive) cents -> positive (rightward) delta');
    assertClose(strobePhaseDelta(-beyond, 1), -beyond * CONFIG.strobeVelocityScale, 1e-9, 'flat (negative) cents -> negative (leftward) delta');
  });

  suite('strobe: scales linearly with dt', () => {
    const beyond = CONFIG.inTuneCents + 10;
    const full = strobePhaseDelta(beyond, 1);
    const half = strobePhaseDelta(beyond, 0.5);
    assertClose(half, full / 2, 1e-9, 'half the elapsed time -> half the delta');
  });

  suite('strobe: sign flips exactly at the dead-band edge', () => {
    const justOutside = CONFIG.inTuneCents + 0.01;
    assert(strobePhaseDelta(justOutside, 1) > 0, 'just above +inTuneCents -> positive delta');
    assert(strobePhaseDelta(-justOutside, 1) < 0, 'just below -inTuneCents -> negative delta');
  });

  suite('strobe: degenerate inputs are inert', () => {
    assert(strobePhaseDelta(null, 1) === 0, 'null cents -> 0');
    assert(strobePhaseDelta(NaN, 1) === 0, 'NaN cents -> 0');
    assert(strobePhaseDelta(20, 0) === 0, 'zero dt -> 0');
    assert(strobePhaseDelta(20, -1) === 0, 'negative dt -> 0');
  });
}
