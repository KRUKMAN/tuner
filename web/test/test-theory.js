// Node. Cases for js/music/theory.js + js/music/tunings.js (Section 6).

import { suite, assert, assertClose } from './assert.js';
import {
  frequencyFromMidi,
  noteFromFrequency,
  centsBetween,
  midiToName,
  nearestString,
} from '../js/music/theory.js';
import { TUNINGS, tuningsFor, makeCustomTuning } from '../js/music/tunings.js';

/** Registers and runs the theory/tunings suites. */
export default function run() {
  suite('theory: frequencyFromMidi', () => {
    // A4 (MIDI 69) at a4=440 is exactly 440 Hz.
    assertClose(frequencyFromMidi(69, 440), 440, 1e-9, 'frequencyFromMidi(69,440) === 440');
    // E1 (MIDI 28) ≈ 41.203 Hz within 0.01 Hz.
    assertClose(frequencyFromMidi(28, 440), 41.203, 0.01, 'frequencyFromMidi(28,440) ≈ 41.203 Hz');
  });

  suite('theory: noteFromFrequency', () => {
    // 445 Hz is A4 sharpened by ≈ +19.56 cents.
    const info = noteFromFrequency(445, 440);
    assert(info.name === 'A', "noteFromFrequency(445,440).name === 'A'");
    assert(info.octave === 4, 'noteFromFrequency(445,440).octave === 4');
    assert(info.midi === 69, 'noteFromFrequency(445,440).midi === 69');
    assertClose(info.cents, 19.56, 0.01, 'noteFromFrequency(445,440).cents ≈ +19.56');
    assertClose(info.refFreq, 440, 1e-9, 'noteFromFrequency(445,440).refFreq === 440');
  });

  suite('theory: A4 = 432 shifts refFreqs', () => {
    // The A4 anchor itself moves to 432.
    assertClose(frequencyFromMidi(69, 432), 432, 1e-9, 'frequencyFromMidi(69,432) === 432');
    const a = noteFromFrequency(432, 432);
    assert(a.name === 'A' && a.octave === 4, 'noteFromFrequency(432,432) → A4');
    assertClose(a.cents, 0, 1e-6, 'noteFromFrequency(432,432).cents ≈ 0');
    // Every ref frequency scales by 432/440 relative to standard tuning.
    const c4_440 = frequencyFromMidi(60, 440);
    const c4_432 = frequencyFromMidi(60, 432);
    assertClose(c4_432, c4_440 * (432 / 440), 1e-9, 'C4 ref scales by 432/440');
    const info = noteFromFrequency(c4_432, 432);
    assert(info.midi === 60, 'noteFromFrequency(C4@432,432).midi === 60');
    assertClose(info.refFreq, c4_432, 1e-6, 'noteFromFrequency(C4@432,432).refFreq matches');
  });

  suite('theory: centsBetween', () => {
    // One octave up is exactly 1200 cents; a semitone is 100.
    assertClose(centsBetween(880, 440), 1200, 1e-9, 'centsBetween(880,440) === 1200');
    assertClose(centsBetween(440, 440), 0, 1e-12, 'centsBetween(440,440) === 0');
    assertClose(
      centsBetween(frequencyFromMidi(61), frequencyFromMidi(60)),
      100,
      1e-6,
      'one semitone === 100 cents',
    );
  });

  suite('theory: nearestString', () => {
    // 83 Hz is nearest the low E2 (MIDI 40, 82.41 Hz) → index 0.
    const r = nearestString(83, [40, 45, 50, 55, 59, 64]);
    assert(r.index === 0, 'nearestString(83, standard) → index 0');
    assert(r.midi === 40, 'nearestString(83, standard).midi === 40');
    // 110 Hz is exactly the A2 string (MIDI 45) → index 1, ~0 cents.
    const r2 = nearestString(110, [40, 45, 50, 55, 59, 64]);
    assert(r2.index === 1, 'nearestString(110, standard) → index 1 (A2)');
    assertClose(r2.cents, 0, 1e-6, 'nearestString(110) cents ≈ 0');
  });

  suite('theory: midiToName', () => {
    // MIDI 23 → B0.
    const b0 = midiToName(23);
    assert(b0.name === 'B' && b0.octave === 0, "midiToName(23) → {name:'B', octave:0}");
    // MIDI 40 → E2 (low guitar string), 69 → A4.
    const e2 = midiToName(40);
    assert(e2.name === 'E' && e2.octave === 2, "midiToName(40) → E2");
    const a4 = midiToName(69);
    assert(a4.name === 'A' && a4.octave === 4, "midiToName(69) → A4");
  });

  suite('tunings: catalogue + helpers', () => {
    assert(TUNINGS['guitar-standard'].strings.join(',') === '40,45,50,55,59,64', 'standard E strings');
    assert(TUNINGS['bass-5-standard'].strings[0] === 23, '5-string bass lowest is B0 (23)');
    const guitars = tuningsFor('guitar');
    assert(guitars.length === 11 && guitars.every((t) => t.instrument === 'guitar'), 'tuningsFor(guitar) → 11 guitar tunings');
    assert(guitars[0].id === 'guitar-standard' && guitars[1].id === 'guitar-drop-d', 'guitar catalogue order: Standard then Drop D first');
    const basses = tuningsFor('bass');
    assert(basses.length === 4 && basses.every((t) => t.instrument === 'bass'), 'tuningsFor(bass) → 4 bass tunings');
    // added presets: spot-check a low tuning that needs the bass engine profile
    assert(TUNINGS['guitar-drop-c'].strings[0] === 36, 'Drop C lowest is C2 (36 ≈ 65.4 Hz)');
    assert(TUNINGS['guitar-7-standard'].strings[0] === 35, '7-string lowest is B1 (35)');
    // Custom tuning infers instrument from lowest MIDI (< 36 → bass).
    const cGuitar = makeCustomTuning([40, 45, 50, 55, 59, 64], 'MyGtr');
    assert(cGuitar.instrument === 'guitar' && cGuitar.id === 'custom', 'makeCustomTuning(guitar range) → guitar/custom');
    const cBass = makeCustomTuning([28, 33, 38, 43]);
    assert(cBass.instrument === 'bass', 'makeCustomTuning(bass range) → bass');
  });
}
