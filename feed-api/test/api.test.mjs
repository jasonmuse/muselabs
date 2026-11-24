// Tests for Muse Feed's API with a pretend GitHub and a pretend ⚡ task. Run: node --test feed-api/test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { handle, CONFIG } from '../index.js';

const ORIGIN = 'https://muselabs.app';
const ENV = { FEED_GITHUB_TOKEN: 'vault-token', FEED_GITHUB_CLIENT_ID: 'client-123', FEED_FIRE_TOKEN: 'fire-token' };
const MOO = 146852983;

function fakeWorld() {
  const files = new Map(); // name inside "Notes/Muse Feed" → { text, sha }
  const calls = [];
  const state = { device: 'pending', userId: MOO, fireOk: true, conflictsLeft: 0, graphqlStatus: 200 };
  let shaN = 0;
  const reply = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
  const fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const method = (init.method || 'GET').toUpperCase();
    const headers = new Headers(init.headers || {});
    const body = init.body == null ? '' : String(init.body);
    calls.push({ method, url: url.href, headers, body });
    if (url.href === 'https://github.com/login/device/code') {
      assert.equal(new URLSearchParams(body).get('client_id'), 'client-123');
      return reply({ device_code: 'dev-abc', user_code: 'WDJB-MJHT', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5 });
    }
    if (url.href === 'https://github.com/login/oauth/access_token') {
      const p = new URLSearchParams(body);
      if (p.get('device_code') !== 'dev-abc') return reply({ error: 'incorrect_device_code' });
      assert.equal(p.get('grant_type'), 'urn:ietf:params:oauth:grant-type:device_code');
      if (state.device === 'pending') return reply({ error: 'authorization_pending' });
      if (state.device === 'slow') return reply({ error: 'slow_down', interval: 10 });
      if (state.device === 'denied') return reply({ error: 'access_denied' });
      if (state.device === 'expired') return reply({ error: 'expired_token' });
      return reply({ access_token: 'user-token', token_type: 'bearer', scope: '' });
    }
    if (url.href === 'https://api.github.com/user') {
      assert.equal(headers.get('authorization'), 'Bearer user-token');
      return reply({ login: state.userId === MOO ? 'jasonmuse' : 'someone-else', id: state.userId });
    }
    if (url.href === 'https://api.github.com/graphql') {
      if (headers.get('authorization') !== 'Bearer vault-token') return reply({ message: 'Bad credentials' }, 401);
      if (state.graphqlStatus !== 200) return reply({ message: 'nope' }, state.graphqlStatus);
      const q = JSON.parse(body);
      assert.equal(q.variables.owner, 'jasonmuse');
      assert.equal(q.variables.name, 'muse-os');
      assert.equal(q.variables.feed, 'main:Notes/Muse Feed/feed.json');
      const entries = [...files]
        .filter(([k]) => k.startsWith('replies/'))
        .map(([k, v]) => ({ name: k.slice('replies/'.length), type: 'blob', object: { text: v.text } }));
      return reply({
        data: {
          repository: {
            feed: files.has('feed.json') ? { text: files.get('feed.json').text } : null,
            prefs: files.has('prefs.json') ? { text: files.get('prefs.json').text } : null,
            replies: entries.length ? { entries } : null,
          },
        },
      });
    }
    const m = /^\/repos\/jasonmuse\/muse-os\/contents\/Notes\/Muse%20Feed\/(.+)$/.exec(url.pathname);
    if (url.origin === 'https://api.github.com' && m) {
      assert.equal(headers.get('authorization'), 'Bearer vault-token');
      const name = m[1].split('/').map(decodeURIComponent).join('/');
      const f = files.get(name);
      if (method === 'GET' && f && /raw/.test(headers.get('accept') || '')) return new Response(f.bytes || Buffer.from(f.text), { status: 200 });
      if (method === 'GET') return f ? reply({ sha: f.sha, content: Buffer.from(f.text).toString('base64') }) : reply({ message: 'Not Found' }, 404);
      if (method === 'PUT') {
        const p = JSON.parse(body);
        assert.equal(p.branch, 'main');
        if (state.conflictsLeft > 0) {
          state.conflictsLeft -= 1;
          return reply({ message: 'is at x but expected y' }, 409);
        }
        if ((f && p.sha !== f.sha) || (!f && p.sha)) return reply({ message: 'sha mismatch' }, 409);
        shaN += 1;
        const bytes = Buffer.from(p.content, 'base64');
        files.set(name, { bytes, text: bytes.toString('utf8'), sha: `sha${shaN}` });
        return reply({ content: { sha: `sha${shaN}` } }, f ? 200 : 201);
      }
    }
    if (url.href === CONFIG.fireUrl) {
      assert.equal(headers.get('authorization'), 'Bearer fire-token');
      assert.equal(headers.get('anthropic-beta'), 'experimental-cc-routine-2026-04-01');
      return state.fireOk ? reply({ ok: true }) : reply({ error: 'unauthorized' }, 401);
    }
    throw new Error(`unexpected fetch ${method} ${url.href}`);
  };
  return { files, calls, state, fetch };
}

