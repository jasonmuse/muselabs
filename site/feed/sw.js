// Muse Feed's service worker.
// The page opens at once from the copy saved on this device, on a weak signal or none, instead of waiting for
// the network. Every open also asks the server for each of the page's files, past the browser's own cache
// (which may keep a file for hours). When anything changed, the saved copy is replaced as one set and the open
// page is told, so it loads the new one by itself at a quiet moment: a new version, a security fix above all,
// arrives within moments of being online. Never touches the API (/feed/api/), which is private and live.
const CACHE = 'muse-feed-v4';
const SHELL = ['/feed/', '/feed/feed.css', '/feed/app.js', '/feed/manifest.webmanifest', '/feed/penguin.gif', '/feed/icon-192.png', '/feed/favicon.png'];
const FONTS = ['/assets/fonts/bricolage-grotesque-800.woff2', '/assets/fonts/bricolage-grotesque-700.woff2', '/assets/fonts/silkscreen-400.woff2'];
const NEEDED = ['/feed/', '/feed/feed.css', '/feed/app.js']; // no page without these: if the server has lost one, the saved copy stays as it is
const SETTLE = 2500; // a page that's opening gets this long to take its files before a new set goes in
let opened = Date.now(); // when a page last opened (a worker usually starts because one is opening)
let checking = null;

const usable = (r) => !!r && r.ok && r.type === 'basic' && !r.redirected;
const sleep = (ms) => new Promise((done) => { setTimeout(done, ms); });
// The server's own answer: the browser's copy only counts once the server has said it's still right.
// If a browser won't take that for some request, an ordinary fetch still goes out.
const live = (request) => { try { return fetch(request, { cache: 'no-cache' }).catch(() => fetch(request)); } catch { return fetch(request); } };
// One file, whole, from the server: { r, bytes }, or { gone } when the server says it isn't there any more.
// Anything else (an error, a redirect, no network) throws, so a file that didn't arrive right is never saved.
async function ask(url) {
  const stop = new AbortController(); const timer = setTimeout(() => stop.abort(), 20000);
  try {
    const r = await fetch(new Request(url, { cache: 'no-cache', signal: stop.signal }));
    if (r.status === 404 || r.status === 410) return { gone: true };
    if (!usable(r)) throw new Error(`${url} answered ${r.status}`);
    return { r, bytes: await r.clone().arrayBuffer() };
  } finally { clearTimeout(timer); }
}
// What this worker saves and hands out is marked "ask again each time". Without that, a browser may keep
// using a script it still has in memory for hours (the server lets it), and never ask this worker for the new one.
const keep = (r) => {
  const headers = new Headers(r.headers);
  headers.set('cache-control', 'no-cache'); headers.delete('content-length'); headers.delete('content-encoding'); // (the saved body is already unpacked)
  return new Response(r.body, { status: r.status, statusText: r.statusText, headers });
};
const sameBytes = (a, b) => {
  if (a.byteLength !== b.byteLength) return false;
  const x = new Uint8Array(a); const y = new Uint8Array(b);
  for (let i = 0; i < x.length; i += 1) if (x[i] !== y[i]) return false;
  return true;
};

// One check of the whole page: every file is asked for, and they only go in together, so the saved copy is
// never half old and half new. True when a saved file changed (the open pages have been told by then).
async function check() {
  const cache = await caches.open(CACHE);
  const got = await Promise.all(SHELL.map(async (url) => {
    const now = await ask(url);
    if (now.gone && NEEDED.includes(url)) throw new Error(`${url} is missing`);
    const old = await cache.match(url, { ignoreVary: true });
    if (now.gone) return { url, state: old ? 'gone' : 'same' };
    return { url, r: now.r, state: !old ? 'new' : sameBytes(await old.arrayBuffer(), now.bytes) ? 'same' : 'changed' };
  }));
  const changed = got.some((g) => g.state === 'changed' || g.state === 'gone');
  const todo = got.filter((g) => g.state !== 'same');
  if (!todo.length) return false;
  // A page that's opening right now is still taking the old set: let it finish first.
  if (changed) while (Date.now() - opened < SETTLE) await sleep(SETTLE - (Date.now() - opened)); // eslint-disable-line no-await-in-loop
  await Promise.all(todo.map((g) => (g.state === 'gone' ? cache.delete(g.url, { ignoreVary: true }) : cache.put(g.url, keep(g.r)))));
  if (changed) for (const page of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) page.postMessage({ type: 'muse-feed-updated' });
  return changed;
}
// At most one check at a time. A check that can't finish (offline, say) changes nothing.
const refresh = () => {
  if (!checking) checking = check().catch(() => false).then((changed) => { checking = null; return changed; });
  return checking;
};

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(FONTS.map(async (url) => {
      if (await cache.match(url, { ignoreVary: true })) return;
      const now = await ask(url);
      if (!now.gone) await cache.put(url, now.r);
    }));
    await check(); // the first whole copy, or (a new worker over a saved copy) whatever changed since
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('muse-feed-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// The page asks for a check when it comes back to the front (an installed app can stay open for days).
self.addEventListener('message', (e) => { if (e.data && e.data.type === 'muse-feed-check') e.waitUntil(refresh()); });

async function answer(e, path, { page, font }) {
  let cache = null; let hit = null;
  try { cache = await caches.open(CACHE); hit = await cache.match(path, { ignoreVary: true }); } catch { /* nowhere to save on this device: the network it is */ }
  if (hit) {
    // A file outside the checked set (another icon, say) gets its newer copy behind the scenes, for next time.
    if (!font && !SHELL.includes(path)) e.waitUntil(ask(path).then((now) => (now.gone ? cache.delete(path, { ignoreVary: true }) : cache.put(path, keep(now.r)))).catch(() => {}));
    return hit;
  }
  try {
    const r = await (font ? fetch(e.request) : live(e.request)); // fonts never change, so the browser's copy of those is fine
    if (!usable(r)) return r; // an error page or a redirect goes straight through, and is never saved
    if (cache) { const copy = r.clone(); e.waitUntil(cache.put(path, font ? copy : keep(copy)).catch(() => {})); }
    return font ? r : keep(r);
  } catch (err) {
    const fallback = !page && cache && e.request.mode === 'navigate' ? await cache.match('/feed/', { ignoreVary: true }) : null;
    if (fallback) return fallback;
    throw err;
  }
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  const font = url.pathname.startsWith('/assets/fonts/');
  if (!font && (!url.pathname.startsWith('/feed/') || url.pathname.startsWith('/feed/api/') || url.pathname === '/feed/sw.js')) return;
  const page = e.request.mode === 'navigate' && (url.pathname === '/feed/' || url.pathname === '/feed/index.html');
  if (page) { opened = Date.now(); e.waitUntil(refresh()); }
  e.respondWith(answer(e, page ? '/feed/' : url.pathname, { page, font }));
});
