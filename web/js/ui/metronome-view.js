// BROWSER. The metronome's own identity: a horizontal beat-LANE (the tuner owns the
// radial dial) that is at once the meter display, the visualizer, and the editor. A
// playhead sweeps across it, driven from the sample clock via setTransport() — never a
// timer. Block height encodes accent level (colour-blind-safe by shape). The BPM number
// is the hero: tap to type, drag the band to scrub, press-and-hold the steppers to
// ramp. Deep editing (presets, beat count, per-beat subdivision, additive grouping,
// practice, saved meters) lives in a focus-trapped sheet. Pure view: callbacks out,
// setters in; never touches audio/dsp.
import { CONFIG } from '../config.js';
import {
  cycleAccent, makeAdditiveBar, groupsFromBar, groupBoundaries,
  toggleGroupBoundaryAt, meterLabel,
} from '../music/meter.js';
import { nextFocusIndex } from './focus-order.js';

const M = CONFIG.metronome;
const PRESETS = [
  { label: '4/4', groups: [4] },
  { label: '3/4', groups: [3] },
  { label: '2/4', groups: [2] },
  { label: '6/8', groups: [3, 3] },
  { label: '5/8', groups: [3, 2] },
  { label: '7/8', groups: [3, 2, 2] },
];
const ACCENT_CLASS = { accent: 'is-accent', normal: 'is-normal', ghost: 'is-ghost', rest: 'is-rest' };
const SHEET_FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export class MetronomeView {
  /**
   * @param {Document} doc
   * @param {Object} cb
   * @param {() => void} cb.onStartStop
   * @param {(bpm:number) => void} cb.onBpmChange
   * @param {() => void} cb.onTap
   * @param {(bar:Array) => void} cb.onBarChange
   * @param {(bars:number) => void} [cb.onCountInChange]
   * @param {(step:number) => void} [cb.onAccelChange]
   * @param {() => void} [cb.onSaveMeter]
   * @param {(id:number) => void} [cb.onLoadSaved]
   * @param {(id:number) => void} [cb.onDeleteSaved]
   */
  constructor(doc, cb) {
    this.doc = doc;
    this.cb = cb;
    const $ = (id) => doc.getElementById(id);

    this.metView = $('metronomeView');
    this.meterEl = $('metMeter');
    this.barsEl = $('metBars');
    this.bpmInput = $('metBpmInput');
    this.bpmBand = $('metBpmBand');
    this.laneEl = $('metLane');
    this.playhead = $('metPlayhead');
    this.startBtn = $('metStart');
    this.startLabel = this.startBtn.querySelector('.met-start-label');
    this.editBtn = $('metEditBtn');
    this.tapBtn = $('metTap');
    // sheet
    this.sheet = $('metSheet');
    this.scrim = $('metScrim');
    this.presetsEl = $('metPresets');
    this.countEl = $('metCount');
    this.editGridEl = $('metEditGrid');
    this.practiceEl = $('metPractice');
    this.savedEl = $('metSaved');

    this._bpm = M.bpmDefault;
    this._bar = makeAdditiveBar([4]);
    this._blocks = [];
    this._activeBeat = -1;
    this._tapFlashTimer = null;
    this._holdTimer = null;
    this._countIn = M.countInBarsDefault;
    this._accel = M.accelBpmStep;
    this._saved = [];
    this._preOpenFocus = null;

    this._wire();
    this._renderPresets();
    this.setBpm(this._bpm);
    this.setBar(this._bar);
  }

  /* ---------------- BPM ---------------- */

  setBpm(bpm) {
    this._bpm = bpm;
    if (this.doc.activeElement !== this.bpmInput) this.bpmInput.value = String(bpm);
  }

  _emitBpm(bpm) {
    const n = Math.max(M.bpmMin, Math.min(M.bpmMax, Math.round(bpm)));
    if (n === this._bpm && this.bpmInput.value === String(n)) { /* still normalize input */ }
    this.setBpm(n);
    this.cb.onBpmChange(n);
  }

  _wire() {
    const $ = (id) => this.doc.getElementById(id);

    // Steppers with press-and-hold auto-repeat.
    this._holdWire($('metBpmDown'), -1);
    this._holdWire($('metBpmUp'), +1);

    // Tap tempo (+ visible flash so a tap is never silent feedback).
    this.tapBtn.addEventListener('click', () => this.cb.onTap());

    // BPM number: type to set. Keyboard arrows also nudge.
    this.bpmInput.addEventListener('focus', () => this.bpmInput.select());
    this.bpmInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { this.bpmInput.blur(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { this._emitBpm(this._bpm + (e.shiftKey ? 10 : 1)); e.preventDefault(); }
      else if (e.key === 'ArrowDown') { this._emitBpm(this._bpm - (e.shiftKey ? 10 : 1)); e.preventDefault(); }
    });
    this.bpmInput.addEventListener('blur', () => {
      const v = parseInt(this.bpmInput.value, 10);
      if (Number.isFinite(v)) this._emitBpm(v); else this.setBpm(this._bpm);
    });

    // Drag the band to scrub the whole range. A tap (no drag) falls through to focus
    // the input for typing.
    this._dragWire();

    // Transport
    this.startBtn.addEventListener('click', () => this.cb.onStartStop());
    this.editBtn.addEventListener('click', () => this.openSheet());

    // Sheet close paths
    this.scrim.addEventListener('click', () => this.closeSheet());
    $('metSheetDone').addEventListener('click', () => this.closeSheet());
    this._onSheetKeydown = (e) => {
      if (this.sheet.hidden) return;
      if (e.key === 'Escape') { this.closeSheet(); return; }
      if (e.key !== 'Tab') return;
      const els = Array.from(this.sheet.querySelectorAll(SHEET_FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (!els.length) return;
      const cur = els.indexOf(this.doc.activeElement);
      const nxt = nextFocusIndex(els.length, cur, e.shiftKey);
      els[nxt].focus();
      e.preventDefault();
    };
  }

  _holdWire(btn, dir) {
    const start = (e) => {
      e.preventDefault();
      this._emitBpm(this._bpm + dir);
      let n = 0;
      const tick = () => {
        n++;
        this._emitBpm(this._bpm + dir);
        const gap = n >= M.holdAccelAfter ? M.holdFastMs : M.holdRepeatMs;
        this._holdTimer = setTimeout(tick, gap);
      };
      this._holdTimer = setTimeout(tick, M.holdDelayMs);
    };
    const stop = () => { if (this._holdTimer) { clearTimeout(this._holdTimer); this._holdTimer = null; } };
    btn.addEventListener('pointerdown', start);
    btn.addEventListener('pointerup', stop);
    btn.addEventListener('pointerleave', stop);
    btn.addEventListener('pointercancel', stop);
    // Keyboard: the buttons are focusable, so Enter/Space must do a single step. We handle
    // keydown directly (no click listener), so a keyboard-synthesized click fires nothing
    // and there is no double-step with the pointer path.
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        this._emitBpm(this._bpm + dir);
      }
    });
  }

  _dragWire() {
    const band = this.bpmBand;
    let dragging = false, startX = 0, startBpm = 0, pid = null;
    band.addEventListener('pointerdown', (e) => {
      if (e.target === this.bpmInput) return;   // let a tap on the number focus it
      dragging = false; startX = e.clientX; startBpm = this._bpm; pid = e.pointerId;
      band.setPointerCapture(pid);
    });
    band.addEventListener('pointermove', (e) => {
      if (pid == null) return;
      const dx = e.clientX - startX;
      if (!dragging && Math.abs(dx) < 4) return;
      dragging = true;
      this._emitBpm(startBpm + dx / M.dragPxPerBpm);
    });
    const end = (e) => {
      if (pid == null) return;
      try { band.releasePointerCapture(pid); } catch (_) { /* ignore */ }
      pid = null;
      if (!dragging && e.target !== this.bpmInput) { this.bpmInput.focus(); }
    };
    band.addEventListener('pointerup', end);
    band.addEventListener('pointercancel', end);
  }

  flashTap() {
    this.tapBtn.classList.add('is-flash');
    if (this._tapFlashTimer) clearTimeout(this._tapFlashTimer);
    this._tapFlashTimer = setTimeout(() => this.tapBtn.classList.remove('is-flash'), 110);
  }

  /* ---------------- meter / lane ---------------- */

  setBar(bar) {
    this._bar = Array.isArray(bar) && bar.length ? bar.map((b) => ({ ...b })) : makeAdditiveBar([4]);
    this.meterEl.textContent = meterLabel(this._bar);
    this._renderLane();
    if (!this.sheet.hidden) this._renderSheetBody();
  }

  _emitBar() { this.cb.onBarChange(this._bar.map((b) => ({ ...b }))); }

  _renderLane() {
    const doc = this.doc;
    // wipe blocks but keep the playhead node
    Array.from(this.laneEl.querySelectorAll('.met-block')).forEach((n) => n.remove());
    this._blocks = [];
    const bounds = new Set(groupBoundaries(this._bar));
    const hMax = M.laneHeightMax;

    this._bar.forEach((beat, i) => {
      const block = doc.createElement('button');
      block.type = 'button';
      block.className = 'met-block ' + (ACCENT_CLASS[beat.accent] || 'is-normal');
      const isDownbeat = i === 0 || bounds.has(i);
      if (isDownbeat) block.classList.add('is-downbeat');
      block.style.height = Math.round(hMax * (M.accentHeightFrac[beat.accent] ?? 0.62)) + 'px';
      block.setAttribute('aria-label', `Beat ${i + 1}: ${beat.accent}. Tap to change its accent.`);

      if (beat.subdivision > 1) {
        const ticks = doc.createElement('span');
        ticks.className = 'met-subticks';
        for (let k = 0; k < beat.subdivision; k++) ticks.appendChild(doc.createElement('i'));
        block.appendChild(ticks);
      }
      const num = doc.createElement('span');
      num.className = 'met-block-num';
      num.textContent = String(i + 1);
      block.appendChild(num);

      block.addEventListener('click', () => {
        this._bar[i].accent = cycleAccent(this._bar[i].accent);
        this.setBar(this._bar);
        this._emitBar();
      });
      this.laneEl.appendChild(block);
      this._blocks.push(block);
    });
  }

  setRunning(on) {
    this.startLabel.textContent = on ? 'Stop' : 'Start';
    this.startBtn.classList.toggle('is-on', !!on);
    this.startBtn.setAttribute('aria-pressed', String(!!on));
    this.laneEl.classList.toggle('is-running', !!on);
    if (!on) {
      this.playhead.style.transform = 'translateX(0)';
      this.barsEl.textContent = '';
      this._setActiveBeat(-1);
    }
  }

  /**
   * Drive the visualization from the sample clock. Called every rAF from app.js with
   * the transport snapshot; NEVER from a timer.
   * @param {number} phase 0..1 through the current bar
   * @param {number} beatIndex integer beat the playhead is on
   * @param {number} barCount measures since start
   */
  setTransport(phase, beatIndex, barCount) {
    const w = this.laneEl.clientWidth;
    this.playhead.style.transform = `translateX(${Math.max(0, Math.min(w, phase * w))}px)`;
    // The counter label only changes on a beat boundary — don't rebuild the string and
    // rewrite the text node ~60x/sec; only when the beat actually advances.
    if (beatIndex !== this._activeBeat) {
      this._setActiveBeat(beatIndex);
      const total = this._bar.length || 1;
      this.barsEl.textContent = `bar ${barCount + 1} · beat ${((beatIndex % total) + 1)}`;
    }
  }

  /** Discrete per-beat brighten (also the reduced-motion cue). @param {number} index */
  _setActiveBeat(index) {
    if (this._blocks[this._activeBeat]) this._blocks[this._activeBeat].classList.remove('is-hit');
    this._activeBeat = index;
    if (this._blocks[index]) this._blocks[index].classList.add('is-hit');
  }

  /* ---------------- sheet ---------------- */

  openSheet() {
    this._preOpenFocus = this.doc.activeElement;
    this._renderSheetBody();
    this.scrim.hidden = false;
    this.sheet.hidden = false;
    this.editBtn.setAttribute('aria-expanded', 'true');
    this.doc.addEventListener('keydown', this._onSheetKeydown);
    const first = this.sheet.querySelector(SHEET_FOCUSABLE);
    if (first) first.focus();
  }

  closeSheet() {
    this.scrim.hidden = true;
    this.sheet.hidden = true;
    this.editBtn.setAttribute('aria-expanded', 'false');
    this.doc.removeEventListener('keydown', this._onSheetKeydown);
    if (this._preOpenFocus && this._preOpenFocus.focus) this._preOpenFocus.focus();
  }

  setSavedMeters(list) { this._saved = Array.isArray(list) ? list : []; if (!this.sheet.hidden) this._renderSaved(); }

  _renderPresets() {
    const doc = this.doc;
    this.presetsEl.innerHTML = '';
    PRESETS.forEach((p) => {
      const chip = doc.createElement('button');
      chip.type = 'button';
      chip.className = 'met-chip';
      chip.textContent = p.label;
      chip.addEventListener('click', () => {
        this._bar = makeAdditiveBar(p.groups);
        this.setBar(this._bar);
        this._emitBar();
      });
      this.presetsEl.appendChild(chip);
    });
  }

  _renderSheetBody() {
    this._markActivePreset();
    this._renderCount();
    this._renderEditGrid();
    this._renderPractice();
    this._renderSaved();
  }

  _markActivePreset() {
    const cur = groupsFromBar(this._bar).join(',');
    Array.from(this.presetsEl.children).forEach((chip, i) => {
      chip.classList.toggle('is-on', PRESETS[i].groups.join(',') === cur);
    });
  }

  _renderCount() {
    const doc = this.doc;
    this.countEl.innerHTML = '';
    const minus = doc.createElement('button');
    minus.type = 'button'; minus.className = 'met-step'; minus.textContent = '−';
    minus.setAttribute('aria-label', 'Fewer beats');
    minus.addEventListener('click', () => this._setBeatCount(this._bar.length - 1));
    const label = doc.createElement('span');
    label.className = 'met-count-label';
    label.textContent = `${this._bar.length} beats`;
    const plus = doc.createElement('button');
    plus.type = 'button'; plus.className = 'met-step'; plus.textContent = '+';
    plus.setAttribute('aria-label', 'More beats');
    plus.addEventListener('click', () => this._setBeatCount(this._bar.length + 1));
    this.countEl.append(minus, label, plus);
  }

  _renderEditGrid() {
    const doc = this.doc;
    this.editGridEl.innerHTML = '';
    const bounds = new Set(groupBoundaries(this._bar));
    this._bar.forEach((beat, i) => {
      const cell = doc.createElement('div');
      cell.className = 'met-editcell';

      const block = doc.createElement('button');
      block.type = 'button';
      block.className = 'met-editblock ' + (ACCENT_CLASS[beat.accent] || 'is-normal');
      block.textContent = String(i + 1);
      block.setAttribute('aria-label', `Beat ${i + 1}: ${beat.accent}. Tap to cycle accent.`);
      block.addEventListener('click', () => {
        this._bar[i].accent = cycleAccent(this._bar[i].accent);
        this.setBar(this._bar);
        this._emitBar();
      });

      const sub = doc.createElement('button');
      sub.type = 'button';
      sub.className = 'met-subbtn';
      sub.textContent = '×' + (beat.subdivision || 1);
      sub.setAttribute('aria-label', `Beat ${i + 1} subdivision ×${beat.subdivision || 1}. Tap to cycle.`);
      sub.addEventListener('click', () => {
        const subs = M.subdivisions;
        const idx = subs.indexOf(beat.subdivision || 1);
        this._bar[i].subdivision = subs[(idx + 1) % subs.length];
        this.setBar(this._bar);
        this._emitBar();
      });

      cell.append(block, sub);

      // group-boundary toggle (keyboard-accessible additive grouping). Beat 0 always
      // starts group 0, so it has no toggle.
      if (i > 0) {
        const grp = doc.createElement('button');
        grp.type = 'button';
        grp.className = 'met-subbtn met-grp' + (bounds.has(i) ? ' is-on' : '');
        grp.textContent = bounds.has(i) ? '⊣ group' : '· group';
        grp.setAttribute('aria-pressed', String(bounds.has(i)));
        grp.setAttribute('aria-label', `Beat ${i + 1} ${bounds.has(i) ? 'starts a new group. Tap to merge.' : 'is inside its group. Tap to start a new group here.'}`);
        grp.addEventListener('click', () => {
          this._bar = toggleGroupBoundaryAt(this._bar, i);
          this.setBar(this._bar);
          this._emitBar();
        });
        cell.append(grp);
      }
      this.editGridEl.appendChild(cell);
    });
  }

  _setBeatCount(n) {
    n = Math.max(M.beatCountMin, Math.min(M.beatCountMax, n));
    if (n === this._bar.length) return;
    if (n > this._bar.length) {
      while (this._bar.length < n) this._bar.push({ accent: 'normal', subdivision: 1, group: this._bar[this._bar.length - 1].group ?? 0 });
    } else {
      this._bar = this._bar.slice(0, n);
    }
    this.setBar(this._bar);
    this._emitBar();
  }

  _renderPractice() {
    const doc = this.doc;
    this.practiceEl.innerHTML = '';
    const row = (labelText, control) => {
      const r = doc.createElement('div');
      r.className = 'met-practice-row';
      const l = doc.createElement('span'); l.textContent = labelText; l.className = 'met-count-label'; l.style.minWidth = '0';
      r.append(l, control);
      return r;
    };
    // count-in: 0 / 1 / 2 bars
    const ci = doc.createElement('div'); ci.className = 'met-presets';
    [0, 1, 2].forEach((b) => {
      const chip = doc.createElement('button');
      chip.type = 'button'; chip.className = 'met-chip' + (this._countIn === b ? ' is-on' : '');
      chip.textContent = b === 0 ? 'off' : `${b} bar${b > 1 ? 's' : ''}`;
      chip.setAttribute('aria-pressed', String(this._countIn === b));
      chip.addEventListener('click', () => { this._countIn = b; this._renderPractice(); this.cb.onCountInChange && this.cb.onCountInChange(b); });
      ci.appendChild(chip);
    });
    // auto-accelerate: off / +2 / +5 bpm every N bars
    const ac = doc.createElement('div'); ac.className = 'met-presets';
    [0, 2, 5].forEach((s) => {
      const chip = doc.createElement('button');
      chip.type = 'button'; chip.className = 'met-chip' + (this._accel === s ? ' is-on' : '');
      chip.textContent = s === 0 ? 'off' : `+${s}/${M.accelEveryBars} bars`;
      chip.setAttribute('aria-pressed', String(this._accel === s));
      chip.addEventListener('click', () => { this._accel = s; this._renderPractice(); this.cb.onAccelChange && this.cb.onAccelChange(s); });
      ac.appendChild(chip);
    });
    this.practiceEl.append(row('Count-in', ci), row('Accelerate', ac));
  }

  _renderSaved() {
    const doc = this.doc;
    this.savedEl.innerHTML = '';
    const save = doc.createElement('button');
    save.type = 'button'; save.className = 'met-chip'; save.textContent = '＋ Save this meter';
    save.addEventListener('click', () => this.cb.onSaveMeter && this.cb.onSaveMeter());
    this.savedEl.appendChild(save);
    if (!this._saved.length) {
      const empty = doc.createElement('div'); empty.className = 'met-saved-empty'; empty.textContent = 'No saved meters yet.';
      this.savedEl.appendChild(empty);
      return;
    }
    this._saved.forEach((m, id) => {
      const r = doc.createElement('div'); r.className = 'met-practice-row';
      const pick = doc.createElement('button');
      pick.type = 'button'; pick.className = 'met-chip'; pick.style.flex = '1';
      pick.textContent = m.label || meterLabel(m.bar);
      pick.addEventListener('click', () => this.cb.onLoadSaved && this.cb.onLoadSaved(id));
      const del = doc.createElement('button');
      del.type = 'button'; del.className = 'met-subbtn'; del.textContent = '✕';
      del.setAttribute('aria-label', `Delete saved meter ${m.label || ''}`);
      del.addEventListener('click', () => this.cb.onDeleteSaved && this.cb.onDeleteSaved(id));
      r.append(pick, del);
      this.savedEl.appendChild(r);
    });
  }

  /** @returns {{countIn:number, accel:number}} current practice settings */
  getPractice() { return { countIn: this._countIn, accel: this._accel }; }
}