let world;
test.beforeEach(() => {
  world = fakeWorld();
  globalThis.fetch = world.fetch;
});

async function call(method, path, { body, cookies, origin = ORIGIN, type = 'application/json', env = ENV, now, headers = {} } = {}) {
  const h = new Headers(headers);
  if (method === 'POST') {
    if (origin) h.set('origin', origin);
    if (type) h.set('content-type', type);
  }
  if (cookies) h.set('cookie', Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; '));
  const req = new Request(`${ORIGIN}/feed/api/${path}`, { method, headers: h, body: body == null ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  const res = await handle(req, env, { now });
  const setCookies = res.headers.getSetCookie();
  const jar = {};
  for (const c of setCookies) {
    const kv = c.split(';')[0];
    const i = kv.indexOf('=');
    jar[kv.slice(0, i)] = { value: kv.slice(i + 1), raw: c };
  }
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null, jar, headers: res.headers };
}

async function signIn(opts = {}) {
  const start = await call('POST', 'auth/start', opts);
  assert.equal(start.status, 200);
  world.state.device = 'done';
  const done = await call('POST', 'auth/poll', { ...opts, cookies: { mf_d: start.jar.mf_d.value } });
  assert.equal(done.json.state, 'done');
  return done.jar.mf_s.value;
}

test('ping answers without keys or a sign-in, and says if the keys are there', async () => {
  const bare = await call('GET', 'ping', { env: {} });
  assert.equal(bare.status, 200);
  assert.deepEqual(bare.json, { ok: true, ready: false });
  const ready = await call('GET', 'ping');
  assert.equal(ready.json.ready, true);
});

test('without its keys, the API says what is missing (names only)', async () => {
  const r = await call('GET', 'me', { env: { FEED_GITHUB_TOKEN: 'x' } });
  assert.equal(r.status, 503);
  assert.deepEqual(r.json, { error: 'setup', missing: ['FEED_GITHUB_CLIENT_ID'] });
});

test('nothing private without signing in', async () => {
  assert.equal((await call('GET', 'me')).status, 401);
  assert.equal((await call('GET', 'feed')).status, 401);
  assert.equal((await call('POST', 'send', { body: { text: 'hi' } })).status, 401);
  assert.equal((await call('POST', 'prefs', { body: { weights: {} } })).status, 401);
  assert.equal(world.calls.length, 0);
});

test('a POST from another site, or not as JSON, is refused before anything else', async () => {
  const cross = await call('POST', 'auth/start', { origin: 'https://evil.example' });
  assert.equal(cross.status, 403);
  const noOrigin = await call('POST', 'auth/start', { origin: null });
  assert.equal(noOrigin.status, 403);
  const form = await call('POST', 'auth/start', { type: 'application/x-www-form-urlencoded', body: 'a=b' });
  assert.equal(form.status, 415);
  assert.equal(world.calls.length, 0);
});

test('unknown paths and methods are 404', async () => {
  assert.equal((await call('GET', 'nope')).status, 404);
  assert.equal((await call('DELETE', 'feed')).status, 404);
  assert.equal((await call('GET', 'send')).status, 404);
});

test('signing in with GitHub: code, waiting, slow down, then a 90-day cookie', async () => {
  const now = Date.UTC(2026, 10, 24, 15, 0, 0);
  const start = await call('POST', 'auth/start', { now });
  assert.equal(start.status, 200);
  assert.equal(start.json.code, 'WDJB-MJHT');
  assert.equal(start.json.url, 'https://github.com/login/device');
  assert.equal(start.json.interval, 5);
  const dev = start.jar.mf_d;
  assert.match(dev.raw, /Path=\/feed\/api\/auth; Max-Age=900; HttpOnly; Secure; SameSite=Strict/);

  const wait = await call('POST', 'auth/poll', { now, cookies: { mf_d: dev.value } });
  assert.deepEqual(wait.json, { state: 'pending', interval: 5 });

  world.state.device = 'slow';
  const slow = await call('POST', 'auth/poll', { now, cookies: { mf_d: dev.value } });
  assert.equal(slow.json.state, 'pending');
  assert.equal(slow.json.interval, 10);
  assert.ok(slow.jar.mf_d, 'the slower pace is remembered');

  world.state.device = 'done';
  const done = await call('POST', 'auth/poll', { now, cookies: { mf_d: slow.jar.mf_d.value } });
  assert.equal(done.status, 200);
  assert.deepEqual(done.json, { state: 'done', login: 'jasonmuse' });
  assert.match(done.jar.mf_s.raw, /Path=\/feed; Max-Age=7776000; HttpOnly; Secure; SameSite=Strict/);
  assert.match(done.jar.mf_d.raw, /Max-Age=0/);

  const meNow = await call('GET', 'me', { now, cookies: { mf_s: done.jar.mf_s.value } });
  assert.equal(meNow.status, 200);
  assert.deepEqual(meNow.json, { login: 'jasonmuse' });
  assert.equal(meNow.jar.mf_s, undefined, 'a fresh cookie is not renewed yet');

  const later = await call('GET', 'me', { now: now + 40 * 864e5, cookies: { mf_s: done.jar.mf_s.value } });
  assert.equal(later.status, 200);
  assert.ok(later.jar.mf_s, 'renewed after a month');

  const gone = await call('GET', 'me', { now: now + 91 * 864e5, cookies: { mf_s: done.jar.mf_s.value } });
  assert.equal(gone.status, 401);
});

test('someone else signing in with GitHub gets nothing', async () => {
  world.state.userId = 999;
  const start = await call('POST', 'auth/start');
  world.state.device = 'done';
  const r = await call('POST', 'auth/poll', { cookies: { mf_d: start.jar.mf_d.value } });
  assert.equal(r.status, 403);
  assert.equal(r.json.state, 'not-you');
  assert.equal(r.jar.mf_s, undefined);
});

test('denied, expired and missing codes end the sign-in', async () => {
  const start = await call('POST', 'auth/start');
  world.state.device = 'denied';
  assert.equal((await call('POST', 'auth/poll', { cookies: { mf_d: start.jar.mf_d.value } })).json.state, 'denied');
  world.state.device = 'expired';
  assert.equal((await call('POST', 'auth/poll', { cookies: { mf_d: start.jar.mf_d.value } })).json.state, 'expired');
  assert.equal((await call('POST', 'auth/poll')).json.state, 'expired');
  const late = await call('POST', 'auth/poll', { now: Date.now() + 16 * 60e3, cookies: { mf_d: start.jar.mf_d.value } });
  assert.equal(late.json.state, 'expired');
});

test('forged, swapped or re-keyed cookies are refused', async () => {
  const good = await signIn();
  const [body, sig] = good.split('.');
  const forged = Buffer.from(JSON.stringify({ t: 's', id: MOO, login: 'jasonmuse', exp: 4102444800 })).toString('base64url');
  assert.equal((await call('GET', 'me', { cookies: { mf_s: `${forged}.${sig}` } })).status, 401);
  const flipped = `${sig.slice(0, 5)}${sig[5] === 'A' ? 'B' : 'A'}${sig.slice(6)}`; // always a different signature
  assert.equal((await call('GET', 'me', { cookies: { mf_s: `${body}.${flipped}` } })).status, 401);
  assert.equal((await call('GET', 'me', { cookies: { mf_s: 'garbage' } })).status, 401);
  const start = await call('POST', 'auth/start');
  assert.equal((await call('GET', 'me', { cookies: { mf_s: start.jar.mf_d.value } })).status, 401, 'a sign-in code cookie is not a session');
  const rotated = { ...ENV, FEED_GITHUB_TOKEN: 'a-new-vault-token' };
  assert.equal((await call('GET', 'me', { env: rotated, cookies: { mf_s: good } })).status, 401, 'a new vault key signs everyone out');
  assert.equal((await call('GET', 'me', { cookies: { mf_s: good } })).status, 200);
});

test('signing out clears the cookie', async () => {
  const r = await call('POST', 'auth/out');
  assert.equal(r.status, 200);
  assert.match(r.jar.mf_s.raw, /mf_s=; Path=\/feed; Max-Age=0/);
});

test('the feed comes from the vault in one GitHub call, newest replies first, with an ETag', async () => {
  const s = await signIn();
  world.files.set('feed.json', { text: JSON.stringify({ v: 1, updated: '2026-11-24T14:00:00Z', items: [{ id: 'a', title: 'Hi' }] }), sha: 'f1' });
  world.files.set('prefs.json', { text: JSON.stringify({ weights: { 'world-games': 2 } }), sha: 'p1' });
  world.files.set('replies/20261124-140000-aaaaaa.json', { text: JSON.stringify({ id: '20261124-140000-aaaaaa', at: '2026-11-24T14:00:00.000Z', item: 'a', text: 'older', state: 'done', note: 'Done!', secret: 'x' }), sha: 'r1' });
  world.files.set('replies/20261124-150000-bbbbbb.json', { text: JSON.stringify({ id: '20261124-150000-bbbbbb', at: '2026-11-24T15:00:00.000Z', item: 'b', text: 'newer', state: 'weird' }), sha: 'r2' });
  world.files.set('replies/notes.txt', { text: 'not json', sha: 'r3' });
  world.calls.length = 0;
  const r = await call('GET', 'feed', { cookies: { mf_s: s } });
  assert.equal(r.status, 200);
  assert.equal(world.calls.length, 1);
  assert.equal(r.json.feed.items[0].title, 'Hi');
  assert.deepEqual(r.json.prefs.weights, { 'world-games': 2 });
  assert.deepEqual(r.json.replies.map((x) => x.text), ['newer', 'older']);
  assert.equal(r.json.replies[0].state, 'sent', 'odd states read as sent');
  assert.equal(r.json.replies[1].secret, undefined, 'only known fields go out');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const etag = r.headers.get('etag');
  assert.ok(etag);
  const again = await call('GET', 'feed', { cookies: { mf_s: s }, headers: { 'if-none-match': etag } });
  assert.equal(again.status, 304);
});

test('an empty vault folder is fine', async () => {
  const s = await signIn();
  const r = await call('GET', 'feed', { cookies: { mf_s: s } });
  assert.equal(r.status, 200);
  assert.equal(r.json.feed, null);
  assert.deepEqual(r.json.replies, []);
});

test('a vault key GitHub refuses says so (no details leak)', async () => {
  const s = await signIn();
  world.state.graphqlStatus = 401;
  const r = await call('GET', 'feed', { cookies: { mf_s: s } });
  assert.equal(r.status, 503);
  assert.equal(r.json.error, 'vault_key');
});

test('sending saves a reply file in the vault and pings Claude with it', async () => {
  const s = await signIn();
  const now = Date.UTC(2026, 10, 24, 15, 32, 10);
  world.calls.length = 0;
  const r = await call('POST', 'send', { now, cookies: { mf_s: s }, body: { item: 'w:w-1124-03', about: '[World] Godot 4.8 is out', text: '  more like this\r\nplease  ' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.pinged, true);
  assert.match(r.json.reply.id, /^20261124-153210-[0-9a-f]{6}$/);
  const name = `replies/${r.json.reply.id}.json`;
  const saved = JSON.parse(world.files.get(name).text);
  assert.equal(saved.text, 'more like this\nplease');
  assert.equal(saved.item, 'w:w-1124-03');
  assert.equal(saved.state, 'sent');
  assert.equal(saved.from, 'muselabs.app/feed');
  const put = world.calls.find((c) => c.method === 'PUT');
  assert.equal(JSON.parse(put.body).message, 'feed: a reply from Moo on Muse Feed');
  const fire = world.calls.find((c) => c.url === CONFIG.fireUrl);
  const text = JSON.parse(fire.body).text;
  assert.ok(text.startsWith(`📰 Muse Feed · ${r.json.reply.id} · about: [World] Godot 4.8 is out · Moo wrote: more like this / please`));
});

test('a send still saves when the ping fails or there is no ping key', async () => {
  const s = await signIn();
  world.state.fireOk = false;
  const a = await call('POST', 'send', { cookies: { mf_s: s }, body: { text: 'one' } });
  assert.equal(a.status, 200);
  assert.equal(a.json.pinged, false);
  const { FEED_FIRE_TOKEN, ...noFire } = ENV;
  const b = await call('POST', 'send', { env: noFire, cookies: { mf_s: s }, body: { text: 'two' } });
  assert.equal(b.json.pinged, false);
  assert.equal([...world.files.keys()].filter((k) => k.startsWith('replies/')).length, 2);
  assert.equal(JSON.parse(world.files.get(`replies/${a.json.reply.id}.json`).text).item, 'feed');
});

test('empty, huge or broken sends are refused', async () => {
  const s = await signIn();
  assert.equal((await call('POST', 'send', { cookies: { mf_s: s }, body: { text: '   ' } })).status, 400);
  assert.equal((await call('POST', 'send', { cookies: { mf_s: s }, body: 'not json' })).status, 400);
  assert.equal((await call('POST', 'send', { cookies: { mf_s: s }, body: { text: 'x'.repeat(12_200_000) } })).status, 413);
  const long = await call('POST', 'send', { cookies: { mf_s: s }, body: { text: 'y'.repeat(5000), item: 'i'.repeat(500) } });
  assert.equal(long.status, 200);
  assert.equal(long.json.reply.text.length, 4000);
  assert.equal(long.json.reply.item.length, 160);
});

test('a second Refresh while Claude is on the first one does not ping again', async () => {
  const s = await signIn();
  const now = Date.now();
  const first = await call('POST', 'send', { now, cookies: { mf_s: s }, body: { item: 'refresh', about: 'Refresh', text: 'A fresh feed, please' } });
  assert.equal(first.json.pinged, true);
  const fire = world.calls.filter((c) => c.url === CONFIG.fireUrl);
  assert.match(JSON.parse(fire[0].body).text, /refresh: Moo asked for a fresh feed/);
  const second = await call('POST', 'send', { now: now + 60e3, cookies: { mf_s: s }, body: { item: 'refresh', text: 'again' } });
  assert.equal(second.json.already, true);
  assert.equal(second.json.reply.id, first.json.reply.id);
  assert.equal(world.calls.filter((c) => c.url === CONFIG.fireUrl).length, 1);
  const later = await call('POST', 'send', { now: now + 20 * 60e3, cookies: { mf_s: s }, body: { item: 'refresh', text: 'later' } });
  assert.equal(later.json.pinged, true, 'after 15 minutes it can ask again');
});

test('👍/👎 are cleaned up and saved as prefs.json, only when they change', async () => {
  const s = await signIn();
  const r = await call('POST', 'prefs', { cookies: { mf_s: s }, body: { weights: { 'world-games': 2, 'mail-dev': -9, 'Bad Key': 1, zero: 0, 'new-user': 'x', 'agent-needs': 7 } } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.weights, { 'agent-needs': 5, 'mail-dev': -3, 'world-games': 2 });
  const saved = JSON.parse(world.files.get('prefs.json').text);
  assert.deepEqual(saved.weights, { 'agent-needs': 5, 'mail-dev': -3, 'world-games': 2 });
  const puts = () => world.calls.filter((c) => c.method === 'PUT').length;
  const before = puts();
  const same = await call('POST', 'prefs', { cookies: { mf_s: s }, body: { weights: { 'world-games': 2, 'mail-dev': -3, 'agent-needs': 5 } } });
  assert.equal(same.json.unchanged, true);
  assert.equal(puts(), before);
});

test('prefs try again when the vault moved underneath', async () => {
  const s = await signIn();
  world.files.set('prefs.json', { text: JSON.stringify({ weights: {} }), sha: 'old' });
  world.state.conflictsLeft = 2;
  const r = await call('POST', 'prefs', { cookies: { mf_s: s }, body: { weights: { 'world-music': 1 } } });
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(world.files.get('prefs.json').text).weights, { 'world-music': 1 });
});

test('keys with a stray newline from a terminal still work', async () => {
  const env = { FEED_GITHUB_TOKEN: 'vault-token\n', FEED_GITHUB_CLIENT_ID: ' client-123\r\n', FEED_FIRE_TOKEN: 'fire-token\n' };
  const start = await call('POST', 'auth/start', { env });
  assert.equal(start.status, 200);
  world.state.device = 'done';
  const done = await call('POST', 'auth/poll', { env, cookies: { mf_d: start.jar.mf_d.value } });
  const s = done.jar.mf_s.value;
  const r = await call('POST', 'send', { env, cookies: { mf_s: s }, body: { text: 'hi' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.pinged, true);
  assert.equal((await call('GET', 'me', { cookies: { mf_s: s } })).status, 200, 'the same session works with the tidy keys');
});

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1]).toString('base64');

test('pictures in a send are checked, saved next to the reply, and named in the ping', async () => {
  const s = await signIn();
  const now = Date.UTC(2026, 10, 24, 17, 0, 0);
  const r = await call('POST', 'send', { now, cookies: { mf_s: s }, body: { item: 'gist', about: 'What matters', text: 'look at this', pictures: [{ type: 'image/png', data: PNG }, { data: JPG }] } });
  assert.equal(r.status, 200);
  const id = r.json.reply.id;
  assert.deepEqual(r.json.reply.pictures, [`pictures/${id}-1.png`, `pictures/${id}-2.jpg`]);
  assert.ok(world.files.get(`pictures/${id}-1.png`).bytes.equals(Buffer.from(PNG, 'base64')), 'the picture is saved byte for byte');
  assert.deepEqual(JSON.parse(world.files.get(`replies/${id}.json`).text).pictures, [`pictures/${id}-1.png`, `pictures/${id}-2.jpg`]);
  const fire = JSON.parse(world.calls.find((c) => c.url === CONFIG.fireUrl).body).text;
  assert.match(fire, /with 2 pictures \(Notes\/Muse Feed\/pictures\/.*-1\.png, Notes\/Muse Feed\/pictures\/.*-2\.jpg\)$/);
});

test('a picture alone is a send; fakes, too many and too big are refused', async () => {
  const s = await signIn();
  const alone = await call('POST', 'send', { cookies: { mf_s: s }, body: { text: '', pictures: [{ data: PNG }] } });
  assert.equal(alone.status, 200);
  const notImage = Buffer.from('<svg onload=alert(1)>').toString('base64');
  assert.equal((await call('POST', 'send', { cookies: { mf_s: s }, body: { text: 'x', pictures: [{ data: notImage }] } })).status, 400);
  assert.equal((await call('POST', 'send', { cookies: { mf_s: s }, body: { text: 'x', pictures: [{ data: 'not base64!' }] } })).status, 400);
  assert.equal((await call('POST', 'send', { cookies: { mf_s: s }, body: { text: 'x', pictures: Array(5).fill({ data: PNG }) } })).status, 400);
  const big = PNG + 'A'.repeat(3_000_000 - PNG.length + 4);
  assert.equal((await call('POST', 'send', { cookies: { mf_s: s }, body: { text: 'x', pictures: [{ data: big }] } })).status, 400);
  assert.equal([...world.files.keys()].filter((k) => k.startsWith('pictures/')).length, 1, 'nothing refused was saved');
});

test('pictures come back only signed in, only from the pictures folder, with the right type', async () => {
  const s = await signIn();
  world.files.set('pictures/20261124-170000-aaaaaa-1.png', { bytes: Buffer.from(PNG, 'base64'), text: '', sha: 'p' });
  assert.equal((await call('GET', 'picture?path=pictures/20261124-170000-aaaaaa-1.png')).status, 401);
  for (const bad of ['feed.json', 'replies/x.json', 'pictures/../feed.json', 'pictures/a.svg', 'pictures/a b.png', '../../AGENTS.md']) {
    assert.equal((await call('GET', `picture?path=${encodeURIComponent(bad)}`, { cookies: { mf_s: s } })).status, 400, bad);
  }
  assert.equal((await call('GET', 'picture?path=pictures/missing.png', { cookies: { mf_s: s } })).status, 404);
  const req = new Request(`${ORIGIN}/feed/api/picture?path=pictures/20261124-170000-aaaaaa-1.png`, { headers: { cookie: `mf_s=${s}` } });
  const res = await handle(req, ENV);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.match(res.headers.get('cache-control'), /^private/);
  assert.ok(Buffer.from(await res.arrayBuffer()).equals(Buffer.from(PNG, 'base64')));
});

test('replies show only real picture paths', async () => {
  const s = await signIn();
  world.files.set('replies/20261124-150000-cccccc.json', { text: JSON.stringify({ id: '20261124-150000-cccccc', at: '2026-11-24T15:00:00.000Z', item: 'a', text: 'hi', state: 'done', note: 'ok', pictures: ['pictures/x-1.png', '../../secret.png', 5], notePictures: ['pictures/answer.jpg', 'http://evil/x.png'] }), sha: 'r' });
  const r = await call('GET', 'feed', { cookies: { mf_s: s } });
  assert.deepEqual(r.json.replies[0].pictures, ['pictures/x-1.png']);
  assert.deepEqual(r.json.replies[0].notePictures, ['pictures/answer.jpg']);
});
