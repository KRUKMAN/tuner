// PURE. freq<->MIDI<->name<->cents math. No browser APIs. Node-safe.

/**
 * @typedef {Object} NoteInfo
 * @property {number} midi     Nearest MIDI note number.
 * @property {string} name     'C','C#','D',...,'B' (sharps only).
 * @property {number} octave   Scientific pitch notation (MIDI 69 = A4).
 * @property {number} cents    Signed offset of freq from that note, in cents.
 * @property {number} refFreq  Exact Hz of the nearest note at this a4.
 */

/** Sharps-only note names, index 0 === MIDI pitch class 0 (C). */
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/**
 * @param {number} midi
 * @param {number} [a4=440]
 * @returns {number} Hz = a4 * 2^((midi-69)/12)
 */
export function frequencyFromMidi(midi, a4 = 440) {
  return a4 * Math.pow(2, (midi - 69) / 12);
}

/**
 * @param {number} f
 * @param {number} fRef
 * @returns {number} 1200 * log2(f / fRef)
 */
export function centsBetween(f, fRef) {
  return 1200 * Math.log2(f / fRef);
}

/**
 * @param {number} midi
 * @returns {{name: string, octave: number}} sharps only, octave = floor(midi/12)-1
 */
export function midiToName(midi) {
  const pc = ((midi % 12) + 12) % 12;
  return {
    name: NOTE_NAMES[pc],
    octave: Math.floor(midi / 12) - 1,
  };
}

/**
 * @param {number} freq Hz > 0
 * @param {number} [a4=440]
 * @returns {NoteInfo}
 */
export function noteFromFrequency(freq, a4 = 440) {
  const midi = Math.round(69 + 12 * Math.log2(freq / a4));
  const { name, octave } = midiToName(midi);
  const refFreq = frequencyFromMidi(midi, a4);
  const cents = 1200 * Math.log2(freq / refFreq);
  return { midi, name, octave, cents, refFreq };
}

/**
 * Auto string select: string whose pitch is nearest in |cents| to freq.
 * @param {number} freq Hz
 * @param {number[]} midiArray tuning strings, index 0 = lowest
 * @param {number} [a4=440]
 * @returns {{index: number, midi: number, cents: number}}
 */
export function nearestString(freq, midiArray, a4 = 440) {
  let bestIndex = -1;
  let bestMidi = -1;
  let bestCents = 0;
  let bestAbs = Infinity;
  for (let i = 0; i < midiArray.length; i++) {
    const midi = midiArray[i];
    const cents = centsBetween(freq, frequencyFromMidi(midi, a4));
    const abs = Math.abs(cents);
    if (abs < bestAbs) {
      bestAbs = abs;
      bestIndex = i;
      bestMidi = midi;
      bestCents = cents;
    }
  }
  return { index: bestIndex, midi: bestMidi, cents: bestCents };
}
