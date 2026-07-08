// PURE. Tuning data (MIDI source of truth) + lookup helpers. No browser APIs.

/**
 * @typedef {Object} Tuning
 * @property {string} id          e.g. 'guitar-standard'
 * @property {string} name        Display name.
 * @property {'guitar'|'bass'} instrument
 * @property {number[]} strings   MIDI numbers, index 0 = LOWEST-pitched string.
 */

/** @type {Object.<string, Tuning>} frozen, keyed by id (catalogue order = display order) */
export const TUNINGS = Object.freeze({
  'guitar-standard':   { id: 'guitar-standard',   name: 'Standard E',        instrument: 'guitar', strings: [40, 45, 50, 55, 59, 64] },     // E2 A2 D3 G3 B3 E4
  'guitar-drop-d':     { id: 'guitar-drop-d',     name: 'Drop D',            instrument: 'guitar', strings: [38, 45, 50, 55, 59, 64] },     // D2 A2 D3 G3 B3 E4
  'guitar-d-standard': { id: 'guitar-d-standard', name: 'D Standard',        instrument: 'guitar', strings: [38, 43, 48, 53, 57, 62] },     // D2 G2 C3 F3 A3 D4
  'guitar-drop-cs':    { id: 'guitar-drop-cs',    name: 'Drop C#',           instrument: 'guitar', strings: [37, 44, 49, 54, 58, 63] },     // C#2 G#2 C#3 F#3 A#3 D#4
  'guitar-drop-c':     { id: 'guitar-drop-c',     name: 'Drop C',            instrument: 'guitar', strings: [36, 43, 48, 53, 57, 62] },     // C2 G2 C3 F3 A3 D4
  'guitar-eb':         { id: 'guitar-eb',         name: 'Eb Standard',       instrument: 'guitar', strings: [39, 44, 49, 54, 58, 63] },     // Eb2 Ab2 Db3 Gb3 Bb3 Eb4
  'guitar-dadgad':     { id: 'guitar-dadgad',     name: 'DADGAD',            instrument: 'guitar', strings: [38, 45, 50, 55, 57, 62] },     // D2 A2 D3 G3 A3 D4
  'guitar-open-d':     { id: 'guitar-open-d',     name: 'Open D',            instrument: 'guitar', strings: [38, 45, 50, 54, 57, 62] },     // D2 A2 D3 F#3 A3 D4
  'guitar-open-e':     { id: 'guitar-open-e',     name: 'Open E',            instrument: 'guitar', strings: [40, 47, 52, 56, 59, 64] },     // E2 B2 E3 G#3 B3 E4
  'guitar-open-g':     { id: 'guitar-open-g',     name: 'Open G',            instrument: 'guitar', strings: [38, 43, 50, 55, 59, 62] },     // D2 G2 D3 G3 B3 D4
  'guitar-7-standard': { id: 'guitar-7-standard', name: '7-String Standard', instrument: 'guitar', strings: [35, 40, 45, 50, 55, 59, 64] }, // B1 E2 A2 D3 G3 B3 E4
  'bass-4-standard':   { id: 'bass-4-standard',   name: '4-String Standard', instrument: 'bass',   strings: [28, 33, 38, 43] },             // E1 A1 D2 G2
  'bass-4-drop-d':     { id: 'bass-4-drop-d',     name: '4-String Drop D',   instrument: 'bass',   strings: [26, 33, 38, 43] },             // D1 A1 D2 G2
  'bass-5-standard':   { id: 'bass-5-standard',   name: '5-String Standard', instrument: 'bass',   strings: [23, 28, 33, 38, 43] },         // B0 E1 A1 D2 G2
  'bass-6-standard':   { id: 'bass-6-standard',   name: '6-String Standard', instrument: 'bass',   strings: [23, 28, 33, 38, 43, 48] },     // B0 E1 A1 D2 G2 C3
});

/**
 * @param {'guitar'|'bass'} instrument
 * @returns {Tuning[]} in catalogue order
 */
export function tuningsFor(instrument) {
  return Object.values(TUNINGS).filter((t) => t.instrument === instrument);
}

/**
 * @param {number[]} midiArray  arbitrary per-string MIDI numbers, low->high
 * @param {string} [name='Custom']
 * @param {string} [id='custom']            unique id for saved customs (default preserves old behavior)
 * @param {'guitar'|'bass'} [instrument]    overrides the min-midi inference when provided
 * @returns {Tuning}
 */
export function makeCustomTuning(midiArray, name = 'Custom', id = 'custom', instrument) {
  const inst = instrument || (Math.min(...midiArray) < 36 ? 'bass' : 'guitar');
  return {
    id,
    name,
    instrument: inst,
    strings: midiArray.slice(),
  };
}

/**
 * Clamp/validate a per-string MIDI array for a custom tuning.
 * @param {number[]} midiArray
 * @returns {number[]} sanitized (integers, clamped to [A0=21, E5=76], length 1..8)
 */
export function validateTuningStrings(midiArray) {
  const out = [];
  for (let i = 0; i < midiArray.length && out.length < 8; i++) {
    const m = Math.round(midiArray[i]);
    if (Number.isFinite(m)) out.push(Math.min(76, Math.max(21, m)));
  }
  return out.length ? out : [40];
}
