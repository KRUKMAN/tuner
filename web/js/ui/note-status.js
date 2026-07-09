// PURE (Node-safe) despite living under ui/ — see Global Constraints / architecture
// invariant §1.2: new pure logic goes in pure, testable modules; browser wrappers
// (controls.js) stay thin. This module turns a DisplayState into human-readable
// text: the short visual state label (with a shape cue, not colour alone) and the
// throttled spoken-note announcement for the aria-live region. No DOM, no timers,
// no Date — timestamps never enter this file.

/** @typedef {import('../dsp/stabilizer.js').DisplayState} DisplayState */

const ALMOST_CENTS = 15; // relocated as-is from controls.js's prior inline literal

/**
 * Pronounce a sharp note name the way a screen reader user expects:
 * 'F#' -> 'F sharp'. Natural note names ('E') pass through unchanged. The DSP
 * only ever emits sharps (see stabilizer.js DisplayState typedef), so flats
 * never reach this function.
 * @param {string} noteName
 * @returns {string}
 */
export function spokenNoteName(noteName) {
  return noteName.length > 1 ? `${noteName[0]} sharp` : noteName;
}

/**
 * Short visual state label shown under the note ("✓ IN TUNE" / "FLAT ♭" / ...).
 * The leading "✓" is a non-colour (shape) redundant cue for the in-tune state —
 * see spec §8 "Redundant (non-colour) in-tune cue" — the accent-colour swap
 * elsewhere (dial ring, string circle) stays, this text is an additional signal.
 * @param {DisplayState} ds
 * @returns {string} '' when there's nothing to show (blank/silent/rejected).
 */
export function stateLabelFor(ds) {
  const active = ds.status === 'active' || ds.status === 'hold';
  if (!active || ds.noteName == null) return '';
  if (ds.inTune) return '✓ IN TUNE';
  const c = ds.cents;
  if (Math.abs(c) <= ALMOST_CENTS) return c < 0 ? 'ALMOST ♭' : 'ALMOST ♯';
  return c < 0 ? 'FLAT ♭' : 'SHARP ♯';
}

/**
 * Throttled spoken-note announcement for the aria-live region. Only returns a
 * fresh announcement when the note (name+octave) or the in-tune state changes —
 * NEVER per animation frame (controls.js#update(ds) runs ~60x/sec via the rAF
 * loop in app.js#loop()). Going blank (mic drops out / signal rejected) clears
 * the tracked key but is itself silent — no "listening…" chatter. The next
 * active reading, even of the identical note, announces again: from a listener's
 * perspective the sound stopped and started over, which is worth saying.
 * @param {DisplayState} ds
 * @param {string|null} prevKey  the `.key` from the last call that returned non-null
 * @returns {{text: string|null, key: string|null} | null} null = nothing changed
 */
export function announcementFor(ds, prevKey) {
  const active = ds.status === 'active' || ds.status === 'hold';
  const key = active && ds.noteName != null
    ? `${ds.noteName}${ds.octave}:${ds.inTune ? 'in' : 'out'}`
    : null;
  if (key === prevKey) return null;
  if (key === null) return { text: null, key: null };

  const spoken = spokenNoteName(ds.noteName);
  const text = ds.inTune
    ? `${spoken}, in tune`
    : `${spoken}, ${Math.abs(Math.round(ds.cents))} cents ${ds.cents < 0 ? 'flat' : 'sharp'}`;
  return { text, key };
}
