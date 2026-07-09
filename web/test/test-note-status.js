// Node. Cases for js/ui/note-status.js — the pure DisplayState -> text formatter
// shared by the visual state label and the throttled spoken-note announcement.
import { suite, assert } from './assert.js';
import { spokenNoteName, stateLabelFor, announcementFor } from '../js/ui/note-status.js';

function ds(overrides) {
  return {
    status: 'active', noteName: 'E', octave: 4, midi: 64, cents: 0, frequency: 329.63,
    inTune: true, stringIndex: 0, targetMidi: 64, confidence: 1,
    noiseFloorDb: -70, rawFrequency: 329.63, clarity: 0.95, rmsDb: -30,
    ...overrides,
  };
}

export default function run() {
  suite('spokenNoteName: sharp pronunciation', () => {
    assert(spokenNoteName('E') === 'E', "natural note passes through");
    assert(spokenNoteName('F#') === 'F sharp', "'F#' -> 'F sharp'");
    assert(spokenNoteName('C#') === 'C sharp', "'C#' -> 'C sharp'");
  });

  suite('stateLabelFor: blank states', () => {
    assert(stateLabelFor(ds({ status: 'silent', noteName: null })) === '', 'silent -> empty');
    assert(stateLabelFor(ds({ status: 'rejected', noteName: null })) === '', 'rejected -> empty');
  });

  suite('stateLabelFor: in-tune carries a non-colour (checkmark) cue', () => {
    assert(stateLabelFor(ds({ inTune: true, cents: 2 })) === '✓ IN TUNE', 'in tune -> checkmark label');
    assert(stateLabelFor(ds({ status: 'hold', inTune: true, cents: 0 })) === '✓ IN TUNE', 'hold+in-tune same as active');
  });

  suite('stateLabelFor: almost / flat / sharp thresholds', () => {
    assert(stateLabelFor(ds({ inTune: false, cents: -10 })) === 'ALMOST ♭', '|cents|<=15 flat -> ALMOST ♭');
    assert(stateLabelFor(ds({ inTune: false, cents: 12 })) === 'ALMOST ♯', '|cents|<=15 sharp -> ALMOST ♯');
    assert(stateLabelFor(ds({ inTune: false, cents: -30 })) === 'FLAT ♭', '|cents|>15 flat -> FLAT ♭');
    assert(stateLabelFor(ds({ inTune: false, cents: 40 })) === 'SHARP ♯', '|cents|>15 sharp -> SHARP ♯');
  });

  suite('announcementFor: throttled to note/in-tune changes, never per-frame', () => {
    let key = null;

    const a1 = announcementFor(ds({ status: 'silent', noteName: null }), key);
    assert(a1 === null, 'silent on first call -> no announcement');

    const a2 = announcementFor(ds({ noteName: 'E', octave: 4, inTune: true, cents: 1 }), key);
    assert(a2 && a2.text === 'E, in tune', 'first active in-tune reading announces');
    key = a2.key;

    const a3 = announcementFor(ds({ noteName: 'E', octave: 4, inTune: true, cents: 2 }), key);
    assert(a3 === null, 'same note+state next frame -> no re-announcement (throttled)');

    const a4 = announcementFor(ds({ noteName: 'F#', octave: 4, inTune: false, cents: -8 }), key);
    assert(a4 && a4.text === 'F sharp, 8 cents flat', "sharp note pronounced 'F sharp'; flat cents phrased");
    key = a4.key;

    const a5 = announcementFor(ds({ noteName: 'F#', octave: 4, inTune: true, cents: 0 }), key);
    assert(a5 && a5.text === 'F sharp, in tune', 'in-tune transition on the SAME note re-announces');
    key = a5.key;

    const a6 = announcementFor(ds({ status: 'rejected', noteName: null }), key);
    assert(a6 && a6.text === null && a6.key === null, 'going blank clears the key but announces nothing');
    key = a6.key;

    const a7 = announcementFor(ds({ status: 'rejected', noteName: null }), key);
    assert(a7 === null, 'staying blank -> no repeat "nothing" announcements');

    const a8 = announcementFor(ds({ noteName: 'F#', octave: 4, inTune: true, cents: 0 }), key);
    assert(a8 && a8.text === 'F sharp, in tune', 'sound resuming re-announces even the same note (it stopped and restarted)');
  });

  suite('announcementFor: cents rounded to whole numbers', () => {
    const a = announcementFor(ds({ noteName: 'A', octave: 2, inTune: false, cents: 23.6 }), null);
    assert(a.text === 'A, 24 cents sharp', 'cents rounded to nearest whole number');
  });
}
