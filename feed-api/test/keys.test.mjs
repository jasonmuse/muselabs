// Tests for scripts/feed-keys.sh (how Muse Feed's keys reach Cloudflare) with a pretend Cloudflare:
// a stand-in `curl` on the PATH that keeps the Pages project's variables in a file. Run: node --test feed-api/test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'feed-keys.sh');
const hasTools = spawnSync('bash', ['-c', 'command -v jq']).status === 0;
const opts = { skip: hasTools ? false : 'needs bash and jq' };

// The stand-in curl: understands just what the script uses (-X, -o, -w, -H, --data-binary @-, the URL).
const FAKE_CURL = `#!/usr/bin/env node
const fs = require('fs');
const a = process.argv.slice(2);
let method = 'GET'; let out = null; let url = ''; let auth = ''; let hasBody = false;
for (let i = 0; i < a.length; i++) {
  if (a[i] === '-X') method = a[++i];
  else if (a[i] === '-o') out = a[++i];
  else if (a[i] === '-w') i++;
  else if (a[i] === '-H') { const h = a[++i]; if (/^authorization:/i.test(h)) auth = h; }
  else if (a[i] === '--data-binary') hasBody = a[++i] === '@-';
  else if (a[i] !== '-s') url = a[i];
}
const state = JSON.parse(fs.readFileSync(process.env.FAKE_CF_STATE, 'utf8'));
const body = hasBody ? fs.readFileSync(0, 'utf8') : '';
state.calls.push({ method, url, auth, body });
const fail = (state.fail || []).includes(method + ' ' + state.calls.filter((c) => c.method === method).length);
let status = 200; let answer;
if (fail) { status = 400; answer = { success: false, errors: [{ message: 'pretend trouble' }] }; }
else {
  if (method === 'PATCH') {
    const want = JSON.parse(body).deployment_configs || {};
    for (const side of ['production', 'preview']) {
      for (const [k, v] of Object.entries((want[side] || {}).env_vars || {})) {
        if (v === null) delete state[side][k]; else state[side][k] = { type: v.type, value: v.type === 'secret_text' ? '' : v.value };
      }
    }
  }
  const sides = (o) => ({ env_vars: o });
  answer = { success: true, errors: [], result: { name: 'muselabs', deployment_configs: { production: sides(state.production), preview: sides(state.preview) } } };
}
fs.writeFileSync(process.env.FAKE_CF_STATE, JSON.stringify(state));
if (out) fs.writeFileSync(out, JSON.stringify(answer));
process.stdout.write(String(status));
`;

const KEYS = { FEED_GITHUB_TOKEN: 'vault-key-VALUE', FEED_FIRE_TOKEN: 'fire-token-VALUE', FEED_SESSION_SECRET: 'session-secret-VALUE', FEED_GITHUB_CLIENT_ID: 'client-123' };
const old = (type) => ({ type, value: type === 'secret_text' ? '' : 'client-123' });

function run({ event = 'push', ref = 'refs/heads/main', keys = KEYS, production = {}, preview = {}, fail = [], cf = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'feed-keys-'));
  writeFileSync(join(dir, 'curl'), FAKE_CURL);
  chmodSync(join(dir, 'curl'), 0o755);
  const stateFile = join(dir, 'state.json');
  writeFileSync(stateFile, JSON.stringify({ production, preview, calls: [], fail }));
  const summary = join(dir, 'summary.md');
  const env = {
    PATH: `${dir}:${process.env.PATH}`, FAKE_CF_STATE: stateFile, GITHUB_STEP_SUMMARY: summary,
    GITHUB_EVENT_NAME: event, GITHUB_REF: ref, PAGES_PROJECT: 'muselabs',
    ...(cf ? { CF_TOKEN: 'cf-token-VALUE', CF_ACCOUNT: 'acct' } : {}), ...keys,
  };
  const r = spawnSync('bash', [SCRIPT], { env, encoding: 'utf8' });
  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  return { code: r.status, log: r.stdout + r.stderr, summary: existsSync(summary) ? readFileSync(summary, 'utf8') : '', ...state };
}
const sentTo = (r, side) => r.calls.filter((c) => c.method === 'PATCH').map((c) => JSON.parse(c.body).deployment_configs[side]).filter(Boolean).map((x) => x.env_vars);
const noValues = (text) => { for (const v of ['vault-key-VALUE', 'fire-token-VALUE', 'session-secret-VALUE', 'cf-token-VALUE']) assert.ok(!text.includes(v), `a key's value is in the log or summary`); };

test('keys only travel with a push to main: a pull request, a manual run or another branch sends nothing', opts, () => {
  for (const [event, ref] of [['pull_request', 'refs/pull/9/merge'], ['workflow_dispatch', 'refs/heads/main'], ['push', 'refs/heads/some-branch'], ['pull_request_target', 'refs/heads/main']]) {
    const r = run({ event, ref });
    assert.equal(r.code, 0);
    assert.equal(r.calls.length, 0, `${event} on ${ref} reached Cloudflare`);
    assert.match(r.log, /only travel with a push to main/);
  }
});

