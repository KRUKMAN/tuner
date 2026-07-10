// Node. Cases for js/ui/focus-order.js — the pure Tab-trap index stepper.
import { suite, assert } from './assert.js';
import { nextFocusIndex } from '../js/ui/focus-order.js';

export default function run() {
  suite('nextFocusIndex: empty trap', () => {
    assert(nextFocusIndex(0, -1, false) === -1, 'no focusables -> -1 forward');
    assert(nextFocusIndex(0, -1, true) === -1, 'no focusables -> -1 backward');
  });

  suite('nextFocusIndex: forward (Tab)', () => {
    assert(nextFocusIndex(3, -1, false) === 0, 'unknown focus -> first element');
    assert(nextFocusIndex(3, 0, false) === 1, 'middle step forward');
    assert(nextFocusIndex(3, 1, false) === 2, 'step forward toward the end');
    assert(nextFocusIndex(3, 2, false) === 0, 'Tab from the last element wraps to the first (trap)');
  });

  suite('nextFocusIndex: backward (Shift+Tab)', () => {
    assert(nextFocusIndex(3, -1, true) === 2, 'unknown focus -> last element');
    assert(nextFocusIndex(3, 2, true) === 1, 'step backward');
    assert(nextFocusIndex(3, 1, true) === 0, 'step backward toward the start');
    assert(nextFocusIndex(3, 0, true) === 2, 'Shift+Tab from the first element wraps to the last (trap)');
  });

  suite('nextFocusIndex: single focusable element traps on itself', () => {
    assert(nextFocusIndex(1, 0, false) === 0, 'Tab on a single element stays put');
    assert(nextFocusIndex(1, 0, true) === 0, 'Shift+Tab on a single element stays put');
  });
}
