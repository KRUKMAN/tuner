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

export class Strobe {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {Object} [opts]
   * @param {number} [opts.stripeCount]
   */
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.stripeCount = opts.stripeCount ?? CONFIG.strobeStripeCount;
    this.w = 0;
    this.h = 0;
    this._phase = 0;       // px, wrapped to one stripe-pair spacing
    this._lastMs = null;
    this._colors = { accent: '#4cc2f2', accentIn: '#34d399' };
    this.resize();
  }

  /** @param {{accent:string, accentIn:string}} colors */
  setColors(colors) {
    this._colors = {
      accent: colors.accent ?? this._colors.accent,
      accentIn: colors.accentIn ?? this._colors.accentIn,
    };
  }

  /**
   * Resets the phase clock. Call before showing the strobe again after it was
   * hidden, so a stale elapsed-time gap doesn't produce one large phase jump.
   */
  reset() {
    this._phase = 0;
    this._lastMs = null;
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    const size = Math.max(1, Math.round(rect.width || this.canvas.clientWidth || 1));
    this.w = size;
    this.h = size;
    this.canvas.width = Math.round(size * dpr);
    this.canvas.height = Math.round(size * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /**
   * @param {import('../dsp/stabilizer.js').DisplayState} ds
   * @param {number} nowMs  performance.now()
   */
  render(ds, nowMs) {
    const active = ds.status === 'active' || ds.status === 'hold';
    const dtSec = this._lastMs == null ? 0 : Math.max(0, (nowMs - this._lastMs) / 1000);
    this._lastMs = nowMs;

    const spacing = this.w / this.stripeCount;
    if (active && ds.cents != null && spacing > 0) {
      const delta = strobePhaseDelta(ds.cents, dtSec);
      this._phase = ((this._phase + delta) % spacing + spacing) % spacing;
    }

    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    if (!active) return;

    const bandH = this.h * CONFIG.strobeBandHeightFrac;
    const bandY = (this.h - bandH) / 2;
    ctx.fillStyle = ds.inTune ? this._colors.accentIn : this._colors.accent;
    for (let x = -spacing + this._phase; x < this.w + spacing; x += spacing) {
      ctx.fillRect(x, bandY, spacing / 2, bandH);
    }
  }
}