test('production gets the keys; previews get none and lose the ones they had', opts, () => {
  const had = { FEED_GITHUB_TOKEN: old('secret_text'), FEED_FIRE_TOKEN: old('secret_text'), FEED_GITHUB_CLIENT_ID: old('plain_text'), SOMETHING_ELSE: old('plain_text') };
  const r = run({ production: { ...had }, preview: { ...had } });
  assert.equal(r.code, 0);
  assert.deepEqual(sentTo(r, 'production'), [{
    FEED_GITHUB_TOKEN: { type: 'secret_text', value: 'vault-key-VALUE' },
    FEED_FIRE_TOKEN: { type: 'secret_text', value: 'fire-token-VALUE' },
    FEED_SESSION_SECRET: { type: 'secret_text', value: 'session-secret-VALUE' },
    FEED_GITHUB_CLIENT_ID: { type: 'plain_text', value: 'client-123' },
  }]);
  assert.deepEqual(sentTo(r, 'preview'), [{ FEED_FIRE_TOKEN: null, FEED_GITHUB_CLIENT_ID: null, FEED_GITHUB_TOKEN: null }], 'previews are only ever sent nulls');
  assert.deepEqual(Object.keys(r.preview), ['SOMETHING_ELSE'], 'and other variables are left alone');
  assert.deepEqual(Object.keys(r.production).sort(), ['FEED_FIRE_TOKEN', 'FEED_GITHUB_CLIENT_ID', 'FEED_GITHUB_TOKEN', 'FEED_SESSION_SECRET', 'SOMETHING_ELSE']);
  assert.ok(r.calls.every((c) => c.auth === 'Authorization: Bearer cf-token-VALUE' && c.url === 'https://api.cloudflare.com/client/v4/accounts/acct/pages/projects/muselabs'));
  assert.match(r.log, /production only/);
  assert.match(r.log, /previews hold no keys/);
  assert.match(r.summary, /keys on previews: none/);
  noValues(r.log + r.summary);
});

test('a sign-out-everywhere epoch goes to production as a plain variable', opts, () => {
  const r = run({ keys: { ...KEYS, FEED_SESSION_EPOCH: '2026-11-26' } });
  assert.deepEqual(sentTo(r, 'production')[0].FEED_SESSION_EPOCH, { type: 'plain_text', value: '2026-11-26' });
  assert.deepEqual(sentTo(r, 'preview'), [], 'nothing to clear, so previews are not touched');
});

test('keys that are not on GitHub stay as they are; previews are still cleared', opts, () => {
  const r = run({ keys: {}, production: { FEED_GITHUB_TOKEN: old('secret_text') }, preview: { FEED_GITHUB_TOKEN: old('secret_text') } });
  assert.equal(r.code, 0);
  assert.deepEqual(sentTo(r, 'production'), []);
  assert.deepEqual(Object.keys(r.production), ['FEED_GITHUB_TOKEN']);
  assert.deepEqual(Object.keys(r.preview), []);
  assert.match(r.log, /no keys on GitHub yet/);
});

test('if Cloudflare will not clear a preview key, the run says so loudly and the deploy goes on', opts, () => {
  const r = run({ preview: { FEED_GITHUB_TOKEN: old('secret_text') }, fail: ['PATCH 2'] });
  assert.equal(r.code, 0);
  assert.match(r.log, /::warning title=Muse Feed keys::Cloudflare didn't clear Muse Feed's keys from previews \(HTTP 400: pretend trouble\)/);
  assert.match(r.log, /::warning title=Muse Feed keys::Previews still hold FEED_GITHUB_TOKEN/);
  assert.doesNotMatch(r.summary, /previews: none/);
  noValues(r.log + r.summary);
});

test('if it cannot look at the project, it clears every name it knows', opts, () => {
  const r = run({ preview: { FEED_GITHUB_TOKEN: old('secret_text') }, fail: ['GET 1'] });
  assert.deepEqual(sentTo(r, 'preview'), [{ FEED_GITHUB_TOKEN: null, FEED_FIRE_TOKEN: null, FEED_SESSION_SECRET: null, FEED_GITHUB_CLIENT_ID: null, FEED_SESSION_EPOCH: null }]);
  assert.deepEqual(Object.keys(r.preview), []);
});

test('when Cloudflare refuses the keys, it warns without failing the deploy; without Cloudflare’s own keys it does nothing', opts, () => {
  const refused = run({ fail: ['PATCH 1'] });
  assert.equal(refused.code, 0);
  assert.match(refused.log, /::warning title=Muse Feed keys::Cloudflare didn't take Muse Feed's keys \(HTTP 400: pretend trouble\)/);
  noValues(refused.log);
  const bare = run({ cf: false });
  assert.equal(bare.code, 0);
  assert.equal(bare.calls.length, 0);
});
