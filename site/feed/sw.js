// Muse Feed's service worker: opens fast and still shows the page offline. Always tries the network first,
// and has the browser check each of the page's files with the server instead of trusting its own copy (which
// it may otherwise keep for hours), so a new version, a security fix above all, arrives the moment it's online.
// Never touches the API (/feed/api/), which is private and live.
const CACHE = 'muse-feed-v3';
const SHELL = ['/feed/', '/feed/feed.css', '/feed/app.js', '/feed/manifest.webmanifest', '/feed/penguin.gif', '/feed/icon-192.png', '/feed/favicon.png'];
// Checked with the server every time. If a browser won't take that for some request, an ordinary fetch still goes out.
const checked = (request) => { try { return fetch(request, { cache: 'no-cache' }).catch(() => fetch(request)); } catch { return fetch(request); } };

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'no-cache' })))).then(() => self.skipWaiting()));
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
    (shell ? checked(e.request) : fetch(e.request)) // fonts never change, so the browser's copy of those is fine
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
