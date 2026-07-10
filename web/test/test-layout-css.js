// Node. Static guard for the .app -> view-wrapper flex chain.
//
// HONEST LIMITS: this is a CSS *text* check, not a layout test. There is no jsdom
// and no headless browser in this suite, so it cannot prove the page lays out
// correctly — only that the rule which makes it lay out correctly still exists.
// It exists because deleting that rule silently collapses the whole tuner into
// the top ~1/3 of the viewport, with nothing failing. Real verification is a
// browser measurement of #tunerView's height vs the viewport.

import { suite, assert } from './assert.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Strip /* comments */ FIRST. The rule this guards is documented by a comment that
// itself contains "#tunerView" and a literal "{ flex: 1 1 0 }" — matching against raw
// text let the comment satisfy the assertions, so deleting the real rule still passed.
const CSS = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'css', 'styles.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

/** Extract the declaration block of the first rule whose selector list contains `sel`. */
function ruleFor(sel) {
  const re = new RegExp(`(^|[,}])\\s*[^{}]*${sel.replace(/[.#*+?^$()|[\]\\]/g, '\\$&')}[^{}]*\\{([^}]*)\\}`, 'm');
  const m = CSS.match(re);
  return m ? m[2] : null;
}

/** Registers and runs the layout-chain guard suite. */
export default function run() {
  suite('layout: the mode-view wrappers keep the .app flex chain intact', () => {
    const app = ruleFor('.app');
    assert(app !== null && /display:\s*flex/.test(app), '.app is a flex container');
    assert(app !== null && /flex-direction:\s*column/.test(app), '.app is a column');

    const view = ruleFor('#tunerView');
    assert(view !== null, '#tunerView has a CSS rule at all (a bare block collapses the tuner)');
    assert(/flex:\s*1/.test(view || ''), '#tunerView grows to fill .app (flex: 1 ...)');
    assert(/display:\s*flex/.test(view || ''), '#tunerView is itself a flex container');
    assert(/flex-direction:\s*column/.test(view || ''), '#tunerView is a column');

    // The spacers only expand when their PARENT is a flex container. That parent is
    // #tunerView, not .app — which is exactly what broke when the wrapper was added.
    const spacer = ruleFor('.spacer');
    assert(spacer !== null && /flex:\s*1 1 0/.test(spacer), '.spacer still declares flex: 1 1 0');

    // The metronome view is the same structural case.
    assert(/#tunerView\s*,\s*\.met-view|\.met-view\s*,\s*#tunerView/.test(CSS),
      '.met-view shares the wrapper rule (same collapse bug otherwise)');
  });

  // Regression: the mic ".overlay" is `position:absolute; inset:0`, so it sizes to its
  // nearest POSITIONED ancestor. If that ancestor is `.app`, the overlay blankets the
  // header too and (z-index:20 over the header's z-index:3) eats every tap on the
  // Tuner|Metronome mode nav — you cannot switch to the metronome. #tunerView must be
  // positioned so the overlay is confined to the tuner content, below the header.
  suite('layout: the mic overlay is confined to #tunerView, not the whole app', () => {
    const overlay = ruleFor('.overlay');
    assert(overlay !== null && /position:\s*absolute/.test(overlay),
      '.overlay is position:absolute (so its box comes from the nearest positioned ancestor)');
    assert(overlay !== null && /inset:\s*0/.test(overlay),
      '.overlay uses inset:0 (fills its containing block)');

    // #tunerView must establish itself as that containing block. Guard EVERY #tunerView
    // rule, since the shared flex block does not carry `position` — a later dedicated
    // rule does.
    const tunerViewRules = [...CSS.matchAll(/#tunerView(?![\w-])[^{}]*\{([^}]*)\}/g)].map((m) => m[1]);
    assert(tunerViewRules.length > 0, '#tunerView has at least one rule');
    assert(tunerViewRules.some((r) => /position:\s*relative/.test(r)),
      '#tunerView is position:relative so the overlay cannot cover the header mode nav');
  });
}
