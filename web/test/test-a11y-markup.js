// Node. Static text guard: confirms the accessibility hooks this package adds are
// present in the shipped markup/source. NOT a behavior test — it cannot exercise
// focus movement, aria-live announcements, or keyboard events (no jsdom in this
// repo; see Global Constraints). Real behavior is verified manually per-task.
//
// Accessibility fix pass (Package F): the instrument segment previously shipped
// role="tablist" + per-chip role="tab"/aria-selected (Package B), but that pattern
// was incomplete — no tabpanel relationship, no arrow-key navigation, no roving
// tabindex — so AT announced "tab, 1 of 7" while Left/Right did nothing. It was
// dropped to role="group" (accessible name) + aria-pressed per chip, which
// honestly describes what the controls do; this guard checks for that pattern.
import { suite, assert } from './assert.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..');

export default function run() {
  const html = readFileSync(join(WEB, 'index.html'), 'utf8');
  const controlsJs = readFileSync(join(WEB, 'js/ui/controls.js'), 'utf8');
  const metViewJs = readFileSync(join(WEB, 'js/ui/metronome-view.js'), 'utf8');
  const cssText = readFileSync(join(WEB, 'css/styles.css'), 'utf8');
  const appJs = readFileSync(join(WEB, 'js/app.js'), 'utf8');

  suite('a11y markup: spoken-note live region exists', () => {
    assert(html.includes('id="liveRegion"'), 'index.html declares #liveRegion');
    assert(html.includes('aria-live="polite"'), '#liveRegion is aria-live="polite"');
    assert(html.includes('class="sr-only"'), '#liveRegion is visually hidden via .sr-only');
  });

  suite('a11y markup: sheet is a labelled, focus-manageable dialog', () => {
    assert(html.includes('role="dialog"'), '.sheet has role="dialog"');
    assert(html.includes('aria-modal="true"'), '.sheet has aria-modal="true"');
    assert(html.includes('tabindex="-1"'), '.sheet has a tabindex="-1" fallback trap-focus target');
    assert(html.includes('sheet-handle" aria-hidden="true"'), 'decorative .sheet-handle is aria-hidden');
  });

  suite('a11y markup: existing toggle-like controls expose pressed state', () => {
    assert(controlsJs.includes("setAttribute('aria-pressed'"), 'controls.js sets aria-pressed on toggle-like controls');
    assert(controlsJs.includes("setAttribute('aria-label'"), 'controls.js sets aria-label on dynamically-created controls');
  });

  suite('a11y markup: instrument segment is a labelled group of pressed-state chips', () => {
    assert(html.includes('id="instrumentSeg" role="group" aria-label="Instrument"'),
      '#instrumentSeg has role="group" aria-label="Instrument" (not role="tablist" — see file header)');
    assert(!controlsJs.includes("setAttribute('role', 'tab')"), 'instrument chips no longer carry role="tab"');
    assert(!html.includes('role="tablist"'), 'no role="tablist" remains anywhere in the shipped markup');
  });

  suite('a11y markup: string circles carry pin state + label', () => {
    assert(controlsJs.includes('tap to pin pitch detection to this string'),
      'string circles get a descriptive aria-label');
    assert(controlsJs.includes('Automatic string detection is on'),
      'AUTO/PINNED header button gets a descriptive aria-label');
  });

  suite('a11y markup: reference-tone button is labelled', () => {
    assert(html.includes('id="toneBtn"') && html.includes('aria-label="Play reference tone"'),
      '#toneBtn has a static initial aria-label');
    assert(controlsJs.includes('this.toneBtn.setAttribute(\'aria-label\''),
      'controls.js keeps #toneBtn aria-label in sync with its target string');
  });

  suite('a11y markup: mic Retry button is labelled', () => {
    assert(html.includes('id="retryBtn"') && html.includes('aria-label="Retry microphone access"'),
      '#retryBtn has aria-label="Retry microphone access"');
  });

  suite('a11y markup: mode nav is a labelled, pressed-state group', () => {
    assert(html.includes('id="modeNav" role="group" aria-label="Mode"'),
      '#modeNav has role="group" (not role="tablist" — its children are aria-pressed toggle buttons, not tabs)');
  });

  suite('a11y markup: dial/strobe display toggle is a labelled, pressed-state group', () => {
    assert(html.includes('id="displaySeg" role="group" aria-label="Display style"'),
      '#displaySeg has role="group" aria-label="Display style"');
    assert(controlsJs.includes('setDisplayModeUI'), 'setDisplayModeUI exists to sync aria-pressed');
  });

  suite('a11y markup: haptic/chime toggles are labelled, pressed-state groups', () => {
    assert(html.includes('id="hapticSeg" role="group" aria-label="Haptic feedback"'),
      '#hapticSeg has role="group" aria-label="Haptic feedback"');
    assert(html.includes('id="chimeSeg" role="group" aria-label="In-tune chime"'),
      '#chimeSeg has role="group" aria-label="In-tune chime"');
  });

  suite('a11y markup: custom-tuning note picker + steppers are labelled', () => {
    assert(controlsJs.includes('String ${i + 1} note'), 'per-string note <select> is labelled');
    assert(controlsJs.includes('String ${i + 1} octave'), 'per-string octave <select> is labelled');
    assert(controlsJs.includes('Lower string ${i + 1} by a semitone'), 'per-string − nudge is labelled');
    assert(controlsJs.includes('Raise string ${i + 1} by a semitone'), 'per-string + nudge is labelled');
    assert(controlsJs.includes("'Fewer strings'") && controlsJs.includes("'More strings'"),
      '1-8 string-count stepper is labelled');
  });

  suite('a11y markup: metronome tap-tempo, beat lane, meter editor', () => {
    assert(html.includes('id="metTap"') && html.includes('aria-label="Tap tempo"'),
      '#metTap has a static aria-label (not embedding the live BPM)');
    // The beat-lane blocks ARE the editor now (tap a block to change its accent), so
    // they must be reachable, not aria-hidden. The lane group carries the instruction;
    // the sweeping playhead is decorative and aria-hidden.
    assert(html.includes('id="metPlayhead" aria-hidden="true"'),
      'the decorative sweeping playhead is aria-hidden');
    assert(html.includes('id="metLane"') && html.includes('role="group"') && /aria-label="Beats[^"]*"/.test(html),
      'the beat lane is a labelled group (its blocks are interactive)');
    // The editor is now a real modal sheet, so the toggle declares aria-haspopup="dialog"
    // + aria-expanded and points at the sheet by id — not an inline-disclosure aria-controls.
    assert(html.includes('id="metEditBtn"') && html.includes('aria-haspopup="dialog"') && html.includes('aria-controls="metSheet"'),
      'meter editor toggle declares it opens a dialog (aria-haspopup) targeting the sheet');
    assert(html.includes('id="metSheet"') && /id="metSheet"[^>]*role="dialog"[^>]*aria-modal="true"/.test(html),
      'the meter editor sheet is a modal dialog');
    assert(metViewJs.includes("setAttribute('aria-expanded'"),
      'metronome-view.js keeps aria-expanded in sync with the sheet open state');
  });

  suite('a11y markup: sheet is a top-level overlay, isolated from the header/view background', () => {
    assert(html.includes('<header class="hdr" id="hdr">'), '<header> has id="hdr" so controls.js can target it for background isolation');
    assert(controlsJs.includes("this.header = this.$('hdr')"), 'controls.js grabs the header element');
    assert(controlsJs.includes("this.tunerView = this.$('tunerView')") && controlsJs.includes("this.metronomeView = this.$('metronomeView')"),
      'controls.js grabs both mutually-exclusive view wrappers');
    assert(controlsJs.includes('_setBackgroundInert'), 'openSheet()/closeSheet() isolate the background via a dedicated helper');
    assert(controlsJs.includes('el.inert = hidden'), 'background containers are toggled inert');
    assert(controlsJs.includes("el.setAttribute('aria-hidden', 'true')"), 'background containers also get aria-hidden (inert support/behaviour varies by AT)');
  });

  suite('a11y markup: mic status is announced as an alert, not silently', () => {
    assert(html.includes('id="overlayStatus"') && html.includes('role="alert"'),
      '#overlayStatus has role="alert" so a newly-written error/status is announced');
  });

  suite('a11y markup: live-region announcements are suppressed while the sheet is open', () => {
    assert(controlsJs.includes('_sheetOpen'), 'controls.js tracks sheet-open state');
    assert(controlsJs.includes('!this._sheetOpen'),
      'update(ds) guards the live-region WRITE on _sheetOpen, independent of aria-hidden (behaviour varies across screen readers)');
  });

  suite('a11y markup: pinned string label flips to "tap to unpin"', () => {
    assert(controlsJs.includes('tap to unpin'), 'a pinned string announces "tap to unpin", not the stale pin label');
    assert(controlsJs.includes('tap to pin pitch detection to this string'), 'an unpinned string still announces "tap to pin"');
  });

  suite('a11y markup: reduced motion suppresses the metronome sweep + block transition', () => {
    // The redesigned lane has no beat-flash "pop"; the moving playhead is the motion.
    // Reduced motion must hide the sweeping playhead (leaving the sample-clock-driven
    // discrete brighten) and drop the block transitions.
    assert(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.met-lane\.is-running \.met-playhead \{ opacity: 0;/.test(cssText),
      'reduced-motion hides the sweeping playhead (discrete beat brighten remains)');
    assert(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.met-block \{ transition: none;/.test(cssText),
      'reduced-motion drops the block transition');
  });

  suite('a11y markup: an explicit :focus-visible ring exists using theme tokens', () => {
    assert(cssText.includes(':focus-visible {') && cssText.includes('outline: 3px solid var(--accent);'),
      ':focus-visible is styled using the --accent design token (theme-aware across dark/light/contrast)');
    assert(cssText.includes('.str:focus-visible'),
      '.str gets a box-shadow-based focus ring so it stacks with (rather than overwrites) the pinned-state outline');
  });

  suite('a11y markup: redundant setInstrument() call removed from changeInstrument()', () => {
    const fn = appJs.slice(appJs.indexOf('function changeInstrument'), appJs.indexOf('function changeTuning'));
    const calls = (fn.match(/controls\.setInstrument\(/g) || []).length;
    assert(calls === 0, 'changeInstrument() no longer calls controls.setInstrument() directly — selectTuning() already does');
  });
}
