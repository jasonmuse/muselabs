// Muse Feed's API: muselabs.app/feed/api/*, run by Cloudflare Pages Functions
// (functions/feed/api/[[path]].js hands every request here).
//
// - Only Moo gets in. He signs in with GitHub's device flow (the page shows a short code, he approves it on
//   github.com with his passkey) and a signed cookie keeps him signed in for 90 days, renewed as he uses it,
//   up to 180 days after signing in. A new FEED_SESSION_EPOCH signs every device out at once.
// - The feed lives in his private vault (jasonmuse/muse-os, folder "Notes/Muse Feed"): Claude writes feed.json
//   at each check, and each thing Moo sends becomes replies/<id>.json there. This API reads and writes those
//   through GitHub with a token only it holds, so the page itself never talks to GitHub or Claude.
// - Every send also pings Claude right away (the "⚡ Send to Claude now" task from his Inbox), which answers on
//   the card by writing back into the same reply file. The ping says only which reply to open, never the words.
//   Without the ping key, sends wait for the next check.
//
// Keys (on Cloudflare Pages, production only; the deploy copies them from this repo's GitHub secrets and variables):
//   FEED_GITHUB_TOKEN      a fine-grained GitHub token: only muse-os, Contents read and write   (required)
//   FEED_GITHUB_CLIENT_ID  the "Muse Feed" GitHub OAuth app, Device Flow on (not secret)          (required)
//   FEED_FIRE_TOKEN        the ⚡ Inbox button token, so sends reach Claude at once               (optional)
//   FEED_SESSION_SECRET    signs the sign-in cookies; without it they're signed with the vault key (optional)
//   FEED_SESSION_EPOCH     any word or date; change it to sign every device out (not secret)      (optional)

import { clean, cookie, deriveKey, digest, json, parseJSON, readCookies, seal, toB64, unseal, utf8 } from './lib.js';

export const CONFIG = {
  owner: 'jasonmuse',
  repo: 'muse-os',
  branch: 'main',
  dir: 'Notes/Muse Feed',
  userIds: [146852983], // github.com/jasonmuse: the only account that can sign in
  sessionDays: 90, // a device stays signed in this long after he last used it
  maxSessionDays: 180, // and never longer than this after signing in, however much it's used
  // The most one sign-in can send, as [seconds, sends]: plenty for Moo, far too little to flood the vault or the ⚡ task.
  sendLimits: [[10 * 60, 20], [24 * 3600, 200]],
  picturesPerDay: 60, // pictures are the heavy part of a send (up to 4 each, about 2 MB apiece)
  fireUrl: 'https://api.anthropic.com/v1/claude_code/routines/trig_01HXMS7NrdShy2RXk6v8wd5B/fire',
};

const REQUIRED = ['FEED_GITHUB_TOKEN', 'FEED_GITHUB_CLIENT_ID'];
const UA = 'muse-feed (muselabs.app/feed)';
const DAY = 86400;
const STATES = ['sent', 'working', 'done'];

class HttpError extends Error {
  constructor(status, code, detail) {
    super(code);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

const missing = (env) => REQUIRED.filter((k) => !env[k]);
const apiBase = (env) => env.FEED_GITHUB_API || 'https://api.github.com';
const webBase = (env) => env.FEED_GITHUB_WEB || 'https://github.com';
const allowedIds = (env) =>
  env.FEED_GITHUB_USER_IDS ? String(env.FEED_GITHUB_USER_IDS).split(',').map((s) => Number(s.trim())).filter(Boolean) : CONFIG.userIds;

// The key that signs the cookies comes from FEED_SESSION_SECRET (until that's set, from the vault key) and from
// FEED_SESSION_EPOCH. Change either one and every cookie signed before it stops working, on every device.
let keyCache = { from: null, key: null };
async function sessionKey(env) {
  const secret = env.FEED_SESSION_SECRET || env.FEED_GITHUB_TOKEN;
  const epoch = env.FEED_SESSION_EPOCH || '';
  const from = JSON.stringify([secret, epoch]);
  if (keyCache.from !== from) keyCache = { from, key: await deriveKey(secret, epoch ? `muse-feed session v1 · epoch ${epoch}` : 'muse-feed session v1') };
  return keyCache.key;
}

const ROUTES = {
  'GET ping': ping,
  'GET me': me,
  'POST auth/start': authStart,
  'POST auth/poll': authPoll,
  'POST auth/out': authOut,
  'GET feed': getFeed,
  'POST send': send,
  'POST prefs': savePrefs,
  'GET picture': picture,
};

// Keys pasted through a terminal can carry a stray newline or space; never let that break a header.
function tidyEnv(env) {
  const out = { ...env };
  for (const [k, v] of Object.entries(out)) if (k.startsWith('FEED_') && typeof v === 'string') out[k] = v.trim();
  return out;
}

export async function handle(request, rawEnv = {}, opts = {}) {
  const env = tidyEnv(rawEnv);
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/feed\/api\/?/, '').replace(/\/+$/, '');
  const route = ROUTES[`${request.method} ${path}`];
  if (!route) return json({ error: 'not_found' }, 404);
  const ctx = { request, env, url, now: opts.now ?? Date.now(), cookies: readCookies(request) };
  try {
    if (request.method === 'POST') guardPost(request, url);
    if (route !== ping) {
      const lack = missing(env);
      if (lack.length) return json({ error: 'setup', missing: lack }, 503);
    }
    return await route(ctx);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.code, ...(e.detail ? { detail: e.detail } : {}) }, e.status);
    return json({ error: 'server' }, 500);
  }
}

