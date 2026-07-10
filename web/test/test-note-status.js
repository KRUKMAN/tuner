// Node. Cases for js/ui/note-status.js — the pure DisplayState -> text formatter
// shared by the visual state label and the throttled spoken-note announcement.
import { suite, assert } from './assert.js';
import { spokenNoteName, stateLabelFor, announcementFor, steadyRound } from '../js/ui/note-status.js';

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

  suite('steadyRound: the integer readout does not churn on a drifting value', () => {
    const DB = 0.4;
    assert(steadyRound(3.2, null, DB) === 3, 'first value rounds normally');
    assert(steadyRound(3.4, 3, DB) === 3, 'same integer stays');
    // Crossing the .5 midpoint is NOT enough on its own — that is exactly what flickered.
    assert(steadyRound(3.6, 3, DB) === 3, 'just past the midpoint holds the old integer');
    assert(steadyRound(3.85, 3, DB) === 3, 'still holds at 0.85 away');
    assert(steadyRound(3.95, 3, DB) === 4, 'switches once it clears 0.5 + deadband');
    assert(steadyRound(2.05, 3, DB) === 2, 'switches downward symmetrically');
    assert(steadyRound(-0.95, 0, DB) === -1, 'works across zero');

    // A value dithering around a boundary must not toggle the display at all.
    let shown = steadyRound(2.5, null, DB);
    let changes = 0;
    for (const v of [2.45, 2.55, 2.48, 2.52, 2.47, 2.53]) {
      const next = steadyRound(v, shown, DB);
      if (next !== shown) changes++;
      shown = next;
    }
    assert(changes === 0, `dithering across a .5 boundary never re-renders (got ${changes} changes)`);

    // But a genuine drift must still be followed, not frozen forever.
    shown = steadyRound(0, null, DB);
    for (const v of [1, 2, 3, 4, 5]) shown = steadyRound(v, shown, DB);
    assert(shown === 5, `a real 5-cent drift is followed (got ${shown})`);
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

  suite('stateLabelFor: ALMOST band boundary is inclusive at exactly +/-15 cents', () => {
    assert(stateLabelFor(ds({ inTune: false, cents: -15 })) === 'ALMOST ♭', 'cents === -15 (boundary) -> ALMOST ♭, <=15 is inclusive');
    assert(stateLabelFor(ds({ inTune: false, cents: 15 })) === 'ALMOST ♯', 'cents === 15 (boundary) -> ALMOST ♯, <=15 is inclusive');
    assert(stateLabelFor(ds({ inTune: false, cents: -15.01 })) === 'FLAT ♭', 'cents just past -15 -> FLAT ♭ (outside the inclusive boundary)');
    assert(stateLabelFor(ds({ inTune: false, cents: 15.01 })) === 'SHARP ♯', 'cents just past 15 -> SHARP ♯ (outside the inclusive boundary)');
  });

  suite('announcementFor: octave is included in the spoken text (E2 vs E4 must not sound alike)', () => {
    const low = announcementFor(ds({ noteName: 'E', octave: 2, inTune: true, cents: 0 }), null);
    assert(low && low.text === 'E 2, in tune', 'low E (E2) announces its octave');

    const high = announcementFor(ds({ noteName: 'E', octave: 4, inTune: true, cents: 0 }), null);
    assert(high && high.text === 'E 4, in tune', 'high E (E4) announces its octave');

    assert(low.text !== high.text, 'E2 and E4 must announce different text (octave disambiguates a 6-string guitar\'s two E strings)');
    assert(low.key !== high.key, 'E2 and E4 also produce different throttle keys');

    const sharp = announcementFor(ds({ noteName: 'F#', octave: 4, inTune: false, cents: -8 }), null);
    assert(sharp && sharp.text === 'F sharp 4, 8 cents flat', "sharp note pronounced 'F sharp'; octave follows it; flat cents phrased");
  });

  suite('announcementFor: throttled to note/band changes, never per-frame', () => {
    let key = null;

    const a1 = announcementFor(ds({ status: 'silent', noteName: null }), key);
    assert(a1 === null, 'silent on first call -> no announcement');

    const a2 = announcementFor(ds({ noteName: 'E', octave: 4, inTune: true, cents: 1 }), key);
    assert(a2 && a2.text === 'E 4, in tune', 'first active in-tune reading announces');
    key = a2.key;

    const a3 = announcementFor(ds({ noteName: 'E', octave: 4, inTune: true, cents: 2 }), key);
    assert(a3 === null, 'same note+band next frame -> no re-announcement (throttled)');

    const a4 = announcementFor(ds({ noteName: 'F#', octave: 4, inTune: false, cents: -8 }), key);
    assert(a4 && a4.text === 'F sharp 4, 8 cents flat', "sharp note pronounced 'F sharp'; flat cents phrased");
    key = a4.key;

    const a5 = announcementFor(ds({ noteName: 'F#', octave: 4, inTune: true, cents: 0 }), key);
    assert(a5 && a5.text === 'F sharp 4, in tune', 'in-tune transition on the SAME note re-announces (band changed)');
    key = a5.key;

    const a6 = announcementFor(ds({ status: 'rejected', noteName: null }), key);
    assert(a6 && a6.text === null && a6.key === null, 'going blank clears the key but announces nothing');
    key = a6.key;

    const a7 = announcementFor(ds({ status: 'rejected', noteName: null }), key);
    assert(a7 === null, 'staying blank -> no repeat "nothing" announcements');

    const a8 = announcementFor(ds({ noteName: 'F#', octave: 4, inTune: true, cents: 0 }), key);
    assert(a8 && a8.text === 'F sharp 4, in tune', 'sound resuming re-announces even the same note (it stopped and restarted)');
  });

  suite('announcementFor: coarse cents band is folded into the throttle key (re-announces on a band crossing while tuning)', () => {
    let key = null;

    const b1 = announcementFor(ds({ noteName: 'A', octave: 2, inTune: false, cents: -40 }), key);
    assert(b1 && b1.text === 'A 2, 40 cents flat', 'starting FLAT (|cents|>15) announces');
    key = b1.key;

    const b2 = announcementFor(ds({ noteName: 'A', octave: 2, inTune: false, cents: -35 }), key);
    assert(b2 === null, 'moving within the FLAT band (still |cents|>15) -> no re-announcement');

    const b3 = announcementFor(ds({ noteName: 'A', octave: 2, inTune: false, cents: -10 }), key);
    assert(b3 && b3.text === 'A 2, 10 cents flat', 'crossing FLAT -> ALMOST re-announces even though the note itself never changed');
    key = b3.key;

    const b4 = announcementFor(ds({ noteName: 'A', octave: 2, inTune: false, cents: -6 }), key);
    assert(b4 === null, 'moving within the ALMOST band (still |cents|<=15) -> no re-announcement');

    const b5 = announcementFor(ds({ noteName: 'A', octave: 2, inTune: true, cents: 0 }), key);
    assert(b5 && b5.text === 'A 2, in tune', 'crossing ALMOST -> in-tune re-announces (the snap-in cue)');
  });

  suite('announcementFor: cents rounded to whole numbers', () => {
    const a = announcementFor(ds({ noteName: 'A', octave: 2, inTune: false, cents: 23.6 }), null);
    assert(a.text === 'A 2, 24 cents sharp', 'cents rounded to nearest whole number');
  });
}
