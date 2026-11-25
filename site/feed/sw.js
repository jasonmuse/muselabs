// Muse Feed's service worker: opens fast and still shows the page offline. Always tries the network first,
// so a new version arrives the moment it's online; never touches the API (/feed/api/), which is private and live.
const CACHE = 'muse-feed-v2';
const SHELL = ['/feed/', '/feed/feed.css', '/feed/app.js', '/feed/manifest.webmanifest', '/feed/penguin.gif', '/feed/icon-192.png', '/feed/favicon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  const shell = url.pathname.startsWith('/feed/') && !url.pathname.startsWith('/feed/api/');
  if (!shell && !url.pathname.startsWith('/assets/fonts/')) return;
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        if (r.ok && r.type === 'basic') {
          const copy = r.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return r;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || (e.request.mode === 'navigate' ? caches.match('/feed/') : Response.error()))),
  );
});