// A POST has to come from the feed page itself: same origin, sent as JSON (which other sites can't do without asking).
function guardPost(request, url) {
  if (request.headers.get('origin') !== url.origin) throw new HttpError(403, 'wrong_origin');
  if (!/^application\/json\b/i.test(request.headers.get('content-type') || '')) throw new HttpError(415, 'json_only');
}

async function readBody(request, max = 20000) {
  const text = await request.text();
  if (text.length > max) throw new HttpError(413, 'too_big');
  if (!text) return {};
  const v = parseJSON(text);
  if (!v || Array.isArray(v)) throw new HttpError(400, 'bad_json');
  return v;
}

// ---------- signing in ----------

async function currentUser(ctx) {
  const token = ctx.cookies.get('mf_s');
  if (!token) return null;
  const p = await unseal(await sessionKey(ctx.env), token);
  if (!p || p.t !== 's' || typeof p.exp !== 'number' || p.exp * 1000 <= ctx.now) return null;
  if (!allowedIds(ctx.env).includes(p.id)) return null;
  // `iat` is when he signed in. A cookie made before cookies carried it counts from its last renewal.
  const iat = typeof p.iat === 'number' ? p.iat : p.exp - CONFIG.sessionDays * DAY;
  if ((iat + CONFIG.maxSessionDays * DAY) * 1000 <= ctx.now) return null;
  return { id: p.id, login: String(p.login || ''), exp: p.exp, iat };
}

async function needUser(ctx) {
  const user = await currentUser(ctx);
  if (!user) throw new HttpError(401, 'signin');
  return user;
}

// A sign-in ends 90 days after its last renewal, and at the latest 180 days after it began.
const sessionEnd = (now, iat) => Math.min(Math.floor(now / 1000) + CONFIG.sessionDays * DAY, iat + CONFIG.maxSessionDays * DAY);

async function sessionCookie(ctx, id, login, iat = Math.floor(ctx.now / 1000)) {
  const exp = sessionEnd(ctx.now, iat);
  return cookie('mf_s', await seal(await sessionKey(ctx.env), { t: 's', id, login, iat, exp }), { maxAge: exp - Math.floor(ctx.now / 1000) });
}

function ping(ctx) {
  return json({ ok: true, ready: missing(ctx.env).length === 0 });
}

// Renew as he uses it (once the cookie is a month old), so only three months away signs him out,
// or reaching the maximum age: then he signs in again.
async function renewal(ctx, user) {
  if (user.exp * 1000 - ctx.now >= (CONFIG.sessionDays - 30) * DAY * 1000) return {};
  if (sessionEnd(ctx.now, user.iat) - user.exp < DAY) return {}; // it already runs to the maximum age
  return { 'set-cookie': await sessionCookie(ctx, user.id, user.login, user.iat) };
}

async function me(ctx) {
  const user = await needUser(ctx);
  return json({ login: user.login }, 200, await renewal(ctx, user));
}

