// PURE. Instrument registry — the single data source for the instrument selector,
// default tunings, and custom-tuning classification. No browser APIs. Node-safe.
//
// The DSP profile is NOT stored here: engineModeFor() in app.js still derives
// 'guitar'|'bass' from the lowest string's frequency (< 70 Hz → bass engine), so a
// new instrument needs only a registry row + preset tunings — never a DSP change.

/**
 * @typedef {Object} Instrument
 * @property {string} id              Stable key, also stored on each Tuning.instrument.
 * @property {string} label           Display name for the selector chip.
 * @property {string} defaultTuningId TUNINGS id selected when this instrument is chosen.
 * @property {number} order           Display order (0-based).
 */

/** @type {ReadonlyArray<Instrument>} display order === array order */
export const INSTRUMENTS = Object.freeze([
  Object.freeze({ id: 'guitar',   label: 'Guitar',   defaultTuningId: 'guitar-standard',   order: 0 }),
  Object.freeze({ id: 'bass',     label: 'Bass',     defaultTuningId: 'bass-4-standard',   order: 1 }),
  Object.freeze({ id: 'ukulele',  label: 'Ukulele',  defaultTuningId: 'ukulele-standard',  order: 2 }),
  Object.freeze({ id: 'mandolin', label: 'Mandolin', defaultTuningId: 'mandolin-standard', order: 3 }),
  Object.freeze({ id: 'violin',   label: 'Violin',   defaultTuningId: 'violin-standard',   order: 4 }),
  Object.freeze({ id: 'banjo',    label: 'Banjo',    defaultTuningId: 'banjo-open-g',      order: 5 }),
  Object.freeze({ id: 'baritone', label: 'Baritone', defaultTuningId: 'baritone-standard', order: 6 }),
]);

/**
 * @param {string} id
 * @returns {Instrument|undefined}
 */
export function instrumentById(id) {
  return INSTRUMENTS.find((r) => r.id === id);
}

/**
 * @param {string} id
 * @returns {string} the instrument's default tuning id, or 'guitar-standard' if unknown.
 */
export function defaultTuningIdFor(id) {
  const r = instrumentById(id);
  return r ? r.defaultTuningId : 'guitar-standard';
}
