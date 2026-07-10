// Offline-first service worker. On install, precache the whole app shell from an
// explicit hand-maintained list. On fetch, serve same-origin GETs cache-first and
// refresh the cache in the background (stale-while-revalidate); navigations are
// network-first with a cached-shell fallback. Old caches are purged on activate.
//
// CACHE-LIST DISCIPLINE: CORE_ASSETS is hand-maintained. When a module, asset, or
// font is added or removed, update this list AND bump CACHE. test-sw-assets guards it.
const CACHE = 'tuner-cache-v9';

const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './fonts/space-grotesk-var.woff2',
  './fonts/jetbrains-mono-var.woff2',
  './js/app.js',
  './js/config.js',
  './js/store.js',
  './js/theme-cycle.js',
  './js/audio/capture.js',
  './js/audio/tone.js',
  './js/audio/metronome.js',
  './js/dsp/fft.js',
  './js/dsp/filters.js',
  './js/dsp/mpm.js',
  './js/dsp/one-euro.js',
  './js/dsp/stabilizer.js',
  './js/dsp/trail.js',
  './js/music/instruments.js',
  './js/music/theory.js',
  './js/music/tunings.js',
  './js/music/meter.js',
  './js/ui/controls.js',
  './js/ui/dial.js',
  './js/ui/focus-order.js',
  './js/ui/graph.js',
  './js/ui/metronome-view.js',
  './js/ui/motion.js',
  './js/ui/note-status.js',
  './js/ui/strobe.js',
  './icons/favicon-32.png',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

// INVARIANT: skipWaiting() + clients.claim() let a new SW take over an open page.
// That is safe only because app.js uses static top-level imports exclusively — a
// running page never fetches more code. If a future package adds a dynamic import(),
// it must also add an update/refresh flow (or drop skipWaiting + claim).
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
            // Chain the write so waitUntil covers it; never fail the response on a cache error.
            return caches.open(CACHE)
              .then((c) => c.put(req, copy))
              .catch(() => {})
              .then(() => res);
          }
          return res;
        })
        .catch(() => null);
      if (cached) e.waitUntil(network); // keep the SW alive for the background refresh
      return cached || network.then((r) => r || Response.error());
    })
  );
});
