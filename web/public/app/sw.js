// Minimal service worker: lets the app install on a phone or desktop and keeps the app shell available.
// It never caches anything from Supabase or any other site, so no private data is stored by it.
const CACHE = 'tremcore-shell-v4';
const SHELL = ['/app/', '/app/style.css', '/app/app.js', '/app/hub.js', '/img/logo-mark.png', '/img/icon-192.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname === '/config.json' || url.pathname === '/healthz') return;
  // Network first so updates show straight away; fall back to the cached shell when offline.
  e.respondWith(fetch(e.request).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); } return r; })
    .catch(() => caches.match(e.request).then((m) => m || caches.match('/app/'))));
});
