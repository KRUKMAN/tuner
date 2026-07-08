// Minimalist cents dial that rings the note.
// Manipulates an existing inline SVG (id="dial") with known child ids.
// Geometry: viewBox 0 0 300 300, center (150,150), track radius R=132,
// 270 deg sweep with the gap at the BOTTOM, 0 cents at 12 o'clock,
// flat(-) sweeps left, sharp(+) sweeps right.
// Angle map: deg(cents) = (clamp(cents,-50,50)/50)*135.
// Polar (deg clockwise from top): x = 150 + r*sin(deg*PI/180), y = 150 - r*cos(deg*PI/180).

const SVG_NS = 'http://www.w3.org/2000/svg';

export class Dial {
  /**
   * @param {SVGSVGElement} svg  the #dial element
   * @param {Object} [opts]
   * @param {number} [opts.rangeCents=50]
   * @param {number} [opts.sweepDeg=270]
   */
  constructor(svg, opts = {}) {
    this.range = opts.rangeCents ?? 50;
    this.sweep = opts.sweepDeg ?? 270;
    this.half = this.sweep / 2;                 // 135
    this.ind = svg.querySelector('#dialIndicator');
    this.prog = svg.querySelector('#dialProgress');
    this._buildTicks(svg.querySelector('#dialTicks'));
  }

  _deg(c) { return (Math.max(-this.range, Math.min(this.range, c)) / this.range) * this.half; }

  _pt(c, r) { const a = this._deg(c) * Math.PI / 180; return [150 + r * Math.sin(a), 150 - r * Math.cos(a)]; }

  _buildTicks(g) {
    // 11 ticks at cents -50..+50 step 10. Normal: inner r=122, outer r=130.
    // Long ticks at 0 and +/-50: inner r=116, outer r=134, add class 'lng'.
    if (!g) return;
    for (let c = -this.range; c <= this.range; c += 10) {
      const long = c === -this.range || c === 0 || c === this.range;
      const inner = long ? 116 : 122;
      const outer = long ? 134 : 130;
      const [x1, y1] = this._pt(c, inner);
      const [x2, y2] = this._pt(c, outer);
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('x1', x1);
      line.setAttribute('y1', y1);
      line.setAttribute('x2', x2);
      line.setAttribute('y2', y2);
      if (long) line.classList.add('lng');
      g.appendChild(line);
    }
  }

  _arc(endCents) {
    const [x0, y0] = this._pt(0, 132), [x1, y1] = this._pt(endCents, 132);
    const sweepFlag = endCents >= 0 ? 1 : 0;
    return `M ${x0} ${y0} A 132 132 0 0 ${sweepFlag} ${x1} ${y1}`;
  }

  /** @param {import('../dsp/stabilizer.js').DisplayState} ds */
  render(ds) {
    const active = ds.status === 'active' || ds.status === 'hold';
    if (!active || ds.cents == null) {
      const [x, y] = this._pt(0, 132);
      this.ind.setAttribute('cx', x); this.ind.setAttribute('cy', y);
      this.prog.setAttribute('d', '');
      return;
    }
    const [x, y] = this._pt(ds.cents, 132);
    this.ind.setAttribute('cx', x); this.ind.setAttribute('cy', y);
    this.prog.setAttribute('d', this._arc(ds.cents));
  }
}
