// BROWSER. Owns all non-dial/non-trail DOM: header, note readout, string
// selector, tuning sheet (+ custom editor), A4, instrument + theme toggles.
// Pure view: callbacks out, update() in. Never touches audio/dsp modules.

import { midiToName, frequencyFromMidi } from '../music/theory.js';
import { tuningsFor } from '../music/tunings.js';
import { INSTRUMENTS } from '../music/instruments.js';
import { stateLabelFor, announcementFor } from './note-status.js';
import { nextFocusIndex } from './focus-order.js';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export class Controls {
  /**
   * @param {Document} doc
   * @param {Object} cb
   * @param {() => void} cb.onMicStart
   * @param {(instrument:string) => void} cb.onModeChange
   * @param {(tuningId:string) => void} cb.onTuningChange
   * @param {(a4:number) => void} cb.onA4Change
   * @param {(index:number) => void} cb.onStringSelect Tap a string circle: pin/unpin detection to it.
   * @param {() => void} cb.onAuto Header AUTO/PINNED button while the mic is running: unpin.
   * @param {(index:number|null) => void} cb.onToneToggle Speaker button: play (index) or stop (null).
   * @param {(theme:'dark'|'light') => void} cb.onThemeToggle
   * @param {(mode:'dial'|'strobe') => void} cb.onDisplayModeChange
   * @param {(on:boolean) => void} cb.onHapticToggle
   * @param {(on:boolean) => void} cb.onChimeToggle
   * @param {(midiArray:number[], name:string, id:string|null, instrument:string) => void} cb.onCustomSave
   * @param {(id:string) => void} cb.onCustomDelete
   * @param {() => void} cb.onRetry Retry button on the mic error/disconnected overlay.
   */
  constructor(doc, cb) {
    this.doc = doc;
    this.cb = cb;
    this.$ = (id) => doc.getElementById(id);

    this.app = this.$('app');
    this.liveRegion = this.$('liveRegion');
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
    this.overlayStatus = this.$('overlayStatus');
    this.retryBtn = this.$('retryBtn');
    this.sheet = this.$('sheet');
    this.scrim = this.$('sheetScrim');
    this.sheetMain = this.$('sheetMain');
    this.sheetEditor = this.$('sheetEditor');
    this.tuningList = this.$('tuningList');
    this.displaySeg = this.$('displaySeg');
    this.dialWrap = this.$('dialWrap');
    this.hapticSeg = this.$('hapticSeg');
    this.chimeSeg = this.$('chimeSeg');

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
    this._announceKey = null;
    this._preOpenFocus = null;

    // custom editor working state
    this._editMidis = [];
    this._editId = null;

    this._onSheetKeydown = (e) => {
      if (this.sheet.hidden) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        this.closeSheet();
        return;
      }
      if (e.key !== 'Tab') return;
      const els = this._getFocusable();
      const current = els.indexOf(this.doc.activeElement);
      const next = nextFocusIndex(els.length, current, e.shiftKey);
      if (next === -1) return; // nothing focusable — let the browser do its default thing
      e.preventDefault();
      els[next].focus();
    };

    this._renderInstruments();
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
    this.retryBtn.addEventListener('click', () => cb.onRetry());

    this.$('a4Down').addEventListener('click', () => cb.onA4Change(this._a4 - 1));
    this.$('a4Up').addEventListener('click', () => cb.onA4Change(this._a4 + 1));

    this.$('themeBtn').addEventListener('click', () => {
      const cur = this.doc.documentElement.getAttribute('data-theme') || 'dark';
      cb.onThemeToggle(cur === 'dark' ? 'light' : 'dark');
    });

    this.displaySeg.querySelectorAll('.seg-btn').forEach((btn) => {
      btn.addEventListener('click', () => cb.onDisplayModeChange(btn.dataset.display));
    });
    this.hapticSeg.querySelectorAll('.seg-btn').forEach((btn) => {
      btn.addEventListener('click', () => cb.onHapticToggle(btn.dataset.on === '1'));
    });
    this.chimeSeg.querySelectorAll('.seg-btn').forEach((btn) => {
      btn.addEventListener('click', () => cb.onChimeToggle(btn.dataset.on === '1'));
    });
  }

  /* ---------- note readout (feel pass) ---------- */

  /** @param {import('../dsp/stabilizer.js').DisplayState} ds */
  update(ds) {
    this.app.style.setProperty('--conf', String(ds.confidence != null ? ds.confidence : 1));

    const ann = announcementFor(ds, this._announceKey);
    if (ann) {
      this._announceKey = ann.key;
      if (ann.text) {
        // Clear-then-set (forcing a reflow in between) so a screen reader
        // re-announces even when the new text is byte-identical to what's
        // already in the region (e.g. the same note resumes after a brief
        // silence) — some ATs only fire on an observed DOM mutation, not on
        // textContent merely being assigned the same string. Mirrors the
        // existing note-swap restart idiom below (`void ...offsetWidth`).
        this.liveRegion.textContent = '';
        void this.liveRegion.offsetWidth;
        this.liveRegion.textContent = ann.text;
      }
    }

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

    this.stateLabel.textContent = stateLabelFor(ds);

    const cents = Math.round(ds.cents);
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
        const edit = doc.createElement('button');
        edit.type = 'button';
        edit.className = 'tuning-edit';
        edit.textContent = '✎';
        edit.title = 'Edit tuning';
        edit.addEventListener('click', (e) => { e.stopPropagation(); this._openEditor(t.strings.slice(), t.id, t.name); });
        item.appendChild(edit);
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

  /** Build the instrument selector chips from the registry (horizontally scrollable). */
  _renderInstruments() {
    const seg = this.$('instrumentSeg');
    seg.innerHTML = '';
    INSTRUMENTS.forEach((inst) => {
      const b = this.doc.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (inst.id === this._instrument ? ' is-on' : '');
      b.dataset.instrument = inst.id;
      b.textContent = inst.label;
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', inst.id === this._instrument ? 'true' : 'false');
      b.addEventListener('click', () => {
        if (inst.id === this._instrument) return;
        this.cb.onModeChange(inst.id);
      });
      seg.appendChild(b);
    });
  }

  _setInstrumentUI(inst) {
    this._instrument = inst;
    const seg = this.$('instrumentSeg');
    let active = null;
    seg.querySelectorAll('.chip').forEach((b) => {
      const on = b.dataset.instrument === inst;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      if (on) active = b;
    });
    // Keep the active chip visible on a narrow phone: centre it within the scroll row.
    if (active) seg.scrollLeft = active.offsetLeft - (seg.clientWidth - active.clientWidth) / 2;
    this._renderTuningList();
  }
  setInstrument(inst) { this._setInstrumentUI(inst); }

  /** @param {'dial'|'strobe'} mode */
  setDisplayModeUI(mode) {
    this.displaySeg.querySelectorAll('.seg-btn').forEach((b) => {
      b.classList.toggle('is-on', b.dataset.display === mode);
    });
  }

  /** @param {boolean} on */
  setHaptic(on) {
    this.hapticSeg.querySelectorAll('.seg-btn').forEach((b) => {
      b.classList.toggle('is-on', (b.dataset.on === '1') === !!on);
    });
  }

  /** @param {boolean} on */
  setChime(on) {
    this.chimeSeg.querySelectorAll('.seg-btn').forEach((b) => {
      b.classList.toggle('is-on', (b.dataset.on === '1') === !!on);
    });
  }

  /** One-shot visual "snap" on the in-tune false->true edge; reuses the tonepulse keyframe. */
  pulseInTune() {
    this.dialWrap.classList.remove('in-tune-snap');
    void this.dialWrap.offsetWidth; // restart the animation
    this.dialWrap.classList.add('in-tune-snap');
  }

  setA4(a4) {
    this._a4 = a4;
    this.$('a4Val').textContent = String(a4);
    this.$('a4Big').textContent = String(a4);
    if (this._tuning) this.setTuning(this._tuning, a4);
  }

  /** The sheet panel currently shown: main list or the custom-tuning editor. */
  _activePanel() {
    return this.sheetEditor.hidden ? this.sheetMain : this.sheetEditor;
  }

  /** Focusable elements in the CURRENTLY VISIBLE panel, re-queried every call so
   *  it stays correct after the tuning list / editor rows re-render. */
  _getFocusable() {
    return Array.from(this._activePanel().querySelectorAll(FOCUSABLE_SELECTOR))
      .filter((el) => !el.closest('[hidden]'));
  }

  _focusFirstInPanel() {
    const els = this._getFocusable();
    if (els.length) els[0].focus();
    else this.sheet.focus(); // fallback: the sheet itself (tabindex="-1")
  }

  openSheet() {
    this._preOpenFocus = this.doc.activeElement;
    this.scrim.hidden = false;
    this.sheet.hidden = false;
    this._showMain();
    this.doc.addEventListener('keydown', this._onSheetKeydown);
  }

  closeSheet() {
    this.scrim.hidden = true;
    this.sheet.hidden = true;
    this.doc.removeEventListener('keydown', this._onSheetKeydown);
    const trigger = this._preOpenFocus;
    this._preOpenFocus = null;
    if (trigger && this.doc.contains(trigger) && typeof trigger.focus === 'function') {
      trigger.focus();
    }
  }

  _showMain() {
    this.sheetMain.hidden = false;
    this.sheetEditor.hidden = true;
    this._focusFirstInPanel();
  }

  /* ---------- custom tuning editor ---------- */

  _openEditor(seed, id, name) {
    // seed from the passed strings (edit / tweak-preset), else the current tuning.
    this._editMidis = (seed || (this._tuning ? this._tuning.strings.slice() : [40, 45, 50, 55, 59, 64])).slice();
    this._editId = id || null;               // set → Save upserts the existing custom (edit-in-place)
    this._editSeedName = name || null;
    this.sheetMain.hidden = true;
    this.sheetEditor.hidden = false;
    this._buildEditor();
    this._focusFirstInPanel();
  }

  /** Build the editor shell ONCE. Only the string rows re-render on edits, so the
   *  name <input> keeps its value/focus (fixes the "typed name lost on nudge" bug). */
  _buildEditor() {
    const doc = this.doc;
    const ed = this.sheetEditor;
    ed.innerHTML = '';

    const head = doc.createElement('div');
    head.className = 'editor-head';
    const back = doc.createElement('button');
    back.type = 'button'; back.className = 'editor-back'; back.textContent = '‹ Back';
    back.addEventListener('click', () => this._showMain());
    const title = doc.createElement('span');
    title.className = 'editor-title';
    title.textContent = this._editId ? 'Edit tuning' : 'Custom tuning';
    head.appendChild(back); head.appendChild(title);
    ed.appendChild(head);

    // string-count stepper (1–8)
    const countRow = doc.createElement('div');
    countRow.className = 'editor-count-row';
    this._countMinus = doc.createElement('button');
    this._countMinus.type = 'button'; this._countMinus.className = 'a4-step'; this._countMinus.textContent = '−';
    this._countMinus.addEventListener('click', () => this._stepCount(-1));
    this._countLabel = doc.createElement('span');
    this._countLabel.className = 'editor-count';
    this._countPlus = doc.createElement('button');
    this._countPlus.type = 'button'; this._countPlus.className = 'a4-step'; this._countPlus.textContent = '+';
    this._countPlus.addEventListener('click', () => this._stepCount(+1));
    countRow.appendChild(this._countMinus);
    countRow.appendChild(this._countLabel);
    countRow.appendChild(this._countPlus);
    ed.appendChild(countRow);

    // per-string rows (rebuilt by _renderRows on count change)
    this._elRows = doc.createElement('div');
    this._elRows.className = 'editor-rows';
    ed.appendChild(this._elRows);

    // name — lives OUTSIDE the re-rendered rows, so it survives every edit
    const nameWrap = doc.createElement('div');
    nameWrap.className = 'editor-name';
    this._nameInput = doc.createElement('input');
    this._nameInput.type = 'text'; this._nameInput.maxLength = 24; this._nameInput.id = 'customName';
    this._nameInput.placeholder = 'Name';
    this._nameInput.value = this._editSeedName || `Custom ${this._customs.length + 1}`;
    nameWrap.appendChild(this._nameInput);
    ed.appendChild(nameWrap);

    const actions = doc.createElement('div');
    actions.className = 'editor-actions';
    const cancel = doc.createElement('button');
    cancel.type = 'button'; cancel.className = 'editor-cancel'; cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => this._showMain());
    const save = doc.createElement('button');
    save.type = 'button'; save.className = 'sheet-done'; save.textContent = 'Save tuning';
    save.addEventListener('click', () => {
      const nm = (this._nameInput.value || '').trim() || `Custom ${this._customs.length + 1}`;
      this.cb.onCustomSave(this._editMidis.slice(), nm, this._editId, this._instrument);
      this.closeSheet();
    });
    actions.appendChild(cancel); actions.appendChild(save);
    ed.appendChild(actions);

    this._renderRows();
  }

  /** Rebuild only the string rows (called when the string count changes). */
  _renderRows() {
    const doc = this.doc;
    this._elRows.innerHTML = '';
    this._editMidis.forEach((midi, i) => {
      const row = doc.createElement('div');
      row.className = 'editor-row';

      const minus = doc.createElement('button');
      minus.type = 'button'; minus.className = 'a4-step'; minus.textContent = '−';
      minus.addEventListener('click', () => this._nudge(i, -1));

      const noteSel = doc.createElement('select');
      noteSel.className = 'editor-pick editor-note-sel';
      for (let pc = 0; pc < 12; pc++) {
        const o = doc.createElement('option');
        o.value = String(pc); o.textContent = midiToName(pc).name;   // C, C#, D, … B
        noteSel.appendChild(o);
      }
      noteSel.addEventListener('change', () => this._setFromPickers(i));

      const octSel = doc.createElement('select');
      octSel.className = 'editor-pick editor-oct-sel';
      for (let oct = 0; oct <= 5; oct++) {                            // A0..E5 span octaves 0..5
        const o = doc.createElement('option');
        o.value = String(oct); o.textContent = String(oct);
        octSel.appendChild(o);
      }
      octSel.addEventListener('change', () => this._setFromPickers(i));

      const hz = doc.createElement('span');
      hz.className = 'editor-hz';

      const plus = doc.createElement('button');
      plus.type = 'button'; plus.className = 'a4-step'; plus.textContent = '+';
      plus.addEventListener('click', () => this._nudge(i, +1));

      row.appendChild(minus);
      row.appendChild(noteSel);
      row.appendChild(octSel);
      row.appendChild(hz);
      row.appendChild(plus);
      this._elRows.appendChild(row);
      this._updateRow(i);
    });
    this._updateCountUI();
  }

  /** Sync one row's pickers + Hz label to _editMidis[i] in place (preserves focus). */
  _updateRow(i) {
    const row = this._elRows.children[i];
    if (!row) return;
    const midi = this._editMidis[i];
    row.querySelector('.editor-note-sel').value = String(((midi % 12) + 12) % 12);
    row.querySelector('.editor-oct-sel').value = String(Math.floor(midi / 12) - 1);
    const info = midiToName(midi);
    row.querySelector('.editor-hz').textContent =
      `${info.name}${info.octave} · ${frequencyFromMidi(midi, this._a4).toFixed(1)} Hz`;
  }

  _updateCountUI() {
    const n = this._editMidis.length;
    this._countLabel.textContent = n === 1 ? '1 string' : `${n} strings`;
    this._countMinus.disabled = n <= 1;
    this._countPlus.disabled = n >= 8;
  }

  _stepCount(delta) {
    this._setStringCount(Math.min(8, Math.max(1, this._editMidis.length + delta)));
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
      // shrink from the low side (keep the highest n)
      this._editMidis = this._editMidis.slice(cur.length - n);
    }
    this._renderRows();
  }

  _setFromPickers(i) {
    const row = this._elRows.children[i];
    if (!row) return;
    const pc = parseInt(row.querySelector('.editor-note-sel').value, 10);
    const oct = parseInt(row.querySelector('.editor-oct-sel').value, 10);
    this._editMidis[i] = Math.min(76, Math.max(21, (oct + 1) * 12 + pc));
    this._updateRow(i);
  }

  _nudge(i, delta) {
    this._editMidis[i] = Math.min(76, Math.max(21, this._editMidis[i] + delta));
    this._updateRow(i);
  }

  /* ---------- mic / status ---------- */

  setMicState(state, message) {
    this._micRunning = state === 'running';
    this.autoDot.classList.toggle('is-idle', state !== 'running');
    if (state === 'running') {
      this.overlay.classList.add('is-hidden');
      this.overlayStatus.hidden = true;
      this.retryBtn.hidden = true;
      return;
    }
    this.overlay.classList.remove('is-hidden');
    const isError = state === 'denied' || state === 'notfound' || state === 'error' || state === 'disconnected';
    this.overlayStatus.classList.toggle('is-error', isError);
    this.retryBtn.hidden = !isError;
    if (message) {
      this.overlayStatus.textContent = message;
      this.overlayStatus.hidden = false;
    } else if (state === 'requesting') {
      this.overlayStatus.textContent = 'Requesting microphone…';
      this.overlayStatus.hidden = false;
    } else {
      this.overlayStatus.hidden = true;
    }
  }
}
