// Muse Feed's API: muselabs.app/feed/api/*, run by Cloudflare Pages Functions
// (functions/feed/api/[[path]].js hands every request here).
//
// - Only Moo gets in. He signs in with GitHub's device flow (the page shows a short code, he approves it on
//   github.com with his passkey) and a signed cookie keeps him signed in for 90 days, renewed as he uses it.
// - The feed lives in his private vault (jasonmuse/muse-os, folder "Notes/Muse Feed"): Claude writes feed.json
//   at each check, and each thing Moo sends becomes replies/<id>.json there. This API reads and writes those
//   through GitHub with a token only it holds, so the page itself never talks to GitHub or Claude.
// - Every send also pings Claude right away (the "⚡ Send to Claude now" task from his Inbox), which answers on
//   the card by writing back into the same reply file. Without the ping key, sends wait for the next check.
//
// Keys (Cloudflare Pages secrets, synced from this repo's GitHub secrets by the deploy):
//   FEED_GITHUB_TOKEN      a fine-grained GitHub token: only muse-os, Contents read and write   (required)
//   FEED_GITHUB_CLIENT_ID  the "Muse Feed" GitHub OAuth app, Device Flow on (not secret)          (required)
//   FEED_FIRE_TOKEN        the ⚡ Inbox button token, so sends reach Claude at once               (optional)

import { clean, cookie, deriveKey, digest, json, parseJSON, readCookies, seal, toB64, unseal, utf8 } from './lib.js';

export const CONFIG = {
  owner: 'jasonmuse',
  repo: 'muse-os',
  branch: 'main',
  dir: 'Notes/Muse Feed',
  userIds: [146852983], // github.com/jasonmuse: the only account that can sign in
  sessionDays: 90,
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

let keyCache = { secret: null, key: null };
async function sessionKey(env) {
  const secret = env.FEED_SESSION_SECRET || env.FEED_GITHUB_TOKEN;
  if (keyCache.secret !== secret) keyCache = { secret, key: await deriveKey(secret, 'muse-feed session v1') };
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
};

export async function handle(request, env = {}, opts = {}) {
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

async function readBody(request) {
  const text = await request.text();
  if (text.length > 20000) throw new HttpError(413, 'too_big');
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
  return { id: p.id, login: String(p.login || ''), exp: p.exp };
}

async function needUser(ctx) {
  const user = await currentUser(ctx);
  if (!user) throw new HttpError(401, 'signin');
  return user;
}

async function sessionCookie(ctx, id, login) {
  const exp = Math.floor(ctx.now / 1000) + CONFIG.sessionDays * DAY;
  return cookie('mf_s', await seal(await sessionKey(ctx.env), { t: 's', id, login, exp }), { maxAge: CONFIG.sessionDays * DAY });
}

function ping(ctx) {
  return json({ ok: true, ready: missing(ctx.env).length === 0 });
}

async function me(ctx) {
  const user = await needUser(ctx);
  const headers = {};
  // Renew as he uses it, so a month away is the only thing that signs him out.
  if (user.exp * 1000 - ctx.now < (CONFIG.sessionDays - 30) * DAY * 1000) headers['set-cookie'] = await sessionCookie(ctx, user.id, user.login);
  return json({ login: user.login }, 200, headers);
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

async function putFile(env, name, content, message, sha) {
  const r = await fetch(`${apiBase(env)}${contentsPath(name)}`, {
    method: 'PUT',
    headers: ghHeaders(env.FEED_GITHUB_TOKEN, { 'content-type': 'application/json' }),
    body: JSON.stringify({ message, content: toB64(utf8(content)), branch: CONFIG.branch, ...(sha ? { sha } : {}) }),
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
  ...(typeof r.pinged === 'boolean' ? { pinged: r.pinged } : {}),
});

async function getFeed(ctx) {
  const user = await needUser(ctx);
  const v = await readVault(ctx.env);
  const out = { user: { login: user.login }, feed: v.feed, prefs: v.prefs, replies: v.replies.slice(0, 60).map(publicReply) };
  const etag = `W/"${await digest(JSON.stringify(out))}"`;
  if (ctx.request.headers.get('if-none-match') === etag) return json(null, 304, { etag });
  return json(out, 200, { etag });
}

// ---------- sending to Claude ----------

function replyId(now) {
  const d = new Date(now).toISOString(); // 2026-11-24T15:32:10.123Z → 20261124-153210-ab12cd (no colons: the vault is on Windows too)
  const rand = [...crypto.getRandomValues(new Uint8Array(3))].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${d.slice(0, 10).replace(/-/g, '')}-${d.slice(11, 19).replace(/:/g, '')}-${rand}`;
}

// One line for the ⚡ task's payload. The words themselves are in the reply file too.
function fireText(r) {
  const one = (s) => String(s).replace(/\s*\n+\s*/g, ' / ');
  if (r.item === 'refresh') return `📰 Muse Feed · ${r.id} · refresh: Moo asked for a fresh feed. Make one now (Wiki/Projects/Muse Feed.md › Work site), then answer this reply.`;
  return `📰 Muse Feed · ${r.id} · about: ${one(r.about || r.item)} · Moo wrote: ${one(r.text)}`.slice(0, 6000);
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

async function send(ctx) {
  await needUser(ctx);
  const b = await readBody(ctx.request);
  const item = clean(b.item, 160) || 'feed';
  const about = clean(b.about, 400);
  const text = clean(b.text, 4000);
  if (!text) throw new HttpError(400, 'empty');
  const refresh = item === 'refresh';
  if (refresh) {
    // One fresh feed at a time: a second tap while Claude's still on the first one doesn't ping again.
    const { replies } = await readVault(ctx.env);
    const open = replies.find((r) => r.item === 'refresh' && r.state !== 'done' && Date.parse(r.at) > ctx.now - 15 * 60e3);
    if (open) return json({ reply: publicReply(open), pinged: false, already: true });
  }
  const reply = { id: replyId(ctx.now), at: new Date(ctx.now).toISOString(), item, about, text, from: 'muselabs.app/feed', state: 'sent', note: '', answeredAt: '' };
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
