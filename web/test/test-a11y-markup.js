// Node. Static text guard: confirms the accessibility hooks this package adds are
// present in the shipped markup/source. NOT a behavior test — it cannot exercise
// focus movement, aria-live announcements, or keyboard events (no jsdom in this
// repo; see Global Constraints). Real behavior is verified manually per-task.
//
// Adapted from the plan's illustrative version to match the tree as it actually
// exists after Packages B/D/E: the instrument segment already ships a correct,
// more idiomatic role="tablist" + per-chip role="tab"/aria-selected pattern
// (Package B) rather than the plan's assumed role="group"/aria-pressed — this
// guard checks for the pattern that is actually on disk, not the plan's guess.
import { suite, assert } from './assert.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..');

export default function run() {
  const html = readFileSync(join(WEB, 'index.html'), 'utf8');
  const controlsJs = readFileSync(join(WEB, 'js/ui/controls.js'), 'utf8');
  const metViewJs = readFileSync(join(WEB, 'js/ui/metronome-view.js'), 'utf8');

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

  suite('a11y markup: instrument segment is a labelled tab pattern (Package B, adapted)', () => {
    assert(html.includes('id="instrumentSeg" role="tablist" aria-label="Instrument"'),
      '#instrumentSeg has role="tablist" aria-label="Instrument"');
    assert(controlsJs.includes("setAttribute('role', 'tab')"), 'instrument chips carry role="tab"');
    assert(controlsJs.includes("setAttribute('aria-selected'"), 'instrument chips carry aria-selected');
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

  suite('a11y markup: metronome tap-tempo, beat pills, meter editor', () => {
    assert(html.includes('id="metTap"') && html.includes('aria-label="Tap tempo"'),
      '#metTap has a static aria-label (not embedding the live BPM)');
    assert(html.includes('id="metPills" aria-hidden="true"'),
      'real-time beat-pill row is aria-hidden (redundant with the audible click)');
    assert(html.includes('id="metEditBtn"') && html.includes('aria-controls="metEditor"'),
      'meter editor toggle declares aria-controls (it is an inline disclosure, not a modal — see report)');
    assert(metViewJs.includes("setAttribute('aria-expanded'"),
      'metronome-view.js keeps aria-expanded in sync with the editor disclosure state');
  });
}
