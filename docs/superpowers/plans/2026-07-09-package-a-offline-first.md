# Package A — Offline-first Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the tuner genuinely offline-capable and self-contained — precache the app shell, self-host fonts (removing the Google Fonts request that contradicts "nothing leaves the device"), sync the mobile status-bar colour to the theme, and gate deploys on the test suite.

**Architecture:** A rewritten service worker precaches an explicit, hand-maintained `CORE_ASSETS` list on install and serves same-origin GETs stale-while-revalidate, purging old caches on activate. A Node test (`test-sw-assets`) guards the list against the real file tree. Fonts become two self-hosted variable `woff2` files. A tiny `store.js` wraps localStorage; theme persistence migrates onto it and drives a dynamic `theme-color` meta. CI runs the existing Node test suite before publishing.

**Tech Stack:** Vanilla ES modules (no build step), Service Worker + Cache API, Web App Manifest, the repo's zero-dependency Node test harness (`web/test/assert.js` + `run-all.js`), GitHub Actions.

## Global Constraints

- **No build step.** Hand-authored ES modules served as-is; no bundler/transpiler; no npm runtime dependencies. (verbatim from spec §1.1)
- **Pure vs. browser split.** `js/config.js`, `js/music/*`, `js/dsp/*` stay Node-safe (no `window`/`document`/`AudioContext`/`performance`/`Date`) and are unit-tested in Node. `js/store.js` must also be Node-safe (guarded access). Browser wrappers (`js/audio/*`, `js/ui/*`, `js/app.js`, `sw.js`) may use browser APIs. (spec §1.2)
- **`CONFIG` is the single source of truth**, deep-frozen. No new inline numeric literals or globals in logic modules. (spec §1.3)
- **localStorage access is always wrapped in try/catch** and tolerant of absence. (spec §1.7)
- **Cache-list discipline:** `CORE_ASSETS` is hand-maintained; any file added/removed later must be reflected in it, and `CACHE` is bumped per *released* package. `test-sw-assets` enforces coverage. (spec §3)
- Test harness idiom: each suite file default-exports a `run()` that calls `suite(name, fn)` + `assert`/`assertClose`, and is registered in `web/test/run-all.js`. Full suite is `node web/test/run-all.js` (exit 1 on any failure).
- Out of Package A: the optional "new version available" update toast (YAGNI for now).

---

## File Structure

- `web/js/store.js` **(new)** — JSON localStorage wrapper (`get`/`set`/`remove`); Node-safe.
- `web/test/test-store.js` **(new)** — unit tests for `store.js`.
- `web/sw.js` **(rewrite)** — precache + stale-while-revalidate + activate cleanup + `CORE_ASSETS`.
- `web/test/test-sw-assets.js` **(new)** — guards `CORE_ASSETS` against the shipped file tree.
- `web/test/run-all.js` **(modify)** — register the two new suites.
- `web/index.html` **(modify)** — add `id` to theme-color meta; remove Google Fonts `<link>`s.
- `web/js/app.js` **(modify)** — import `store`; migrate theme persistence; update theme-color meta on theme change.
- `web/css/styles.css` **(modify)** — `@font-face` for the two self-hosted variable fonts.
- `web/fonts/space-grotesk-var.woff2`, `web/fonts/jetbrains-mono-var.woff2` **(new)** — self-hosted fonts.
- `serve.mjs` **(modify)** — add `.woff2` MIME type.
- `.github/workflows/deploy.yml` **(modify)** — run tests before deploy (gate).
- `web/package.json` **(modify)** — add `test` script.

---

### Task 1: `store.js` localStorage wrapper + tests

**Files:**
- Create: `web/js/store.js`
- Create: `web/test/test-store.js`
- Modify: `web/test/run-all.js`

**Interfaces:**
- Produces: `get(key: string, fallback?: any) => any` (parsed JSON or `fallback` when absent/blocked/corrupt); `set(key: string, value: any) => boolean` (JSON-encodes; `false` when no storage); `remove(key: string) => boolean`.