async function github(env, path, params) {
  const r = await fetch(`${webBase(env)}${path}`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded', 'user-agent': UA },
    body: new URLSearchParams({ client_id: env.FEED_GITHUB_CLIENT_ID, ...params }),
  });
  const j = parseJSON(await r.text()) || {};
  if (!r.ok && !j.error) throw new HttpError(502, 'github', `sign-in ${r.status}`);
  return j;
}

async function authStart(ctx) {
  const j = await github(ctx.env, '/login/device/code', {});
  if (!j.device_code || !j.user_code) throw new HttpError(502, 'github', j.error || 'no code');
  const life = Math.max(60, Math.min(Number(j.expires_in) || 900, 900));
  const interval = Math.max(5, Math.min(Number(j.interval) || 5, 30));
  const exp = Math.floor(ctx.now / 1000) + life;
  const sealed = await seal(await sessionKey(ctx.env), { t: 'd', dc: j.device_code, exp, iv: interval });
  return json(
    { code: String(j.user_code), url: 'https://github.com/login/device', interval, expires: exp * 1000 },
    200,
    { 'set-cookie': cookie('mf_d', sealed, { path: '/feed/api/auth', maxAge: life }) },
  );
}

async function authPoll(ctx) {
  const key = await sessionKey(ctx.env);
  const d = await unseal(key, ctx.cookies.get('mf_d'));
  const clear = cookie('mf_d', '', { path: '/feed/api/auth', maxAge: 0 });
  if (!d || d.t !== 'd' || typeof d.dc !== 'string' || d.exp * 1000 <= ctx.now) return json({ state: 'expired' }, 200, { 'set-cookie': clear });
  const j = await github(ctx.env, '/login/oauth/access_token', {
    device_code: d.dc,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
  });
  if (j.error === 'authorization_pending') return json({ state: 'pending', interval: d.iv });
  if (j.error === 'slow_down') {
    const iv = Math.min(Math.max(Number(j.interval) || d.iv + 5, d.iv + 5), 60);
    const again = await seal(key, { ...d, iv });
    return json({ state: 'pending', interval: iv }, 200, {
      'set-cookie': cookie('mf_d', again, { path: '/feed/api/auth', maxAge: d.exp - Math.floor(ctx.now / 1000) }),
    });
  }
  if (j.error === 'expired_token') return json({ state: 'expired' }, 200, { 'set-cookie': clear });
  if (j.error === 'access_denied') return json({ state: 'denied' }, 200, { 'set-cookie': clear });
  if (j.error || !j.access_token) throw new HttpError(502, 'github', j.error || 'no token');

  const r = await fetch(`${apiBase(ctx.env)}/user`, { headers: ghHeaders(j.access_token) });
  if (!r.ok) throw new HttpError(502, 'github', `user ${r.status}`);
  const who = parseJSON(await r.text()) || {};
  if (!allowedIds(ctx.env).includes(who.id)) return json({ state: 'not-you', login: String(who.login || '') }, 403, { 'set-cookie': clear });
  return json({ state: 'done', login: String(who.login || '') }, 200, {
    'set-cookie': [clear, await sessionCookie(ctx, who.id, String(who.login || ''))],
  });
}

function authOut() {
  return json({ ok: true }, 200, { 'set-cookie': cookie('mf_s', '', { maxAge: 0 }) });
}

// ---------- the vault on GitHub ----------

function ghHeaders(token, extra = {}) {
  return {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': UA,
    ...extra,
  };
}

const contentsPath = (name) =>
  `/repos/${CONFIG.owner}/${CONFIG.repo}/contents/${[...CONFIG.dir.split('/'), ...name.split('/')].map(encodeURIComponent).join('/')}`;

function vaultTrouble(status, what) {
  if (status === 401 || status === 403) return new HttpError(503, 'vault_key', status === 401 ? 'GitHub refused the vault key' : 'the vault key has no access');
  return new HttpError(502, 'github', `${what} ${status}`);
}

const VAULT_QUERY = `query($owner: String!, $name: String!, $feed: String!, $prefs: String!, $replies: String!) {
  repository(owner: $owner, name: $name) {
    feed: object(expression: $feed) { ... on Blob { text } }
    prefs: object(expression: $prefs) { ... on Blob { text } }
    replies: object(expression: $replies) { ... on Tree { entries { name type object { ... on Blob { text } } } } }
  }
}`;

