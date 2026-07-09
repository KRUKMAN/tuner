// Node. Cases for js/music/instruments.js — the pure instrument registry — and its
// contract with js/music/tunings.js (every defaultTuningId resolves; classification).
import { suite, assert, assertClose } from './assert.js';
import { INSTRUMENTS, instrumentById, defaultTuningIdFor } from '../js/music/instruments.js';
import { TUNINGS, makeCustomTuning, validateTuningStrings } from '../js/music/tunings.js';
import { frequencyFromMidi } from '../js/music/theory.js';

/** Registers and runs the instrument-registry suites. */
export default function run() {
  suite('instruments: registry integrity', () => {
    assert(Array.isArray(INSTRUMENTS) && INSTRUMENTS.length === 7, 'registry has 7 instruments');
    const ids = INSTRUMENTS.map((r) => r.id);
    assert(new Set(ids).size === ids.length, 'instrument ids are unique');
    assert(ids.join(',') === 'guitar,bass,ukulele,mandolin,violin,banjo,baritone', 'registry order');
    assert(INSTRUMENTS.every((r, i) => r.order === i), 'order is 0-based ascending, matching array position');
    assert(INSTRUMENTS.every((r) => typeof r.label === 'string' && r.label.length > 0), 'every row has a non-empty label');
    assert(Object.isFrozen(INSTRUMENTS), 'INSTRUMENTS is frozen');
  });

  suite('instruments: every defaultTuningId resolves to a matching preset', () => {
    INSTRUMENTS.forEach((r) => {
      const t = TUNINGS[r.defaultTuningId];
      assert(!!t, `${r.id} defaultTuningId '${r.defaultTuningId}' exists in TUNINGS`);
      assert(t && t.instrument === r.id, `${r.id} default tuning is tagged instrument '${r.id}'`);
    });
  });

  suite('instruments: every TUNINGS entry belongs to a registered instrument', () => {
    const known = new Set(INSTRUMENTS.map((r) => r.id));
    const orphans = Object.values(TUNINGS).filter((t) => !known.has(t.instrument)).map((t) => t.id);
    assert(orphans.length === 0, `no tuning references an unknown instrument (orphans: ${orphans.join(', ') || 'none'})`);
    INSTRUMENTS.forEach((r) => {
      const has = Object.values(TUNINGS).some((t) => t.instrument === r.id);
      assert(has, `${r.id} has at least one preset tuning`);
    });
  });

  suite('instruments: helpers', () => {
    assert(instrumentById('violin').label === 'Violin', "instrumentById('violin') → row");
    assert(instrumentById('nope') === undefined, 'instrumentById(unknown) → undefined');
    assert(defaultTuningIdFor('bass') === 'bass-4-standard', "defaultTuningIdFor('bass')");
    assert(defaultTuningIdFor('ukulele') === 'ukulele-standard', "defaultTuningIdFor('ukulele')");
    assert(defaultTuningIdFor('nope') === 'guitar-standard', 'defaultTuningIdFor(unknown) → guitar-standard fallback');
  });

  suite('instruments: makeCustomTuning honours explicit instrument (fixes misclassification)', () => {
    // A LOW custom guitar (lowest MIDI 35 < 36) would infer 'bass' — explicit instrument wins.
    const low = makeCustomTuning([35, 40, 45, 50, 54, 59], 'Low', 'c1', 'guitar');
    assert(low.instrument === 'guitar', 'low custom saved as guitar keeps guitar (not bass)');
    // Arbitrary new instrument id is honoured verbatim.
    const uke = makeCustomTuning([60, 64, 67, 69], 'Uke', 'c2', 'ukulele');
    assert(uke.instrument === 'ukulele', 'explicit ukulele honoured');
    // No instrument arg → legacy min-midi inference still applies (guitar range → guitar).
    assert(makeCustomTuning([40, 45, 50, 55, 59, 64]).instrument === 'guitar', 'no-arg inference still → guitar');
  });

  suite('instruments: preset ceiling fits the custom-string clamp', () => {
    // The highest preset pitch (mandolin/violin E5 = 76) sits exactly at the clamp ceiling.
    assert(validateTuningStrings([76])[0] === 76, 'E5 (76) is within the [21,76] clamp');
    assert(validateTuningStrings([77])[0] === 76, 'above E5 clamps down to 76');
    assert(validateTuningStrings([20])[0] === 21, 'below A0 clamps up to 21');
    assertClose(frequencyFromMidi(76, 440), 659.26, 0.05, 'E5 ceiling ≈ 659.26 Hz (< guitar fMax 1200)');
  });
}