- [ ] **Step 1: Write the failing test**

Create `web/test/test-store.js`:

```js
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
```

Then register it in `web/test/run-all.js` — add the import after the existing imports and the call after the existing calls:

```js
import runStore from './test-store.js';
```
```js
runStore();
```

(Place `import runStore` alongside the other `import run…` lines near the top, and `runStore();` alongside the other `run…();` calls before `const ok = report();`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node web/test/run-all.js`
Expected: FAIL — the `store` suites throw/fail with something like `Cannot find module '../js/store.js'` reported as `[store: …] THREW`, and the final summary shows FAILED.

- [ ] **Step 3: Write minimal implementation**

Create `web/js/store.js`:

```js
// BROWSER (Node-safe): thin JSON wrapper over localStorage. Every access is
// guarded so it silently no-ops where storage is missing or blocked (private
// mode, Node tests). One key per concern; values are JSON-encoded.

/** @returns {Storage|null} the localStorage backend, or null if unavailable. */
function backend() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

/**
 * @template T
 * @param {string} key
 * @param {T} [fallback=null]
 * @returns {T} parsed value, or fallback if absent/blocked/corrupt.
 */
export function get(key, fallback = null) {
  const b = backend();
  if (!b) return fallback;
  try {
    const raw = b.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/**
 * @param {string} key
 * @param {*} value  JSON-serializable value
 * @returns {boolean} true if persisted.
 */
export function set(key, value) {
  const b = backend();
  if (!b) return false;
  try {
    b.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} key
 * @returns {boolean} true if removed.
 */
export function remove(key) {
  const b = backend();
  if (!b) return false;
  try {
    b.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node web/test/run-all.js`
Expected: PASS — the four `store:` suites all print `PASS`, and the summary ends with `ALL TESTS PASSED`.

- [ ] **Step 5: Commit**

```bash
git add web/js/store.js web/test/test-store.js web/test/run-all.js
git commit -m "feat(store): add Node-safe localStorage JSON wrapper"
```

---

### Task 2: Service worker rewrite + `CORE_ASSETS` guard test

**Files:**
- Create: `web/test/test-sw-assets.js`
- Modify: `web/test/run-all.js`
- Rewrite: `web/sw.js`

**Interfaces:**
- Consumes: nothing from earlier tasks at runtime. The guard test reads `web/sw.js` as text and the `web/` file tree.
- Produces: `web/sw.js` exposes a hand-maintained `const CORE_ASSETS = [ … ]` string-literal array and `const CACHE = 'tuner-cache-v2'`.

- [ ] **Step 1: Write the failing test**

Create `web/test/test-sw-assets.js`:

```js
// Node. Guards web/sw.js CORE_ASSETS against the actual shipped file tree so a
// newly added module/asset/font can't silently be left out of the offline
// precache. Reads sw.js as text (it references `self`, so it can't be imported).
import { suite, assert } from './assert.js';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep, extname } from 'node:path';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..'); // web/
const RUNTIME_EXT = new Set(['.html', '.css', '.js', '.webmanifest', '.woff2', '.png']);
const EXCLUDE_DIRS = new Set(['test']);
const EXCLUDE_FILES = new Set(['sw.js', 'package.json']);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (!EXCLUDE_DIRS.has(name)) walk(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

function toRel(full) {
  return './' + relative(WEB, full).split(sep).join('/');
}

function extractCoreAssets(swText) {
  const m = swText.match(/CORE_ASSETS\s*=\s*\[([\s\S]*?)\]/);
  if (!m) return null;
  const items = m[1].match(/['"]([^'"]+)['"]/g) || [];
  return items.map((s) => s.slice(1, -1));
}

/** Registers and runs the service-worker asset-list guard suite. */
export default function run() {
  suite('sw: CORE_ASSETS covers every shipped runtime asset', () => {
    const swText = readFileSync(join(WEB, 'sw.js'), 'utf8');
    const listed = extractCoreAssets(swText);
    assert(Array.isArray(listed) && listed.length > 0, 'CORE_ASSETS array parsed from sw.js');
    const listedSet = new Set(listed || []);

    const shipped = walk(WEB)
      .filter((f) => RUNTIME_EXT.has(extname(f).toLowerCase()))
      .filter((f) => !EXCLUDE_FILES.has(relative(WEB, f).split(sep).join('/')))
      .map(toRel);

    const missing = shipped.filter((rel) => !listedSet.has(rel));
    assert(missing.length === 0, `every shipped asset is precached (missing: ${missing.join(', ') || 'none'})`);
  });

  suite('sw: every listed asset exists on disk', () => {
    const swText = readFileSync(join(WEB, 'sw.js'), 'utf8');
    const listed = extractCoreAssets(swText) || [];
    const ghosts = listed
      .filter((p) => p !== './')
      .filter((p) => !existsSync(join(WEB, p.replace(/^\.\//, ''))));
    assert(ghosts.length === 0, `no CORE_ASSETS entries point at missing files (ghosts: ${ghosts.join(', ') || 'none'})`);
  });
}
```

Register it in `web/test/run-all.js`:

```js
import runSwAssets from './test-sw-assets.js';
```
```js
runSwAssets();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node web/test/run-all.js`
Expected: FAIL — `CORE_ASSETS array parsed from sw.js` fails (the current `sw.js` has no `CORE_ASSETS`), so the summary shows FAILED.

- [ ] **Step 3: Rewrite the service worker**

Replace the entire contents of `web/sw.js` with:

```js
// Offline-first service worker. On install, precache the whole app shell from an
// explicit hand-maintained list. On fetch, serve same-origin GETs cache-first and
// refresh the cache in the background (stale-while-revalidate); navigations are
// network-first with a cached-shell fallback. Old caches are purged on activate.
//
// CACHE-LIST DISCIPLINE: CORE_ASSETS is hand-maintained. When a module, asset, or
// font is added or removed, update this list AND bump CACHE. test-sw-assets guards it.
const CACHE = 'tuner-cache-v2';

const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/app.js',
  './js/config.js',
  './js/store.js',
  './js/audio/capture.js',
  './js/audio/tone.js',
  './js/dsp/fft.js',
  './js/dsp/filters.js',
  './js/dsp/mpm.js',
  './js/dsp/one-euro.js',
  './js/dsp/stabilizer.js',
  './js/dsp/trail.js',
  './js/music/theory.js',
  './js/music/tunings.js',
  './js/ui/controls.js',
  './js/ui/dial.js',
  './js/ui/graph.js',
  './icons/favicon-32.png',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return; // ignore cross-origin

  // Navigations: prefer fresh HTML, fall back to the cached shell when offline.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
    );
    return;
  }

  // Assets: stale-while-revalidate. Serve cache immediately; refresh in background.
  // Only successful (ok) responses are cached — never a 404/500 body.
  e.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => null);
      return cached || network.then((r) => r || caches.match('./index.html'));
    })
  );
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node web/test/run-all.js`
Expected: PASS — both `sw:` suites print PASS and the summary ends `ALL TESTS PASSED`. (No fonts exist yet, so neither the shipped tree nor `CORE_ASSETS` includes `woff2` — they match.)

- [ ] **Step 5: Manual offline verification**

Run the app and confirm a cold offline load works:

```bash
node serve.mjs 8173
```

In Chrome at `http://localhost:8173`: open DevTools → Application → Service Workers, confirm the worker is activated. Then DevTools → Network → check **Offline**, and hard-reload. Expected: the app boots fully (dial + controls render) with all requests served "(ServiceWorker)". Application → Cache Storage → `tuner-cache-v2` lists the `CORE_ASSETS`. Uncheck Offline when done.

- [ ] **Step 6: Commit**

```bash
git add web/sw.js web/test/test-sw-assets.js web/test/run-all.js
git commit -m "feat(sw): precache app shell + stale-while-revalidate + cache cleanup"
```

---

### Task 3: Dynamic theme-color + migrate theme persistence to `store`

**Files:**
- Modify: `web/index.html:6` (theme-color meta)
- Modify: `web/js/app.js` (import store; theme persistence; theme-color update)

**Interfaces:**
- Consumes: `store.get`/`store.set` from Task 1.
- Produces: no new exports; `applyTheme(theme)` additionally updates the `#themeColorMeta` content and persists via `store`.

- [ ] **Step 1: Give the theme-color meta an id**

In `web/index.html`, change line 6 from:

```html
  <meta name="theme-color" content="#0b0d10">
```
to:
```html
  <meta name="theme-color" content="#0b0d10" id="themeColorMeta">
```

- [ ] **Step 2: Import `store` in `app.js`**

In `web/js/app.js`, add this import immediately after the `import { CONFIG } from './config.js';` line (line 4):

```js
import * as store from './store.js';
```

- [ ] **Step 3: Update theme handling to drive the meta and use `store`**

In `web/js/app.js`, replace the theme block (the `applyTheme` function and the IIFE that restores the saved theme, currently lines 84–94):

```js
function applyTheme(theme) {
  root.setAttribute('data-theme', theme);
  try { localStorage.setItem('tuner-theme', theme); } catch { /* ignore */ }
  cacheColors();
  pushGraphColors();
}
(() => {
  let saved = null;
  try { saved = localStorage.getItem('tuner-theme'); } catch { /* ignore */ }
  if (saved) root.setAttribute('data-theme', saved);
})();
```

with:

```js
// Status-bar / theme-color per theme (matches --bg-bot in css/styles.css).
const THEME_COLORS = { dark: '#0b0d10', light: '#efe9df' };
function applyThemeColor(theme) {
  const meta = document.getElementById('themeColorMeta');
  if (meta) meta.setAttribute('content', THEME_COLORS[theme] || THEME_COLORS.dark);
}
function applyTheme(theme) {
  root.setAttribute('data-theme', theme);
  store.set('tuner-theme', theme);
  applyThemeColor(theme);
  cacheColors();
  pushGraphColors();
}
(() => {
  const saved = store.get('tuner-theme', null);
  if (saved) { root.setAttribute('data-theme', saved); applyThemeColor(saved); }
})();
```

Note: `store` JSON-encodes values, so a previously stored raw `tuner-theme` value (e.g. `dark`) fails to parse and returns the fallback — a one-time reset to the default dark theme for existing users. Acceptable for a display preference.

- [ ] **Step 4: Run tests (no regressions)**

Run: `node web/test/run-all.js`
Expected: PASS — `ALL TESTS PASSED` (this task changes only browser code + a meta tag; the suite must stay green).

- [ ] **Step 5: Manual verification**

```bash
node serve.mjs 8173
```

At `http://localhost:8173`: open the sheet, toggle the theme (◑). Expected: theme flips dark⇄light, and in DevTools → Elements the `<meta id="themeColorMeta">` `content` switches between `#0b0d10` and `#efe9df`. Reload — the chosen theme persists.

- [ ] **Step 6: Commit**

```bash
git add web/index.html web/js/app.js
git commit -m "feat(theme): sync theme-color meta to theme; persist via store"
```

---

### Task 4: Self-host fonts (remove the Google Fonts request)

**Files:**
- Create: `web/fonts/space-grotesk-var.woff2`
- Create: `web/fonts/jetbrains-mono-var.woff2`
- Modify: `web/css/styles.css` (prepend `@font-face`)
- Modify: `web/index.html:18-20` (remove Google Fonts links)
- Modify: `serve.mjs:12-22` (add `.woff2` MIME)
- Modify: `web/sw.js` (add fonts to `CORE_ASSETS`)

**Interfaces:**
- Consumes: `CORE_ASSETS` in `sw.js` (Task 2).
- Produces: `body`/`.mono` resolve `Space Grotesk` / `JetBrains Mono` from same-origin `woff2`; no external font request.

- [ ] **Step 1: Download the two variable fonts**

Fetch Fontsource's self-hosted variable `woff2` (Latin, normal) into `web/fonts/`:

```bash
mkdir -p web/fonts
curl -fSL -o web/fonts/space-grotesk-var.woff2 \
  "https://cdn.jsdelivr.net/fontsource/fonts/space-grotesk:vf@latest/latin-wght-normal.woff2"
curl -fSL -o web/fonts/jetbrains-mono-var.woff2 \
  "https://cdn.jsdelivr.net/fontsource/fonts/jetbrains-mono:vf@latest/latin-wght-normal.woff2"
```

- [ ] **Step 2: Verify the downloads are real woff2 files**

```bash
for f in web/fonts/space-grotesk-var.woff2 web/fonts/jetbrains-mono-var.woff2; do
  printf '%s: magic=' "$f"; head -c 4 "$f"; printf ' size='; wc -c < "$f";
done
```
Expected: each line shows `magic=wOF2` and a `size` well above 10000 (tens of KB). If `magic` is not `wOF2` (e.g. an HTML error page), the download failed — stop and resolve network access before continuing.

- [ ] **Step 3: Add `@font-face` and stop relying on the system fallback**

In `web/css/styles.css`, insert at the very top of the file (before the `/* Tuner — UI styling… */` header comment):

```css
/* ---------- Self-hosted fonts (offline-first, no external requests) ---------- */
@font-face {
  font-family: 'Space Grotesk';
  font-style: normal;
  font-weight: 300 700;
  font-display: swap;
  src: url('../fonts/space-grotesk-var.woff2') format('woff2');
}
@font-face {
  font-family: 'JetBrains Mono';
  font-style: normal;
  font-weight: 100 800;
  font-display: swap;
  src: url('../fonts/jetbrains-mono-var.woff2') format('woff2');
}

```

- [ ] **Step 4: Remove the Google Fonts links from `index.html`**

In `web/index.html`, delete these three lines (currently 18–20):

```html
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
```

Leave the following line (`<link rel="stylesheet" href="./css/styles.css">`) in place.

- [ ] **Step 5: Add the `.woff2` MIME type to `serve.mjs`**

In `serve.mjs`, add this entry to the `MIME` object (after the `'.png'` line):

```js
  '.woff2': 'font/woff2',
```

- [ ] **Step 6: Add the fonts to `CORE_ASSETS`**

In `web/sw.js`, add these two entries to the `CORE_ASSETS` array (immediately after the `'./css/styles.css',` line):

```js
  './fonts/space-grotesk-var.woff2',
  './fonts/jetbrains-mono-var.woff2',
```

(No `CACHE` bump needed within Package A — it ships as one unreleased unit. Future packages that add files bump `CACHE`.)

- [ ] **Step 7: Run tests to verify the guard passes**

Run: `node web/test/run-all.js`
Expected: PASS — `sw: CORE_ASSETS covers every shipped runtime asset` still passes now that the two new `woff2` files are both on disk and in the list. `ALL TESTS PASSED`. (To prove the guard bites, you may temporarily remove one font line from `CORE_ASSETS`, re-run, see that suite FAIL with the missing path, then restore it.)

- [ ] **Step 8: Manual verification — no external request, fonts render**

```bash
node serve.mjs 8173
```

At `http://localhost:8173`: DevTools → Network, filter `Font`, reload. Expected: `space-grotesk-var.woff2` and `jetbrains-mono-var.woff2` load from `localhost` (same-origin) and there are **no** requests to `fonts.googleapis.com`/`fonts.gstatic.com`. The note readout and mono labels render in the correct typefaces (not a system fallback).

- [ ] **Step 9: Commit**

```bash
git add web/fonts/space-grotesk-var.woff2 web/fonts/jetbrains-mono-var.woff2 web/css/styles.css web/index.html serve.mjs web/sw.js
git commit -m "feat(fonts): self-host Space Grotesk + JetBrains Mono woff2; drop Google Fonts"
```

---

### Task 5: CI test gate

**Files:**
- Modify: `web/package.json` (add `test` script)
- Modify: `.github/workflows/deploy.yml` (run tests before deploy)

**Interfaces:**
- Consumes: the full `node web/test/run-all.js` suite (must be green from Tasks 1–4).
- Produces: a deploy job that fails before publishing if any test fails.

- [ ] **Step 1: Add a `test` script to `package.json`**

Replace the contents of `web/package.json` with:

```json
{
  "type": "module",
  "name": "tuner-web",
  "private": true,
  "scripts": {
    "test": "node test/run-all.js"
  }
}
```

- [ ] **Step 2: Verify the script runs locally**

Run: `node web/test/run-all.js`
Expected: `ALL TESTS PASSED`, exit code 0. (Confirm the exit code:)

```bash
node web/test/run-all.js; echo "exit=$?"
```
Expected: ends with `exit=0`.

- [ ] **Step 3: Add the test gate to the deploy workflow**

In `.github/workflows/deploy.yml`, insert the setup-node + test steps immediately after the `- uses: actions/checkout@v4` line (line 24), before `- name: Configure Pages`:

```yaml
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Run tests (gate deploy)
        run: node web/test/run-all.js
```

The steps run in order within the single job, so a non-zero exit from the test step fails the job before any Pages upload/deploy.

- [ ] **Step 4: Validate the workflow YAML**

Confirm the file still parses as YAML and the new steps are correctly nested under `steps:` (2-space indent matching the sibling steps):

```bash
node -e "const f=require('node:fs').readFileSync('.github/workflows/deploy.yml','utf8'); if(!/setup-node@v4/.test(f)||!/Run tests \(gate deploy\)/.test(f)) throw new Error('gate steps missing'); console.log('deploy.yml gate present');"
```
Expected: `deploy.yml gate present`.

- [ ] **Step 5: Commit**

```bash
git add web/package.json .github/workflows/deploy.yml
git commit -m "ci: run test suite before GitHub Pages deploy"
```

---

## Self-Review

**Spec coverage (spec §3 Package A):**
- Service worker rewrite (install precache, activate cleanup, SWR, no non-OK caching, navigation fallback, versioned `CACHE`) → Task 2. ✓
- Cache-list discipline + `test-sw-assets` guard → Task 2 (guard) + Task 4 (exercises it with fonts). ✓
- Self-host fonts + `@font-face` + remove Google links + `serve.mjs` MIME → Task 4. ✓
- Dynamic `theme-color` → Task 3. ✓
- CI test gate + `package.json` `test` script → Task 5. ✓
- `store.js` helper + theme migration → Task 1 (helper) + Task 3 (migration). ✓
- Optional update toast → intentionally omitted (Global Constraints / YAGNI). ✓

**Placeholder scan:** No TBD/TODO; every code/step shows full content and exact commands with expected output. ✓

**Type consistency:** `store.get(key, fallback)` / `store.set(key, value)` / `store.remove(key)` are defined in Task 1 and consumed with those exact signatures in Task 3. `CORE_ASSETS` / `CACHE` names defined in Task 2 are referenced identically in Task 4. `#themeColorMeta` id set in Task 3 Step 1 matches the `getElementById('themeColorMeta')` lookup in Step 3. ✓

**Ordering:** Task 1 (store) precedes Task 3 (uses store). Task 2 (sw.js + `CORE_ASSETS`) precedes Task 4 (edits `CORE_ASSETS`). Task 5 (CI gate) last, after the suite is complete and green. ✓