// One GitHub call for everything the page shows: the feed, his 👍/👎 and every reply with its answer.
async function readVault(env) {
  const at = (p) => `${CONFIG.branch}:${CONFIG.dir}/${p}`;
  const r = await fetch(`${apiBase(env)}/graphql`, {
    method: 'POST',
    headers: ghHeaders(env.FEED_GITHUB_TOKEN, { 'content-type': 'application/json' }),
    body: JSON.stringify({
      query: VAULT_QUERY,
      variables: { owner: CONFIG.owner, name: CONFIG.repo, feed: at('feed.json'), prefs: at('prefs.json'), replies: at('replies') },
    }),
  });
  if (!r.ok) throw vaultTrouble(r.status, 'read');
  const j = parseJSON(await r.text()) || {};
  const repo = j.data && j.data.repository;
  if (!repo) throw new HttpError(503, 'vault_key', 'the vault key can’t see muse-os');
  const entries = repo.replies && Array.isArray(repo.replies.entries) ? repo.replies.entries : [];
  const replies = entries
    .filter((e) => e && e.type === 'blob' && /\.json$/.test(e.name))
    .map((e) => parseJSON(e.object && e.object.text))
    .filter((x) => x && typeof x.id === 'string')
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  return { feed: parseJSON(repo.feed && repo.feed.text), prefs: parseJSON(repo.prefs && repo.prefs.text), replies };
}

async function getFile(env, name) {
  const r = await fetch(`${apiBase(env)}${contentsPath(name)}?ref=${CONFIG.branch}`, { headers: ghHeaders(env.FEED_GITHUB_TOKEN) });
  if (r.status === 404) return null;
  if (!r.ok) throw vaultTrouble(r.status, 'get');
  const j = parseJSON(await r.text()) || {};
  let text = null;
  try {
    text = typeof j.content === 'string' ? new TextDecoder().decode(Uint8Array.from(atob(j.content.replace(/\n/g, '')), (c) => c.charCodeAt(0))) : null;
  } catch {
    text = null;
  }
  return { sha: j.sha || null, text };
}

async function putFile(env, name, content, message, sha, { base64 = false } = {}) {
  const r = await fetch(`${apiBase(env)}${contentsPath(name)}`, {
    method: 'PUT',
    headers: ghHeaders(env.FEED_GITHUB_TOKEN, { 'content-type': 'application/json' }),
    body: JSON.stringify({ message, content: base64 ? content : toB64(utf8(content)), branch: CONFIG.branch, ...(sha ? { sha } : {}) }),
  });
  if (r.status === 409 || r.status === 422) throw new HttpError(409, 'conflict');
  if (!r.ok) throw vaultTrouble(r.status, 'save');
}

const publicReply = (r) => ({
  id: String(r.id || ''),
  at: String(r.at || ''),
  item: String(r.item || ''),
  about: String(r.about || ''),
  text: String(r.text || ''),
  state: STATES.includes(r.state) ? r.state : 'sent',
  note: String(r.note || ''),
  answeredAt: String(r.answeredAt || ''),
  pictures: picturePaths(r.pictures),
  notePictures: picturePaths(r.notePictures),
  ...(typeof r.pinged === 'boolean' ? { pinged: r.pinged } : {}),
});

// Pictures live in the vault at Notes/Muse Feed/pictures/; replies and feed items name them as "pictures/<file>".
const PICTURE_PATH = /^pictures\/[A-Za-z0-9._-]{1,120}\.(jpe?g|png|webp|gif)$/;
const picturePaths = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && PICTURE_PATH.test(x)).slice(0, 8) : []);
const PICTURE_TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };

