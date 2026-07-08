// Canvas renderer for a scrolling cents-vs-time pitch trail.
// Acts as the full-bleed background behind the note.
// Reads a TrailBuffer (from ../dsp/trail.js):
//   forEach(nowMs, (tMs, cents, confidence, inTune) => {})

export class Graph {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {Object} [opts]
   * @param {number} [opts.rangeCents=50]  vertical full scale = +/-50c
   * @param {number} [opts.windowMs=5000]  horizontal time window
   * @param {number} [opts.inTuneCents=5]  green band half-height
   */
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.range = opts.rangeCents ?? 50;
    this.windowMs = opts.windowMs ?? 5000;
    this.inTuneCents = opts.inTuneCents ?? 5;
    this.w = 0;   // CSS px logical width
    this.h = 0;   // CSS px logical height
    this._colors = { accent: '#4cc2f2', accentIn: '#34d399', grid: '#556' };
    this.resize();
  }

  /** @param {{accent:string, accentIn:string, grid:string}} colors */
  setColors(colors) {
    this._colors = {
      accent: colors.accent ?? this._colors.accent,
      accentIn: colors.accentIn ?? this._colors.accentIn,
      grid: colors.grid ?? this._colors.grid,
    };
  }

  resize() {
    // DPR-aware; clamp min width 320, min height 160.
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(320, Math.round(rect.width || this.canvas.clientWidth || 320));
    const h = Math.max(160, Math.round(rect.height || this.canvas.clientHeight || 160));
    this.w = w;
    this.h = h;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    // Draw in CSS px; DPR handled by transform.
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  _x(tMs, nowMs) {
    return this.w * (1 - (nowMs - tMs) / this.windowMs);
  }

  _y(cents) {
    const c = Math.max(-this.range, Math.min(this.range, cents));
    return this.h / 2 - (c / this.range) * (this.h / 2 - 6);
  }

  /**
   * @param {import('../dsp/trail.js').TrailBuffer} trail
   * @param {number} nowMs  performance.now()
   */
  render(trail, nowMs) {
    const ctx = this.ctx;
    const w = this.w, h = this.h;
    const { accent, accentIn, grid } = this._colors;

    // Clear each frame.
    ctx.clearRect(0, 0, w, h);

    // --- Static layers ---
    // In-tune band.
    const yTop = this._y(this.inTuneCents);
    const yBot = this._y(-this.inTuneCents);
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = accentIn;
    ctx.fillRect(0, yTop, w, yBot - yTop);
    // Band edge lines.
    ctx.globalAlpha = 0.18;
    ctx.strokeStyle = accentIn;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, yTop + 0.5); ctx.lineTo(w, yTop + 0.5);
    ctx.moveTo(0, yBot - 0.5); ctx.lineTo(w, yBot - 0.5);
    ctx.stroke();

    // Zero line.
    const yZero = this._y(0);
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, Math.round(yZero) + 0.5);
    ctx.lineTo(w, Math.round(yZero) + 0.5);
    ctx.stroke();

    // --- Trail (segment-by-segment) ---
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';

    let havePrev = false;
    let pt = 0, pc = 0, pconf = 0, pin = false; // previous sample fields
    let headX = 0, headY = 0, headConf = 0, headIn = false, haveHead = false;

    trail.forEach(nowMs, (tMs, cents, confidence, inTune) => {
      const isNaNc = Number.isNaN(cents);

      if (havePrev && !isNaNc && !Number.isNaN(pc) && (tMs - pt) <= 150) {
        const xPrev = this._x(pt, nowMs);
        const yPrev = this._y(pc);
        const xNew = this._x(tMs, nowMs);
        const yNew = this._y(cents);
        // Use the NEWER sample's fields.
        const segAlpha = (0.15 + 0.85 * (xNew / w)) * confidence;
        ctx.globalAlpha = Math.max(0, segAlpha);
        ctx.strokeStyle = inTune ? accentIn : accent;
        ctx.beginPath();
        ctx.moveTo(xPrev, yPrev);
        ctx.lineTo(xNew, yNew);
        ctx.stroke();
      }

      // Track newest non-NaN sample for head dot.
      if (!isNaNc) {
        headX = this._x(tMs, nowMs);
        headY = this._y(cents);
        headConf = confidence;
        headIn = inTune;
        haveHead = true;
      }

      havePrev = true;
      pt = tMs; pc = cents; pconf = confidence; pin = inTune;
    });

    // --- Head dot ---
    if (haveHead) {
      ctx.globalAlpha = Math.max(0.25, headConf);
      ctx.fillStyle = headIn ? accentIn : accent;
      if (headIn) {
        ctx.shadowBlur = 12;
        ctx.shadowColor = accentIn;
      }
      ctx.beginPath();
      ctx.arc(headX, headY, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.shadowColor = 'transparent';
    }

    ctx.globalAlpha = 1;
  }
}
