// BROWSER (not Node-tested — a trivial one-line matchMedia wrapper; browser-only
// API, and too small to be worth a fake-DOM test given this repo's no-jsdom
// constraint). Single source of truth for "should this frame skip decorative
// motion", used by anything JS-driven that CSS media queries can't gate — namely
// canvas rendering loops (D's strobe display; the pitch trail already reflects
// live data, not decoration, so it is intentionally NOT gated by this).

/** @returns {boolean} true if the user has requested reduced motion. */
export function prefersReducedMotion() {
  try {
    return !!(globalThis.matchMedia && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch {
    return false;
  }
}
