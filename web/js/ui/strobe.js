// js/ui/strobe.js
// The pure helper (strobePhaseDelta) is Node-safe: this file has no top-level
// window/document/AudioContext access, so it is directly importable from Node
// tests. The browser-only Strobe canvas renderer is appended to this file in
// a later step of this plan.
//
// Strobe display: an alternative to the cents dial — a horizontal band of
// repeating stripes whose phase accumulates at a rate proportional to
// DisplayState.cents: drifts left when flat, right when sharp, and is frozen
// (zero velocity) whenever the reading is within the SAME |cents| <=
// CONFIG.inTuneCents dead-band that DisplayState.inTune itself uses — so the
// strobe visually locks at exactly the moment the rest of the UI calls the
// note "in tune". Consumes DisplayState + an injected timestamp only; no DSP
// change.

import { CONFIG } from '../config.js';

/**
 * Pure phase-accumulation step for one frame.
 * @param {number|null} cents  DisplayState.cents (may be null when blank)
 * @param {number} dtSec       elapsed seconds since the previous frame (>= 0)
 * @returns {number} signed phase delta in px contributed by this frame; 0
 *   when cents is null/non-finite, dtSec is not a positive finite number, or
 *   |cents| <= CONFIG.inTuneCents (frozen).
 */
export function strobePhaseDelta(cents, dtSec) {
  if (cents == null || !Number.isFinite(cents)) return 0;
  if (!Number.isFinite(dtSec) || dtSec <= 0) return 0;
  if (Math.abs(cents) <= CONFIG.inTuneCents) return 0;
  return cents * CONFIG.strobeVelocityScale * dtSec;
}
