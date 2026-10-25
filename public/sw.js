// Service worker: keeps the app screens available without signal. Data and photos are queued by the app itself
// (IndexedDB) and never cached here; API calls always go to the network.
const CACHE = 'aral-shell-v2';
const SHELL = ['/app/', '/app/index.html', '/css/app.css', '/js/common.js', '/js/i18n.js', '/js/app.js', '/js/settings.js', '/js/leads.js', '/js/jobs.js', '/js/calendar.js', '/js/inspect.js', '/js/reviews.js', '/js/finance.js', '/js/native.js', '/i18n/ar.json', '/mark.png', '/logo.jpg', '/favicon.png', '/manifest.webmanifest'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/') || u.pathname.endsWith('.ics')) return;
  // network first, cached copy when offline
  e.respondWith(fetch(e.request).then((r) => { if (r.ok && SHELL.includes(u.pathname)) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); } return r; })
    .catch(() => caches.match(e.request).then((m) => m || caches.match('/app/index.html'))));
});
