// Tests for Muse Feed's service worker (site/feed/sw.js), run in a pretend browser: a pretend server, a
// pretend saved-files store and a pretend clock. Run: node --test feed-api/test/
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCE = readFileSync(join(ROOT, 'site/feed/sw.js'), 'utf8');
const ORIGIN = 'https://muselabs.app';
const CACHE = /const CACHE = '([^']+)'/.exec(SOURCE)[1];
const listed = (name) => JSON.parse(new RegExp(`const ${name} = (\\[[^\\]]*\\]);`).exec(SOURCE)[1].replace(/'/g, '"'));
const SHELL = listed('SHELL'); const FONTS = listed('FONTS');
const pathOf = (key) => new URL(typeof key === 'string' ? key : key.url, ORIGIN).pathname;
const text = (bytes) => Buffer.from(bytes).toString('utf8');

// A pretend browser with the worker loaded into it.
function browser({ saved = {}, storage = true } = {}) {
  const server = new Map([...SHELL, ...FONTS, '/feed/icon-512.png', '/feed/api/feed', '/'].map((p) => [p, `the first ${p}`]));
  const w = { server, asked: [], writes: [], messages: [], clock: 1_000_000, down: false, failing: new Set(), hold: null, skipped: 0, claimed: 0, stores: new Map() };
  for (const [name, files] of Object.entries(saved)) w.stores.set(name, new Map(Object.entries(files).map(([p, body]) => [p, { status: 200, headers: [['cache-control', 'public, max-age=14400']], body: Buffer.from(body) }])));

  class FakeRequest {
    constructor(input, init = {}) { this.url = new URL(typeof input === 'string' ? input : input.url, ORIGIN).href; this.method = init.method || 'GET'; this.cache = init.cache || 'default'; this.mode = init.mode || 'no-cors'; }
  }
  const fetch = async (input, init = {}) => {
    const path = pathOf(input); const cache = init.cache || (typeof input === 'object' && input.cache) || 'default';
    w.asked.push({ path, cache });
    if (w.hold) await w.hold;
    if (w.down || w.failing.has(path)) throw new TypeError('pretend: no network');
    const body = server.get(path);
    const r = body === undefined ? new Response('not here', { status: 404 }) : new Response(body, { status: 200, headers: { 'cache-control': 'public, max-age=14400', 'content-length': String(Buffer.byteLength(body)), 'x-from': 'server' } });
    Object.defineProperty(r, 'type', { value: 'basic' });
    return r;
  };
  const store = (name) => { if (!w.stores.has(name)) w.stores.set(name, new Map()); return w.stores.get(name); };
  const cacheFor = (name) => ({
    async match(key) { const hit = store(name).get(pathOf(key)); return hit ? new Response(hit.body, { status: hit.status, headers: hit.headers }) : undefined; },
    async put(key, r) { const body = Buffer.from(await r.arrayBuffer()); store(name).set(pathOf(key), { status: r.status, headers: [...r.headers], body }); w.writes.push({ path: pathOf(key), at: w.clock }); },
    async delete(key) { w.writes.push({ path: pathOf(key), at: w.clock, gone: true }); return store(name).delete(pathOf(key)); },
    async keys() { return [...store(name).keys()].map((p) => new FakeRequest(p)); },
  });
  const listeners = {};
  const realTimer = setTimeout;
  const context = vm.createContext({
    self: {
      addEventListener: (type, fn) => { listeners[type] = fn; },
      skipWaiting: async () => { w.skipped += 1; },
      clients: { claim: async () => { w.claimed += 1; }, matchAll: async () => [{ postMessage: (m) => w.messages.push(JSON.parse(JSON.stringify(m))) }] },
      location: { origin: ORIGIN },
    },
    caches: { open: async (name) => { if (!storage) throw new Error('pretend: no storage here'); return cacheFor(name); }, keys: async () => [...w.stores.keys()], delete: async (name) => w.stores.delete(name) },
    fetch, Request: FakeRequest, Response, Headers, URL, AbortController,
    Date: { now: () => w.clock },
    // Waiting costs no real time here: a short wait just moves the pretend clock on. (The 20 s give-up timer stays real.)
    setTimeout: (fn, ms) => { if (ms >= 10000) { const t = realTimer(fn, ms); t.unref(); return t; } return realTimer(() => { w.clock += ms; fn(); }, 0); },
    clearTimeout,
  });
  vm.runInContext(SOURCE, context, { filename: 'sw.js' });

  // Sends the worker an event and waits for everything it promised (also what it promised later on).
  w.send = (type, props = {}) => {
    const waits = []; const out = { response: null };
    listeners[type]({ ...props, waitUntil: (p) => { waits.push(Promise.resolve(p).catch(() => {})); }, respondWith: (p) => { out.response = Promise.resolve(p); } });
    out.settled = async () => { let n = -1; while (n !== waits.length) { n = waits.length; await Promise.all(waits); } if (out.response) await out.response.catch(() => {}); };
    return out;
  };
  w.open = (path = '/feed/') => w.send('fetch', { request: { url: ORIGIN + path, method: 'GET', mode: 'navigate' } });
  w.get = (path, more = {}) => w.send('fetch', { request: { url: ORIGIN + path, method: 'GET', mode: 'no-cors', ...more } });
  w.install = async () => { await w.send('install').settled(); await w.send('activate').settled(); w.asked.length = 0; w.writes.length = 0; };
  w.saved = (path) => { const hit = store(CACHE).get(path); return hit ? text(hit.body) : null; };
  return w;
}

test('every file the worker saves is really in site/', () => {
  for (const url of [...SHELL, ...FONTS]) assert.ok(existsSync(join(ROOT, 'site', url.endsWith('/') ? `${url}index.html` : url)), `${url} is listed in sw.js but isn't in site/`);
  assert.ok(SHELL.includes('/feed/') && SHELL.includes('/feed/app.js') && SHELL.includes('/feed/feed.css'));
});

test('installing saves the whole page and its fonts, each asked of the server itself', async () => {
  const w = browser();
  await w.send('install').settled();
  assert.deepEqual([...w.stores.get(CACHE).keys()].sort(), [...SHELL, ...FONTS].sort());
  assert.ok(w.asked.length === SHELL.length + FONTS.length && w.asked.every((a) => a.cache === 'no-cache'), 'past the browser’s own cache');
  assert.equal(w.skipped, 1);
  const page = w.stores.get(CACHE).get('/feed/app.js');
  const headers = Object.fromEntries(page.headers);
  assert.equal(headers['cache-control'], 'no-cache', 'what it hands out is marked "ask again", so the browser can’t keep an old script going from memory');
  assert.equal(headers['content-length'], undefined);
  assert.equal(headers['x-from'], 'server', 'the file’s other headers stay');
});

test('taking over clears older saved copies of the feed, and nothing else', async () => {
  const w = browser({ saved: { 'muse-feed-v2': { '/feed/': 'old' }, 'muse-feed-v3': { '/feed/': 'older' }, 'something-else': { '/x': 'not ours' } } });
  await w.send('install').settled();
  await w.send('activate').settled();
  assert.deepEqual([...w.stores.keys()].sort(), [CACHE, 'something-else'].sort());
  assert.equal(w.claimed, 1);
});

test('the page and its files come from the saved copy at once, without waiting for the network', async () => {
  const w = browser(); await w.install();
  let release; w.hold = new Promise((done) => { release = done; }); // the network hangs
  const page = w.open();
  assert.equal(await (await page.response).text(), 'the first /feed/');
  assert.equal(await (await w.open('/feed/?source=homescreen').response).text(), 'the first /feed/', 'whatever comes after a ?');
  for (const path of ['/feed/app.js', '/feed/feed.css', '/assets/fonts/silkscreen-400.woff2']) assert.equal(await (await w.get(path).response).text(), `the first ${path}`);
  w.hold = null; release(); await page.settled();
});

test('the worker leaves the private API, other pages, other sites and its own file alone', async () => {
  const w = browser(); await w.install();
  for (const path of ['/feed/api/feed', '/feed/api/picture?path=pictures/a.png', '/', '/poof/privacy', '/feed/sw.js', '/assets/home.css']) assert.equal(w.get(path).response, null, path);
  assert.equal(w.send('fetch', { request: { url: 'https://example.com/feed/app.js', method: 'GET', mode: 'no-cors' } }).response, null);
  assert.equal(w.send('fetch', { request: { url: `${ORIGIN}/feed/app.js`, method: 'POST', mode: 'cors' } }).response, null);
  assert.deepEqual(w.asked, []);
});

test('an open with nothing new: each page file is asked for once, nothing is rewritten, the page is not told', async () => {
  const w = browser(); await w.install();
  await w.open().settled();
  assert.deepEqual(w.asked.map((a) => a.path).sort(), [...SHELL].sort());
  assert.ok(w.asked.every((a) => a.cache === 'no-cache'));
  assert.deepEqual(w.writes, []); assert.deepEqual(w.messages, []);
});

test('a deploy: the new files go in together, after the opening page has had its own, and the page is told once', async () => {
  const w = browser(); await w.install();
  w.server.set('/feed/app.js', 'the SECOND app.js'); w.server.set('/feed/feed.css', 'the SECOND feed.css');
  const openedAt = w.clock;
  const page = w.open();
  assert.equal(await (await page.response).text(), 'the first /feed/');
  assert.equal(await (await w.get('/feed/app.js').response).text(), 'the first /feed/app.js', 'the page that is opening still gets the set it started with');
  await page.settled();
  assert.equal(w.saved('/feed/app.js'), 'the SECOND app.js'); assert.equal(w.saved('/feed/feed.css'), 'the SECOND feed.css');
  assert.deepEqual(w.writes.map((x) => x.path).sort(), ['/feed/app.js', '/feed/feed.css']);
  assert.ok(w.writes.every((x) => x.at - openedAt >= 2500), 'not before the opening page had time to take its files');
  assert.deepEqual(w.messages, [{ type: 'muse-feed-updated' }]);
  assert.equal(await (await w.get('/feed/app.js').response).text(), 'the SECOND app.js');
  // the next open finds nothing new
  w.messages.length = 0; w.writes.length = 0;
  await w.open().settled();
  assert.deepEqual(w.writes, []); assert.deepEqual(w.messages, []);
});

test('all or nothing: if one file can’t be fetched, the saved copy stays whole and the page is not told', async () => {
  const w = browser(); await w.install();
  w.server.set('/feed/app.js', 'the SECOND app.js'); w.server.set('/feed/', 'the SECOND page');
  w.failing.add('/feed/feed.css');
  await w.open().settled();
  assert.equal(w.saved('/feed/app.js'), 'the first /feed/app.js'); assert.equal(w.saved('/feed/'), 'the first /feed/');
  assert.deepEqual(w.writes, []); assert.deepEqual(w.messages, []);
  w.failing.clear();
  await w.open().settled();
  assert.equal(w.saved('/feed/app.js'), 'the SECOND app.js'); assert.equal(w.saved('/feed/'), 'the SECOND page');
  assert.deepEqual(w.messages, [{ type: 'muse-feed-updated' }]);
});

test('offline: the page still opens from the saved copy, and nothing changes', async () => {
  const w = browser(); await w.install();
  w.down = true;
  const page = w.open();
  assert.equal(await (await page.response).text(), 'the first /feed/');
  assert.equal(await (await w.get('/feed/app.js').response).text(), 'the first /feed/app.js');
  await page.settled();
  assert.deepEqual(w.writes, []); assert.deepEqual(w.messages, []);
  // a file that was never saved has nowhere to come from
  await assert.rejects(w.get('/feed/icon-512.png').response);
});

test('a file the server no longer has is dropped; a missing page, script or style changes nothing', async () => {
  const w = browser(); await w.install();
  w.server.delete('/feed/penguin.gif'); w.server.set('/feed/app.js', 'the SECOND app.js');
  await w.open().settled();
  assert.equal(w.saved('/feed/penguin.gif'), null); assert.equal(w.saved('/feed/app.js'), 'the SECOND app.js');
  assert.deepEqual(w.messages, [{ type: 'muse-feed-updated' }]);
  w.messages.length = 0; w.writes.length = 0;
  w.server.delete('/feed/app.js'); w.server.set('/feed/feed.css', 'the THIRD feed.css'); // a broken deploy
  await w.open().settled();
  assert.equal(w.saved('/feed/app.js'), 'the SECOND app.js'); assert.equal(w.saved('/feed/feed.css'), 'the first /feed/feed.css');
  assert.deepEqual(w.writes, []); assert.deepEqual(w.messages, []);
});

test('the page can ask for a check (when it comes back to the front)', async () => {
  const w = browser(); await w.install();
  await w.send('message', { data: { type: 'something else' } }).settled();
  assert.deepEqual(w.asked, []);
  w.server.set('/feed/app.js', 'the SECOND app.js');
  await w.send('message', { data: { type: 'muse-feed-check' } }).settled();
  assert.equal(w.saved('/feed/app.js'), 'the SECOND app.js');
  assert.deepEqual(w.messages, [{ type: 'muse-feed-updated' }]);
});

test('a new worker over a saved copy (the next version of this file) brings what changed and tells the page', async () => {
  const w = browser({ saved: { [CACHE]: Object.fromEntries([...SHELL, ...FONTS].map((p) => [p, `the first ${p}`])) } });
  w.server.set('/feed/app.js', 'the SECOND app.js');
  await w.send('install').settled();
  assert.equal(w.saved('/feed/app.js'), 'the SECOND app.js');
  assert.deepEqual(w.messages, [{ type: 'muse-feed-updated' }]);
  assert.deepEqual(w.asked.filter((a) => a.path.startsWith('/assets/fonts/')), [], 'fonts that are saved are not fetched again');
});

test('other feed files (another icon) are saved when first used, then refreshed behind the scenes', async () => {
  const w = browser(); await w.install();
  const first = w.get('/feed/icon-512.png');
  assert.equal(await (await first.response).text(), 'the first /feed/icon-512.png');
  await first.settled();
  assert.equal(w.saved('/feed/icon-512.png'), 'the first /feed/icon-512.png');
  w.server.set('/feed/icon-512.png', 'the SECOND icon');
  const second = w.get('/feed/icon-512.png');
  assert.equal(await (await second.response).text(), 'the first /feed/icon-512.png', 'the saved one, at once');
  await second.settled();
  assert.equal(w.saved('/feed/icon-512.png'), 'the SECOND icon', 'and the newer one for next time');
});

test('an error page is passed on as it is and never saved', async () => {
  const w = browser(); await w.install();
  const r = await w.get('/feed/nothing-here.png').response;
  assert.equal(r.status, 404);
  assert.equal(w.saved('/feed/nothing-here.png'), null);
  // another address under /feed/ is not the page: it goes to the server, and offline it falls back to the page
  const other = await w.open('/feed/somewhere').response;
  assert.equal(other.status, 404);
  w.down = true;
  assert.equal(await (await w.open('/feed/somewhere').response).text(), 'the first /feed/');
});

test('on a device with nowhere to save, the worker just passes requests on to the server', async () => {
  const w = browser({ storage: false });
  const page = w.open();
  assert.equal(await (await page.response).text(), 'the first /feed/');
  assert.equal(await (await w.get('/feed/app.js').response).text(), 'the first /feed/app.js');
  await page.settled();
  assert.deepEqual(w.messages, []);
  w.down = true;
  await assert.rejects(w.open().response);
});
