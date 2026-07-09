// BROWSER. Owns all non-dial/non-trail DOM: header, note readout, string
// selector, tuning sheet (+ custom editor), A4, instrument + theme toggles.
// Pure view: callbacks out, update() in. Never touches audio/dsp modules.

import { midiToName, frequencyFromMidi } from '../music/theory.js';
import { tuningsFor } from '../music/tunings.js';

export class Controls {
  /**
   * @param {Document} doc
   * @param {Object} cb
   * @param {() => void} cb.onMicStart
   * @param {(instrument:'guitar'|'bass') => void} cb.onModeChange
   * @param {(tuningId:string) => void} cb.onTuningChange
   * @param {(a4:number) => void} cb.onA4Change
   * @param {(index:number) => void} cb.onStringSelect Tap a string circle: pin/unpin detection to it.
   * @param {() => void} cb.onAuto Header AUTO/PINNED button while the mic is running: unpin.
   * @param {(index:number|null) => void} cb.onToneToggle Speaker button: play (index) or stop (null).
   * @param {(theme:'dark'|'light') => void} cb.onThemeToggle
   * @param {(midiArray:number[], name:string, id:string|null) => void} cb.onCustomSave
   * @param {(id:string) => void} cb.onCustomDelete
   */
  constructor(doc, cb) {
    this.doc = doc;
    this.cb = cb;
    this.$ = (id) => doc.getElementById(id);

    this.app = this.$('app');
    this.stateLabel = this.$('stateLabel');
    this.noteName = this.$('noteName');
    this.noteOct = this.$('noteOct');
    this.noteSub = this.$('noteSub');
    this.autoDot = this.$('autoDot');
    this.autoLabel = this.$('autoLabel');
    this.stringsEl = this.$('strings');
    this.toneBtn = this.$('toneBtn');
    this.tuningName = this.$('tuningName');
    this.overlay = this.$('overlay');
    this.overlayNote = this.$('overlayNote');
    this.sheet = this.$('sheet');
    this.scrim = this.$('sheetScrim');
    this.sheetMain = this.$('sheetMain');
    this.sheetEditor = this.$('sheetEditor');
    this.tuningList = this.$('tuningList');

    this._tuning = null;
    this._a4 = 440;
    this._instrument = 'guitar';
    this._customs = [];
    this._playingIndex = null;
    this._activeIndex = null;
    this._pinnedIndex = null;
    this._micRunning = false;
    this._blankTimer = null;
    this._lastNoteKey = null;

    // custom editor working state
    this._editMidis = [];
    this._editId = null;

    this._wire();
  }

