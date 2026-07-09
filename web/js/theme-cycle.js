// PURE (Node-safe). The theme cycle order + stepping logic shared by app.js
// (applies the theme) and controls.js (labels the toggle button with what
// tapping it will do next). Three themes: dark (default), light, and contrast
// (spec §8 high-contrast / colour-blind-safe theme) — see css/styles.css's
// [data-theme="contrast"] token block.

export const THEME_ORDER = ['dark', 'light', 'contrast'];

export const THEME_LABEL = { dark: 'dark', light: 'light', contrast: 'high-contrast' };

/**
 * @param {string} current  current theme id; unrecognised values are treated as
 *   though the current theme were 'dark' (so the toggle always has a sane next step).
 * @returns {string} the next theme id in the cycle.
 */
export function nextTheme(current) {
  const i = THEME_ORDER.indexOf(current);
  const base = i === -1 ? 0 : i;
  return THEME_ORDER[(base + 1) % THEME_ORDER.length];
}
