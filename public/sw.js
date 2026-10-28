/* Service worker: makes the app shell available offline.
   Bump VERSION together with the ?v= numbers in index.html on every release. */
const VERSION = 'v12';
const CACHE = `solat-qibla-${VERSION}`;
const SHELL = [
  './', './index.html',
  './assets/style.css?v=12', './assets/app.js?v=12',
  './manifest.webmanifest', './icon.svg', './icon-180.png', './icon-192.png', './icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  // Prayer-time, qibla and geocoding APIs are cross-origin: the page caches those in localStorage itself.
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    // Network first so a new release is picked up; fall back to the cached page when offline.
    event.respondWith(
      fetch(req).then(async (res) => {
        try {
          const text = await res.clone().text();
          if (res.ok && text.includes('id="app"')) (await caches.open(CACHE)).put('./index.html', new Response(text, { headers: res.headers }));
        } catch { /* ignore */ }
        return res;
      }).catch(() => caches.match('./index.html')),
    );
    return;
  }

  // Versioned assets: cache first, refresh in the background.
  event.respondWith(
    caches.match(req).then((hit) => {
      const refresh = fetch(req).then((res) => {
        if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
        return res;
      }).catch(() => hit);
      return hit || refresh;
    }),
  );
});