  _wire() {
    const cb = this.cb;
    this.$('startBtn').addEventListener('click', () => cb.onMicStart());
    this.$('autoBtn').addEventListener('click', () => {
      // Mic idle: start it (unchanged). Mic running: this doubles as PINNED→AUTO (unpin).
      if (this._micRunning) cb.onAuto();
      else cb.onMicStart();
    });

    this.toneBtn.addEventListener('click', () => {
      if (this._playingIndex != null) { cb.onToneToggle(null); return; }
      const target = this._pinnedIndex != null ? this._pinnedIndex : this._activeIndex;
      if (target == null) return;
      cb.onToneToggle(target);
    });

    this.$('tuningBtn').addEventListener('click', () => this.openSheet());
    this.$('a4Btn').addEventListener('click', () => this.openSheet());
    this.$('sheetDone').addEventListener('click', () => this.closeSheet());
    this.scrim.addEventListener('click', () => this.closeSheet());

    this.$('instrumentSeg').querySelectorAll('.seg-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const inst = btn.dataset.instrument;
        if (inst === this._instrument) return;
        cb.onModeChange(inst);
      });
    });

    this.$('a4Down').addEventListener('click', () => cb.onA4Change(this._a4 - 1));
    this.$('a4Up').addEventListener('click', () => cb.onA4Change(this._a4 + 1));

    this.$('themeBtn').addEventListener('click', () => {
      const cur = this.doc.documentElement.getAttribute('data-theme') || 'dark';
      cb.onThemeToggle(cur === 'dark' ? 'light' : 'dark');
    });
  }

  /* ---------- note readout (feel pass) ---------- */

  /** @param {import('../dsp/stabilizer.js').DisplayState} ds */
  update(ds) {
    this.app.style.setProperty('--conf', String(ds.confidence != null ? ds.confidence : 1));
    const active = ds.status === 'active' || ds.status === 'hold';
    const blank = !active || ds.noteName == null;

    this.app.classList.toggle('is-blank', blank);
    this.app.classList.toggle('in-tune', active && ds.inTune);

    if (blank) {
      this.noteSub.textContent = 'listening…';
      // keep the last glyph briefly (it fades via .is-blank), then clear to empty
      // — never show a dash placeholder when there's no sound.
      if (this._blankTimer == null && this.noteName.textContent !== '') {
        this._blankTimer = setTimeout(() => {
          this.noteName.innerHTML = '';
          this.noteOct.textContent = '';
          this.stateLabel.textContent = '';
          this._blankTimer = null;
          this._lastNoteKey = null;
        }, 1500);
      }
      this._setActive(null);
      return;
    }

    if (this._blankTimer != null) { clearTimeout(this._blankTimer); this._blankTimer = null; }

    const letter = ds.noteName[0];
    const acc = ds.noteName.length > 1 ? ds.noteName.slice(1) : '';
    this.noteName.innerHTML = acc
      ? `${letter}<span class="note-acc">${acc === '#' ? '♯' : acc}</span>`
      : letter;
    this.noteOct.textContent = ds.octave != null ? String(ds.octave) : '';

    const c = ds.cents;
    let label;
    if (ds.inTune) label = 'IN TUNE';
    else if (Math.abs(c) <= 15) label = c < 0 ? 'ALMOST ♭' : 'ALMOST ♯';
    else label = c < 0 ? 'FLAT ♭' : 'SHARP ♯';
    this.stateLabel.textContent = label;

    const cents = Math.round(c);
    const sign = cents < 0 ? '−' : cents > 0 ? '+' : '';
    const hz = ds.frequency != null ? ds.frequency.toFixed(1) : '–';
    this.noteSub.textContent = `${hz} Hz  ·  ${sign}${Math.abs(cents)} cents`;

    const key = ds.noteName + ds.octave;
    if (key !== this._lastNoteKey) {
      this.noteName.classList.remove('note-swap');
      void this.noteName.offsetWidth; // restart the animation
      this.noteName.classList.add('note-swap');
      this._lastNoteKey = key;
    }

    this._setActive(ds.stringIndex);
  }

  /* ---------- string selector ---------- */

  setTuning(tuning, a4) {
    this._tuning = tuning;
    this._a4 = a4;
    this.tuningName.textContent = tuning.name;
    this.stringsEl.innerHTML = '';
    tuning.strings.forEach((midi, i) => {
      const info = midiToName(midi);
      const btn = this.doc.createElement('button');
      btn.type = 'button';
      btn.className = 'str';
      btn.textContent = info.name[0];
      btn.title = `${info.name}${info.octave} · ${frequencyFromMidi(midi, a4).toFixed(2)} Hz — tap to pin`;
      btn.addEventListener('click', () => {
        this.cb.onStringSelect(i);
      });
      this.stringsEl.appendChild(btn);
    });
    this._setActive(this._activeIndex);
    this._setPlaying(this._playingIndex);
    this._applyPinnedState();
    this._syncToneBtn();
    this._renderTuningList();
  }

  setActiveString(index) { this._setActive(index); }
  _setActive(index) {
    const changed = index !== this._activeIndex;
    this._activeIndex = index;
    const kids = this.stringsEl.children;
    for (let i = 0; i < kids.length; i++) kids[i].classList.toggle('is-active', i === index);
    // Perf: update(ds) drives this every animation frame — only re-sync the tone
    // button's disabled/title state when the active string actually changes.
    if (changed) this._syncToneBtn();
  }

  setTonePlaying(index) { this._setPlaying(index); }
  _setPlaying(index) {
    this._playingIndex = index;
    const kids = this.stringsEl.children;
    for (let i = 0; i < kids.length; i++) kids[i].classList.toggle('is-playing', i === index);
    this.toneBtn.classList.toggle('is-playing', index != null);
    this.toneBtn.setAttribute('aria-pressed', index != null ? 'true' : 'false');
  }

  /* ---------- pin (locked string) ---------- */

  /** @param {number|null} index null = auto (unpinned). */
  setPinned(index) {
    this._pinnedIndex = index != null ? index : null;
    this._applyPinnedState();
    this._syncToneBtn();
  }

  _applyPinnedState() {
    const kids = this.stringsEl.children;
    for (let i = 0; i < kids.length; i++) kids[i].classList.toggle('is-pinned', i === this._pinnedIndex);
    this.autoLabel.textContent = this._pinnedIndex != null ? 'PINNED' : 'AUTO';
  }

  /** Tone button target is the pinned string, else the auto-detected one. */
  _syncToneBtn() {
    const target = this._pinnedIndex != null ? this._pinnedIndex : this._activeIndex;
    this.toneBtn.disabled = target == null;
    if (target != null && this._tuning) {
      const info = midiToName(this._tuning.strings[target]);
      this.toneBtn.title = `Play ${info.name}${info.octave} reference tone`;
    } else {
      this.toneBtn.title = 'Play reference tone';
    }
  }

  /* ---------- tuning list + customs ---------- */

  setCustomTunings(list) {
    this._customs = Array.isArray(list) ? list : [];
    this._renderTuningList();
  }

  _renderTuningList() {
    const doc = this.doc;
    this.tuningList.innerHTML = '';
    const currentId = this._tuning ? this._tuning.id : null;

    const addItem = (t, isCustom) => {
      const item = doc.createElement('div');
      item.className = 'tuning-item' + (t.id === currentId ? ' is-on' : '');
      const notes = t.strings.map((m) => midiToName(m).name).join(' ');
      const pick = doc.createElement('button');
      pick.type = 'button';
      pick.className = 'tuning-pick';
      pick.innerHTML = `<span>${t.name}</span><span class="notes">${notes}</span>`;
      pick.addEventListener('click', () => { this.cb.onTuningChange(t.id); this.closeSheet(); });
      item.appendChild(pick);
      if (isCustom) {
        const del = doc.createElement('button');
        del.type = 'button';
        del.className = 'tuning-del';
        del.textContent = '✕';
        del.title = 'Delete tuning';
        del.addEventListener('click', (e) => { e.stopPropagation(); this.cb.onCustomDelete(t.id); });
        item.appendChild(del);
      }
      this.tuningList.appendChild(item);
    };

    tuningsFor(this._instrument).forEach((t) => addItem(t, false));

    const mine = this._customs.filter((t) => t.instrument === this._instrument);
    if (mine.length) {
      const h = doc.createElement('div');
      h.className = 'tuning-subhead';
      h.textContent = 'Your tunings';
      this.tuningList.appendChild(h);
      mine.forEach((t) => addItem(t, true));
    }

    const add = doc.createElement('button');
    add.type = 'button';
    add.className = 'tuning-add';
    add.textContent = '＋ Custom tuning…';
    add.addEventListener('click', () => this._openEditor());
    this.tuningList.appendChild(add);
  }

  _setInstrumentUI(inst) {
    this._instrument = inst;
    this.$('instrumentSeg').querySelectorAll('.seg-btn').forEach((b) => {
      b.classList.toggle('is-on', b.dataset.instrument === inst);
    });
    this._renderTuningList();
  }
  setInstrument(inst) { this._setInstrumentUI(inst); }

  setA4(a4) {
    this._a4 = a4;
    this.$('a4Val').textContent = String(a4);
    this.$('a4Big').textContent = String(a4);
    if (this._tuning) this.setTuning(this._tuning, a4);
  }

  openSheet() { this.scrim.hidden = false; this.sheet.hidden = false; this._showMain(); }
  closeSheet() { this.scrim.hidden = true; this.sheet.hidden = true; }
  _showMain() { this.sheetMain.hidden = false; this.sheetEditor.hidden = true; }

  /* ---------- custom tuning editor ---------- */

  _openEditor(seed) {
    // seed from the current tuning (so "tweak this preset" is easy)
    this._editMidis = (seed || (this._tuning ? this._tuning.strings.slice() : [40, 45, 50, 55, 59, 64])).slice();
    this._editId = null;
    this.sheetMain.hidden = true;
    this.sheetEditor.hidden = false;
    this._renderEditor();
  }

  _renderEditor() {
    const doc = this.doc;
    const ed = this.sheetEditor;
    ed.innerHTML = '';

    const head = doc.createElement('div');
    head.className = 'editor-head';
    const back = doc.createElement('button');
    back.type = 'button'; back.className = 'editor-back'; back.textContent = '‹ Back';
    back.addEventListener('click', () => this._showMain());
    const title = doc.createElement('span');
    title.className = 'editor-title'; title.textContent = 'Custom tuning';
    head.appendChild(back); head.appendChild(title);
    ed.appendChild(head);

    // string-count segmented control
    const countRow = doc.createElement('div');
    countRow.className = 'seg count-seg';
    [4, 5, 6, 7].forEach((n) => {
      const b = doc.createElement('button');
      b.type = 'button';
      b.className = 'seg-btn' + (this._editMidis.length === n ? ' is-on' : '');
      b.textContent = String(n);
      b.addEventListener('click', () => this._setStringCount(n));
      countRow.appendChild(b);
    });
    ed.appendChild(countRow);

    // per-string rows (low string at top)
    const rows = doc.createElement('div');
    rows.className = 'editor-rows';
    this._editMidis.forEach((midi, i) => {
      const row = doc.createElement('div');
      row.className = 'editor-row';
      const minus = doc.createElement('button');
      minus.type = 'button'; minus.className = 'a4-step'; minus.textContent = '−';
      minus.addEventListener('click', () => this._nudge(i, -1));
      const label = doc.createElement('div');
      label.className = 'editor-note';
      const info = midiToName(midi);
      label.textContent = `${info.name}${info.octave} · ${frequencyFromMidi(midi, this._a4).toFixed(1)} Hz`;
      const plus = doc.createElement('button');
      plus.type = 'button'; plus.className = 'a4-step'; plus.textContent = '+';
      plus.addEventListener('click', () => this._nudge(i, +1));
      row.appendChild(minus); row.appendChild(label); row.appendChild(plus);
      rows.appendChild(row);
    });
    ed.appendChild(rows);

    // name + save/cancel
    const nameWrap = doc.createElement('div');
    nameWrap.className = 'editor-name';
    const input = doc.createElement('input');
    input.type = 'text'; input.maxLength = 24; input.id = 'customName';
    input.placeholder = 'Name'; input.value = `Custom ${this._customs.length + 1}`;
    nameWrap.appendChild(input);
    ed.appendChild(nameWrap);

    const actions = doc.createElement('div');
    actions.className = 'editor-actions';
    const cancel = doc.createElement('button');
    cancel.type = 'button'; cancel.className = 'editor-cancel'; cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => this._showMain());
    const save = doc.createElement('button');
    save.type = 'button'; save.className = 'sheet-done'; save.textContent = 'Save tuning';
    save.addEventListener('click', () => {
      const nm = (input.value || '').trim() || `Custom ${this._customs.length + 1}`;
      this.cb.onCustomSave(this._editMidis.slice(), nm, this._editId);
      this.closeSheet();
    });
    actions.appendChild(cancel); actions.appendChild(save);
    ed.appendChild(actions);
  }

  _setStringCount(n) {
    const cur = this._editMidis;
    if (n === cur.length) return;
    if (n > cur.length) {
      // grow: prepend strings a fourth (5 semitones) below the current lowest
      while (this._editMidis.length < n) {
        this._editMidis.unshift(Math.max(21, this._editMidis[0] - 5));
      }
    } else {
      // shrink from the low side
      this._editMidis = this._editMidis.slice(cur.length - n);
    }
    this._renderEditor();
  }

  _nudge(i, delta) {
    const m = Math.min(76, Math.max(21, this._editMidis[i] + delta));
    this._editMidis[i] = m;
    this._renderEditor();
  }

  /* ---------- mic / status ---------- */

  setMicState(state, message) {
    this._micRunning = state === 'running';
    this.autoDot.classList.toggle('is-idle', state !== 'running');
    if (state === 'running') { this.overlay.classList.add('is-hidden'); return; }
    this.overlay.classList.remove('is-hidden');
    this.overlayNote.classList.toggle('is-error', state === 'denied' || state === 'error');
    if (message) this.overlayNote.textContent = message;
    else if (state === 'requesting') this.overlayNote.textContent = 'Requesting microphone…';
    else if (state === 'denied') this.overlayNote.textContent = 'Microphone blocked. Allow it in your browser and reload.';
  }
}