// What the bytes really are (never trust the name or the page's word for it).
function sniffImage(b64) {
  let head;
  try {
    head = Uint8Array.from(atob(b64.slice(0, 24)), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
  const is = (...bytes) => bytes.every((b, i) => head[i] === b);
  if (is(0xff, 0xd8, 0xff)) return 'jpg';
  if (is(0x89, 0x50, 0x4e, 0x47)) return 'png';
  if (is(0x47, 0x49, 0x46, 0x38)) return 'gif';
  if (is(0x52, 0x49, 0x46, 0x46) && head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50) return 'webp';
  return null;
}

async function picture(ctx) {
  await needUser(ctx);
  const path = ctx.url.searchParams.get('path') || '';
  if (!PICTURE_PATH.test(path)) throw new HttpError(400, 'bad_path');
  const r = await fetch(`${apiBase(ctx.env)}${contentsPath(path)}?ref=${CONFIG.branch}`, {
    headers: ghHeaders(ctx.env.FEED_GITHUB_TOKEN, { accept: 'application/vnd.github.raw' }),
  });
  if (r.status === 404) throw new HttpError(404, 'not_found');
  if (!r.ok) throw vaultTrouble(r.status, 'picture');
  const ext = path.split('.').pop().toLowerCase();
  return new Response(r.body, {
    status: 200,
    headers: {
      'content-type': PICTURE_TYPES[ext],
      'cache-control': 'private, max-age=86400',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'",
      'referrer-policy': 'no-referrer',
    },
  });
}

async function getFeed(ctx) {
  const user = await needUser(ctx);
  const v = await readVault(ctx.env);
  const out = { user: { login: user.login }, feed: v.feed, prefs: v.prefs, replies: v.replies.slice(0, 60).map(publicReply) };
  const etag = `W/"${await digest(JSON.stringify(out))}"`;
  const headers = { etag, ...(await renewal(ctx, user)) };
  if (ctx.request.headers.get('if-none-match') === etag) return json(null, 304, headers);
  return json(out, 200, headers);
}

// ---------- sending to Claude ----------

function replyId(now) {
  const d = new Date(now).toISOString(); // 2026-11-24T15:32:10.123Z → 20261124-153210-ab12cd (no colons: the vault is on Windows too)
  const rand = [...crypto.getRandomValues(new Uint8Array(3))].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${d.slice(0, 10).replace(/-/g, '')}-${d.slice(11, 19).replace(/:/g, '')}-${rand}`;
}

// One line for the ⚡ task's payload. It says only which reply to open: the id, which is made here, and words
// that are written here. Nothing the page sent goes in it, so text from a card (a headline, a mail subject,
// someone's feedback) can never arrive looking like Moo's words. His words and the card they're about stay in
// the reply file, each in its own field.
function fireText(r) {
  if (r.item === 'refresh') return `📰 Muse Feed · ${r.id} · refresh: Moo asked for a fresh feed. Make one now (Wiki/Projects/Muse Feed.md › Work site), then answer this reply.`;
  return `📰 Muse Feed · ${r.id} · reply: Moo sent something on Muse Feed. His words and what they're about are in ${CONFIG.dir}/replies/${r.id}.json (only "text" is his; the rest is card text). Answer in that file.`;
}

// When a reply was sent: its id starts with the time this API made it (20261124-153210-…), and `at` says the same.
function sentAt(r) {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-/.exec(String(r.id));
  const t = m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : Date.parse(r.at);
  return Number.isFinite(t) ? t : 0;
}

// The send limit, counted from the replies already in the vault (so there's nothing extra to keep, and nothing
// to reset). Says how many seconds until the next send fits, or 0 when this one does.
function sendWait(replies, now, pictures = 0) {
  const sent = replies.map((r) => ({ t: sentAt(r), pictures: picturePaths(r.pictures).length })).filter((s) => s.t > 0 && s.t <= now + 60e3).sort((a, b) => b.t - a.t);
  let wait = 0;
  for (const [seconds, max] of CONFIG.sendLimits) {
    const recent = sent.filter((s) => s.t > now - seconds * 1000);
    if (recent.length >= max) wait = Math.max(wait, Math.ceil((recent[max - 1].t + seconds * 1000 - now) / 1000));
  }
  if (pictures) {
    // Pictures are the heavy part of a send, so they have a day's allowance of their own.
    const day = sent.filter((s) => s.t > now - DAY * 1000);
    let room = CONFIG.picturesPerDay - pictures;
    for (const s of day) {
      room -= s.pictures;
      if (room < 0) { wait = Math.max(wait, Math.ceil((s.t + DAY * 1000 - now) / 1000)); break; }
    }
  }
  return Math.max(0, wait);
}

async function pingClaude(env, text) {
  if (!env.FEED_FIRE_TOKEN) return false;
  try {
    const r = await fetch(env.FEED_FIRE_URL || CONFIG.fireUrl, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.FEED_FIRE_TOKEN}`,
        'anthropic-beta': 'experimental-cc-routine-2026-04-01',
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ text }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

const MAX_PICTURES = 4;
const MAX_PICTURE_B64 = 3_000_000; // about 2.2 MB of picture; the page shrinks them to 1600 px first

// Pictures pasted or attached in the reply box: checked, then saved next to the reply in the vault.
function takePictures(list) {
  if (list == null) return [];
  if (!Array.isArray(list) || list.length > MAX_PICTURES) throw new HttpError(400, 'pictures');
  return list.map((p) => {
    const data = p && typeof p.data === 'string' ? p.data.replace(/\s+/g, '') : '';
    if (!data || data.length > MAX_PICTURE_B64 || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new HttpError(400, 'pictures');
    const ext = sniffImage(data);
    if (!ext) throw new HttpError(400, 'pictures');
    return { data, ext };
  });
}

async function send(ctx) {
  await needUser(ctx);
  const b = await readBody(ctx.request, MAX_PICTURES * MAX_PICTURE_B64 + 40000);
  const item = clean(b.item, 160) || 'feed';
  const about = clean(b.about, 400);
  const text = clean(b.text, 4000);
  const pics = takePictures(b.pictures);
  if (!text && !pics.length) throw new HttpError(400, 'empty');
  const refresh = item === 'refresh';
  const { replies } = await readVault(ctx.env);
  if (refresh) {
    // One fresh feed at a time: a second tap while Claude's still on the first one doesn't ping again.
    const open = replies.find((r) => r.item === 'refresh' && r.state !== 'done' && Date.parse(r.at) > ctx.now - 15 * 60e3);
    if (open) return json({ reply: publicReply(open), pinged: false, already: true });
  }
  // Before anything is saved or pinged: is this sign-in sending more than Moo ever would?
  const wait = sendWait(replies, ctx.now, pics.length);
  if (wait) return json({ error: 'too_many', wait }, 429, { 'retry-after': String(wait) });
  const id = replyId(ctx.now);
  const pictures = [];
  for (const [i, pic] of pics.entries()) {
    const name = `pictures/${id}-${i + 1}.${pic.ext}`;
    await putFile(ctx.env, name, pic.data, 'feed: a picture from Moo on Muse Feed', null, { base64: true });
    pictures.push(name);
  }
  const reply = { id, at: new Date(ctx.now).toISOString(), item, about, text, from: 'muselabs.app/feed', state: 'sent', note: '', answeredAt: '', ...(pictures.length ? { pictures } : {}) };
  await putFile(
    ctx.env,
    `replies/${reply.id}.json`,
    `${JSON.stringify(reply, null, 2)}\n`,
    refresh ? 'feed: Moo asked for a fresh feed' : 'feed: a reply from Moo on Muse Feed',
  );
  const pinged = await pingClaude(ctx.env, fireText(reply));
  return json({ reply: publicReply({ ...reply, pinged }), pinged });
}

// ---------- 👍 / 👎 ----------

async function savePrefs(ctx) {
  await needUser(ctx);
  const b = await readBody(ctx.request);
  const weights = {};
  const given = b.weights && typeof b.weights === 'object' && !Array.isArray(b.weights) ? Object.entries(b.weights) : [];
  for (const [k, v] of given.slice(0, 200)) {
    if (!/^[a-z0-9][a-z0-9-]{0,60}$/.test(k)) continue;
    const n = Math.round(Number(v));
    if (Number.isFinite(n) && n !== 0) weights[k] = Math.max(-3, Math.min(5, n));
  }
  const sorted = Object.fromEntries(Object.entries(weights).sort(([a], [b2]) => a.localeCompare(b2)));
  for (let tries = 0; ; tries++) {
    const cur = await getFile(ctx.env, 'prefs.json');
    const was = parseJSON(cur && cur.text);
    if (was && JSON.stringify(was.weights || {}) === JSON.stringify(sorted)) return json({ ok: true, weights: sorted, unchanged: true });
    const content = `${JSON.stringify({ weights: sorted, updated: new Date(ctx.now).toISOString(), from: 'muselabs.app/feed' }, null, 2)}\n`;
    try {
      await putFile(ctx.env, 'prefs.json', content, 'feed: Moo tuned Muse Feed (👍/👎)', cur && cur.sha);
      return json({ ok: true, weights: sorted });
    } catch (e) {
      if (!(e instanceof HttpError && e.code === 'conflict') || tries >= 2) throw e;
    }
  }
}
