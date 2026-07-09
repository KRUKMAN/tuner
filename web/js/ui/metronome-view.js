// BROWSER. Two-tier metronome view: a zero-config face (BPM, tap, start/stop, beat
// pills) and a one-tap editor (presets, beat count, per-pill accent + subdivision).
// Pure view: callbacks out, setters in. Never touches audio/dsp.
import { CONFIG } from '../config.js';
import { cycleAccent, makeAdditiveBar } from '../music/meter.js';

// Editor presets → additive group sizes fed to makeAdditiveBar.
const PRESETS = [
  { label: '4/4', groups: [4] },
  { label: '3/4', groups: [3] },
  { label: '6/8', groups: [3, 3] },
  { label: '5/8', groups: [3, 2] },
  { label: '7/8', groups: [3, 2, 2] },
];
const ACCENT_CLASS = { accent: 'is-accent', normal: 'is-normal', ghost: 'is-ghost', rest: 'is-rest' };

export class MetronomeView {
  /**
   * @param {Document} doc
   * @param {Object} cb
   * @param {() => void} cb.onStartStop
   * @param {(bpm:number) => void} cb.onBpmChange
   * @param {() => void} cb.onTap
   * @param {(bar:Array) => void} cb.onBarChange  emitted whenever the meter is edited
   */
  constructor(doc, cb) {
    this.doc = doc;
    this.cb = cb;
    const $ = (id) => doc.getElementById(id);
    this.bpmEl = $('metBpm');
    this.pillsEl = $('metPills');
    this.editorEl = $('metEditor');
    this.startBtn = $('metStart');
    this.editBtn = $('metEditBtn');

    this._bpm = CONFIG.metronome.bpmDefault;
    this._bar = makeAdditiveBar([4]);
    this._editorOpen = false;

    $('metBpmDown').addEventListener('click', () => this._nudgeBpm(-1));
    $('metBpmUp').addEventListener('click', () => this._nudgeBpm(+1));
    $('metTap').addEventListener('click', () => this.cb.onTap());
    this.startBtn.addEventListener('click', () => this.cb.onStartStop());
    this.editBtn.addEventListener('click', () => this._toggleEditor());

    this.setBpm(this._bpm);
    this.setBar(this._bar);
  }

  /** @param {number} bpm */
  setBpm(bpm) {
    this._bpm = bpm;
    this.bpmEl.textContent = String(bpm);
  }

  /** @param {Array} bar */
  setBar(bar) {
    this._bar = Array.isArray(bar) && bar.length ? bar : makeAdditiveBar([4]);
    this._renderPills();
    if (this._editorOpen) this._renderEditor();
  }

  /** @param {boolean} on */
  setRunning(on) {
    this.startBtn.textContent = on ? 'Stop' : 'Start';
    this.startBtn.classList.toggle('is-on', !!on);
    if (!on) this.highlightBeat(-1);
  }

  /** Light the active beat pill; called from app.js's beat rAF. @param {number} index */
  highlightBeat(index) {
    const kids = this.pillsEl.children;
    for (let i = 0; i < kids.length; i++) kids[i].classList.toggle('is-active', i === index);
  }

  _nudgeBpm(delta) {
    const { bpmMin, bpmMax } = CONFIG.metronome;
    const next = Math.max(bpmMin, Math.min(bpmMax, this._bpm + delta));
    this.setBpm(next);
    this.cb.onBpmChange(next);
  }

  _emitBar() { this.cb.onBarChange(this._bar.map((b) => ({ ...b }))); }

  _renderPills() {
    const doc = this.doc;
    this.pillsEl.innerHTML = '';
    this._bar.forEach((beat) => {
      const pill = doc.createElement('span');
      pill.className = 'met-pill ' + (ACCENT_CLASS[beat.accent] || 'is-normal');
      if (beat.subdivision > 1) pill.dataset.sub = String(beat.subdivision);
      this.pillsEl.appendChild(pill);
    });
  }

  _toggleEditor() {
    this._editorOpen = !this._editorOpen;
    this.editorEl.hidden = !this._editorOpen;
    this.editBtn.classList.toggle('is-on', this._editorOpen);
    if (this._editorOpen) this._renderEditor();
  }

  _renderEditor() {
    const doc = this.doc;
    const ed = this.editorEl;
    ed.innerHTML = '';

    // preset chips
    const presetRow = doc.createElement('div');
    presetRow.className = 'met-presets';
    PRESETS.forEach((p) => {
      const chip = doc.createElement('button');
      chip.type = 'button';
      chip.className = 'met-chip';
      chip.textContent = p.label;
      chip.addEventListener('click', () => {
        this._bar = makeAdditiveBar(p.groups);
        this._renderPills();
        this._renderEditor();
        this._emitBar();
      });
      presetRow.appendChild(chip);
    });
    ed.appendChild(presetRow);

    // beat-count stepper
    const countRow = doc.createElement('div');
    countRow.className = 'met-count';
    const minus = doc.createElement('button');
    minus.type = 'button'; minus.className = 'met-step'; minus.textContent = '−';
    minus.addEventListener('click', () => this._setBeatCount(this._bar.length - 1));
    const label = doc.createElement('span');
    label.className = 'met-count-label';
    label.textContent = `${this._bar.length} beats`;
    const plus = doc.createElement('button');
    plus.type = 'button'; plus.className = 'met-step'; plus.textContent = '+';
    plus.addEventListener('click', () => this._setBeatCount(this._bar.length + 1));
    countRow.appendChild(minus); countRow.appendChild(label); countRow.appendChild(plus);
    ed.appendChild(countRow);

    // editable pills: tap the pill cycles accent; the ×N button cycles subdivision
    const editPills = doc.createElement('div');
    editPills.className = 'met-editpills';
    this._bar.forEach((beat, i) => {
      const cell = doc.createElement('div');
      cell.className = 'met-editcell';

      const pill = doc.createElement('button');
      pill.type = 'button';
      pill.className = 'met-pill met-editpill ' + (ACCENT_CLASS[beat.accent] || 'is-normal');
      pill.textContent = String(i + 1);
      pill.title = 'Tap to cycle accent';
      pill.addEventListener('click', () => {
        beat.accent = cycleAccent(beat.accent);
        this._renderPills();
        this._renderEditor();
        this._emitBar();
      });

      const sub = doc.createElement('button');
      sub.type = 'button';
      sub.className = 'met-subbtn';
      sub.textContent = '×' + (beat.subdivision || 1);
      sub.title = 'Tap to cycle subdivision';
      sub.addEventListener('click', () => {
        const subs = CONFIG.metronome.subdivisions;
        const idx = subs.indexOf(beat.subdivision || 1);
        beat.subdivision = subs[(idx + 1) % subs.length];
        this._renderPills();
        this._renderEditor();
        this._emitBar();
      });

      cell.appendChild(pill); cell.appendChild(sub);
      editPills.appendChild(cell);
    });
    ed.appendChild(editPills);
  }

  _setBeatCount(n) {
    const { beatCountMin, beatCountMax } = CONFIG.metronome;
    n = Math.max(beatCountMin, Math.min(beatCountMax, n));
    if (n === this._bar.length) return;
    if (n > this._bar.length) {
      while (this._bar.length < n) this._bar.push({ accent: 'normal', subdivision: 1, group: 0 });
    } else {
      this._bar = this._bar.slice(0, n);
    }
    this._renderPills();
    this._renderEditor();
    this._emitBar();
  }
}
