// Node. Cases for js/theme-cycle.js — the pure 3-way theme cycle stepper.
import { suite, assert } from './assert.js';
import { THEME_ORDER, nextTheme, THEME_LABEL } from '../js/theme-cycle.js';

export default function run() {
  suite('THEME_ORDER: three themes, dark first', () => {
    assert(THEME_ORDER.length === 3, 'exactly three themes');
    assert(THEME_ORDER[0] === 'dark', 'dark is first (default)');
  });

  suite('nextTheme: cycles dark -> light -> contrast -> dark', () => {
    assert(nextTheme('dark') === 'light', 'dark -> light');
    assert(nextTheme('light') === 'contrast', 'light -> contrast');
    assert(nextTheme('contrast') === 'dark', 'contrast -> dark (wraps)');
  });

  suite('nextTheme: unknown current is treated as dark', () => {
    assert(nextTheme('bogus') === 'light', "unrecognised theme -> next after 'dark'");
    assert(nextTheme(undefined) === 'light', 'undefined -> next after dark');
  });

  suite('THEME_LABEL: has a human-readable entry for every theme', () => {
    for (const id of THEME_ORDER) {
      assert(typeof THEME_LABEL[id] === 'string' && THEME_LABEL[id].length > 0, `THEME_LABEL has '${id}'`);
    }
  });
}
