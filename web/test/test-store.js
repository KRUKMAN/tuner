// Node. Cases for js/store.js — the guarded localStorage JSON wrapper.
import { suite, assert } from './assert.js';
import * as store from '../js/store.js';

function makeMockStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}

/** Registers and runs the store suite. */
export default function run() {
  suite('store: no backend → fallbacks', () => {
    const saved = globalThis.localStorage;
    globalThis.localStorage = undefined;
    try {
      assert(store.get('missing', 'fb') === 'fb', 'get() → fallback when no localStorage');
      assert(store.set('x', 1) === false, 'set() → false when no localStorage');
      assert(store.remove('x') === false, 'remove() → false when no localStorage');
    } finally {
      globalThis.localStorage = saved;
    }
  });

  suite('store: set/get roundtrip', () => {
    const saved = globalThis.localStorage;
    globalThis.localStorage = makeMockStorage();
    try {
      assert(store.set('k', { a: 1, b: [2, 3] }) === true, 'set() → true');
      const v = store.get('k', null);
      assert(!!v && v.a === 1 && v.b.join(',') === '2,3', 'get() → parsed object');
      assert(store.get('nope', 'd') === 'd', 'get(missing key) → fallback');
    } finally {
      globalThis.localStorage = saved;
    }
  });

  suite('store: corrupt JSON → fallback', () => {
    const saved = globalThis.localStorage;
    const mock = makeMockStorage();
    mock.setItem('bad', '{not json');
    globalThis.localStorage = mock;
    try {
      assert(store.get('bad', 'fb') === 'fb', 'get(corrupt) → fallback');
    } finally {
      globalThis.localStorage = saved;
    }
  });

  suite('store: remove deletes key', () => {
    const saved = globalThis.localStorage;
    globalThis.localStorage = makeMockStorage();
    try {
      store.set('r', 5);
      assert(store.remove('r') === true, 'remove() → true');
      assert(store.get('r', 'gone') === 'gone', 'get() after remove → fallback');
    } finally {
      globalThis.localStorage = saved;
    }
  });
}
