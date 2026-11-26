// Muse Feed (muselabs.app/feed): the page. It only talks to its own API (/feed/api/*), which signs Moo in
// with GitHub, reads the feed Muse OS keeps in his vault, and hands anything he sends to Muse OS.
// On the page the agent goes by Muse OS (Moo, Nov 25: "instead of claude, can u call urself muse os for all this
// stuff pls"); only the words changed, the API's fields and the data keep their names.
(() => {
  'use strict';

  // iPhone Safari only shows a button's pressed look (:active) on a page that listens for touches. The grey
  // tap flash is switched off here, so without this line a press on an iPhone would get no answer at all.
  document.addEventListener('touchstart', () => {}, { passive: true });

  const $ = (s, r = document) => r.querySelector(s);
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'style') n.style.cssText = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : String(v));
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      n.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return n;
  };
  const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));
  const arr = (v) => (Array.isArray(v) ? v : []);
  const safeUrl = (u) => (/^https:\/\/[^\s]+$/i.test(str(u)) ? str(u) : null);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const toast = (t) => {
    if (morphing) { morphing.finished.then(() => toast(t), () => toast(t)); return; } // after the cards land, on top of them
    const b = $('#toast');
    const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
    clearTimeout(toast.h); clearTimeout(toast.out); clearTimeout(toast.s);
    if (toast.over) b.removeEventListener('animationend', toast.over);
    const put = () => { b.textContent = t; b.classList.remove('closing', 'swap'); };
    if (!calm && !b.hidden && !b.classList.contains('closing') && b.textContent !== t) {
      // One is already up: its words fade out, then the new ones fade in, so the box changes size out of sight.
      toast.over = (e) => {
        if (e && e.animationName !== 'toastDim') return;
        b.removeEventListener('animationend', toast.over); clearTimeout(toast.s);
        put(); b.classList.add('back');
      };
      b.addEventListener('animationend', toast.over);
      toast.s = setTimeout(() => toast.over(), 400); // (in case the fade never ran)
      b.classList.remove('back'); b.classList.add('swap');
    } else {
      put(); b.classList.remove('back');
      b.hidden = false;
    }
    toast.h = setTimeout(() => {
      if (calm) { b.hidden = true; return; }
      b.classList.remove('swap', 'back'); b.classList.add('closing');
      toast.out = setTimeout(() => { b.classList.remove('closing'); b.hidden = true; }, 190);
    }, 3600);
  };

  // ---------- aurora (dark, or light when the device is) ----------
  (() => {
    const c = $('#aurora'); const ctx = c.getContext('2d'); let w = 0; let h = 0; const S = 0.25;
    const light = matchMedia('(prefers-color-scheme: light)');
    const blobs = [
      { col: [167, 123, 255], r: 0.55, ax: 0.28, ay: 0.18, sx: 0.00011, sy: 0.00017, px: 0.2, py: 0.15 },
      { col: [63, 224, 197], r: 0.45, ax: 0.32, ay: 0.22, sx: 0.00008, sy: 0.00012, px: 0.8, py: 0.35 },
      { col: [255, 111, 174], r: 0.40, ax: 0.25, ay: 0.25, sx: 0.00013, sy: 0.00009, px: 0.5, py: 0.85 },
      { col: [106, 162, 255], r: 0.35, ax: 0.30, ay: 0.20, sx: 0.00010, sy: 0.00014, px: 0.15, py: 0.7 },
    ];
    let stamp = 4000;
    const size = () => { w = Math.max(1, Math.round(innerWidth * S)); h = Math.max(1, Math.round(innerHeight * S)); c.width = w; c.height = h; };
    const draw = (t) => {
      const lit = light.matches;
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = lit ? '#f5f2fd' : '#0a0913'; ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = lit ? 'source-over' : 'lighter';
      for (const b of blobs) {
        const x = (b.px + Math.sin(t * b.sx) * b.ax) * w; const y = (b.py + Math.cos(t * b.sy) * b.ay) * h;
        const rad = b.r * Math.max(w, h);
        const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
        g.addColorStop(0, `rgba(${b.col},${lit ? 0.2 : 0.3})`); g.addColorStop(1, `rgba(${b.col},0)`);
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      }
      ctx.globalCompositeOperation = 'source-over';
    };
    size(); draw(stamp);
    c.classList.add('on'); // drawn: it fades in (feed.css)
    addEventListener('resize', () => { size(); draw(stamp); });
    if (light.addEventListener) light.addEventListener('change', () => draw(stamp));
    if (reduced) return;
    let last = 0;
    const loop = (t) => { if (!document.hidden && t - last > 50) { stamp = t + 4000; draw(stamp); last = t; } requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  })();

  // ---------- time ----------
  const HOUR = 36e5;
  const now = () => Date.now();
  const ago = (t) => {
    const s = Math.round((now() - t) / 1000);
    if (s < -60) { const m = Math.round(-s / 60); if (m < 60) return `in ${m} min`; const hh = Math.round(m / 60); return hh < 24 ? `in ${hh}h` : `in ${Math.round(hh / 24)} days`; }
    if (s < 60) return 'just now'; const m = Math.round(s / 60); if (m < 60) return `${m} min ago`;
    const hh = Math.floor(m / 60); if (hh < 24) return `${hh}h ago`; const d = Math.round(hh / 24); return d === 1 ? 'yesterday' : `${d} days ago`;
  };
  const clock = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s/g, '').toLowerCase();
  const dayName = (t) => new Date(t).toLocaleDateString([], { weekday: 'short' });
  const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
  const when = (t) => (sameDay(t, now()) ? clock(t) : `${dayName(t)} ${clock(t)}`);
  const parseTime = (s) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(s));
    return m ? new Date(+m[1], +m[2] - 1, +m[3], 0, 0).getTime() : Date.parse(str(s)) || 0;
  };
  // Muse OS's checks: 4:43am, 12:39pm and 8:39pm (Eastern, like Moo).
  const nextCheck = () => {
    const d = new Date();
    for (const [hh, mm] of [[4, 43], [12, 39], [20, 39]]) {
      const t = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh, mm).getTime();
      if (t > now()) return clock(t);
    }
    return clock(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 4, 43).getTime());
  };

  // ---------- sources and kinds ----------
  const SOURCES = {
    muse: { label: 'Muse Shelf', dot: 'var(--violet)' },
    feedback: { label: 'Feedback', dot: 'var(--pink)' },
    shelf: { label: 'Your shelf', dot: 'var(--amber)' },
    world: { label: 'World', dot: 'var(--orchid)' },
    cal: { label: 'Calendar', dot: 'var(--sky)' },
    mail: { label: 'Mail', dot: 'var(--coral)' },
    agents: { label: 'Your agents', dot: 'var(--aqua)' },
    vault: { label: 'Muse OS', dot: 'var(--violet)' },
  };
  const KINDS = {
    'new-user': { base: 6, label: 'new people on Muse Shelf' },
    users: { base: 4, label: 'Muse Shelf numbers' },
    gift: { base: 3, label: 'Muse Pro gifts ending' },
    feedback: { base: 7, label: 'new feedback' },
    reply: { base: 4, label: 'feedback waiting on you' },
    'shelf-done': { base: 4, label: 'things you finished' },
    'shelf-start': { base: 3, label: 'things you started' },
    'shelf-progress': { base: 2, label: 'progress on your shelf' },
    'shelf-added': { base: 2, label: 'things you added' },
    'shelf-soon': { base: 4, label: 'releases coming to your shelf' },
    'mail-app': { base: 3, label: 'App Store and TestFlight mail' },
    'mail-dev': { base: 2, label: 'GitHub and dev mail' },
    'mail-social': { base: 2, label: 'ads and social mail' },
    'mail-events': { base: 2, label: 'event invites' },
    'agent-needs': { base: 5, label: 'agents that need you' },
    agent: { base: 2, label: 'what your agents did' },
    today: { base: 5, label: 'reminders for today' },
    event: { base: 3, label: 'calendar things' },
  };
  const kindInfo = (k) => KINDS[k] || (k.startsWith('world-') ? { base: 3, label: `${k.slice(6).replace(/-/g, ' ')} news` } : { base: 2, label: 'this' });

  // ---------- state ----------
  let signedIn = false; let login = '';
  let live = false; let etag = null; let loading = false; let timer = null; let everLoaded = false;
  const items = new Map();
  let shelfNow = []; let events = []; let matters = ''; let updatedAt = 0;
  let replies = [];
  const mine = new Map(); // replies sent from this page that the vault hasn't shown yet
  let prefs = { weights: {} }; let prefsDirty = false; let prefsTimer = null;
  let filter = 'all';
  try { filter = localStorage.getItem('musefeed.filter') || 'all'; } catch { /* fine */ }
  let seenBefore = null; const newIds = new Set();
  try { const raw = localStorage.getItem('musefeed.seen'); if (raw) seenBefore = new Set(JSON.parse(raw)); } catch { seenBefore = null; }
  // Shelf titles open in Muse Shelf: the app on an iPhone or iPad, the web app anywhere else.
  const SHELF_ID = /^[A-Za-z0-9_-]{1,80}$/;
  const IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const shelfHref = (id) => (IOS ? `jasonmuse-mediatracker://item/${encodeURIComponent(id)}` : `https://muse-media-tracker.jasonmuse.workers.dev/item/${encodeURIComponent(id)}`);
  const shelfId = (v) => (SHELF_ID.test(str(v)) ? str(v) : '');
  // "What matters right now" folds away and stays folded on this device.
  let gistFolded = false;
  try { gistFolded = localStorage.getItem('musefeed.gistFolded') === '1'; } catch { /* fine */ }
  const setGistFold = (on) => { $('#gist').classList.toggle('folded', on); $('#gist-fold').setAttribute('aria-expanded', String(!on)); };
  setGistFold(gistFolded);
  const openFolds = new Set(); // "earlier" folds Moo opened; they stay open until he folds them again
  const shown = new Set();
  const synth = 'speechSynthesis' in window ? window.speechSynthesis : null;
  const weight = (kind) => Number(prefs.weights[kind] || 0);
  const muted = (kind) => weight(kind) <= -3;

  // Liquid, never pops (Moo, Nov 24: "buttery smooth sleek liquid everything always"): every change of what's on
  // screen morphs (View Transitions where the browser has them, so cards glide to their new places), the last feed
  // shows at once while a fresh one loads, and a first visit gets shimmering placeholders instead of an empty box.
  const canMorph = typeof document.startViewTransition === 'function' && !reduced;
  let morphing = null; // the view transition that's running, if any
  // While there are words in a box the page doesn't freeze for a morph, so typing never lags.
  const typing = () => { const a = document.activeElement; return !!a && a.tagName === 'TEXTAREA' && a.value.trim() !== ''; };
  function smooth(fn, sending = false) {
    if (!canMorph || document.hidden || (!sending && typing()) || !$('#sheet').hidden || !$('#lightbox').hidden) { fn(); return; }
    let vt;
    try { vt = document.startViewTransition(fn); } catch { fn(); return; }
    morphing = vt;
    const done = () => { if (morphing === vt) morphing = null; };
    vt.finished.then(done, done);
    if (vt.ready) vt.ready.catch(() => {});
  }
  const smoothPaint = () => smooth(paint);
  const vtName = (id) => { let h = 5381; for (const ch of str(id)) h = ((h * 33) ^ ch.codePointAt(0)) >>> 0; return `c${h.toString(36)}`; };
  // A morph holds the screen for a moment, and a tap in that moment lands on the page itself instead of the
  // button under the finger, so it used to be lost. Now such a tap ends the morph and is passed on to what's
  // really there. (Only a tap: a finger that comes down to scroll doesn't cut a morph short.)
  let downInMorph = 0;
  addEventListener('pointerdown', () => { if (morphing) downInMorph = now(); }, true);
  addEventListener('click', (e) => {
    if (!e.isTrusted || e.target !== document.documentElement) return;
    const late = now() - downInMorph < 1500; downInMorph = 0;
    if (!morphing && !late) return;
    const { clientX: x, clientY: y } = e;
    const pass = () => {
      const under = document.elementFromPoint(x, y);
      const hit = under && under.closest('button, a, textarea, input, label, summary');
      if (!hit) return;
      if (hit.tagName === 'TEXTAREA') hit.focus(); else hit.click();
    };
    if (morphing) { const vt = morphing; vt.skipTransition(); vt.finished.then(pass, pass); } else pass();
  }, true);
  // The last feed, kept on this device for a day so the page opens full, never empty. Signing out clears it.
  const CACHE = 'musefeed.last';
  // It's saved with the API's stamp for it (etag), so the next open can ask "anything newer than this?".
  const saveCache = (data) => { try { localStorage.setItem(CACHE, JSON.stringify({ at: now(), etag, data })); } catch { /* fine */ } };
  const dropCache = () => { try { localStorage.removeItem(CACHE); } catch { /* fine */ } };
  const readCache = () => {
    try { const c = JSON.parse(localStorage.getItem(CACHE) || 'null'); return c && c.data && now() - c.at < 864e5 ? c : null; } catch { return null; }
  };
  // A 👍 changes the order on screen at once; the saved feed takes it too, so the next open starts from what he left.
  const savedPrefs = (weights) => {
    try { const c = JSON.parse(localStorage.getItem(CACHE) || 'null'); if (!c || !c.data) return; c.data.prefs = { ...c.data.prefs, weights: { ...weights } }; c.etag = null; localStorage.setItem(CACHE, JSON.stringify(c)); } catch { /* fine */ }
  };
  // Leaving the screen gets a short exit too, not a blink.
  function hideSoftly(node, after) {
    clearTimeout(node.hideTimer);
    if (reduced || node.hidden) { node.hidden = true; if (after) after(); return; }
    node.classList.add('closing');
    node.hideTimer = setTimeout(() => { node.classList.remove('closing'); node.hidden = true; if (after) after(); }, 190);
  }
  function showSoftly(node) { clearTimeout(node.hideTimer); node.classList.remove('closing'); node.hidden = false; }
  // A line that comes and goes (an error, the offline note, pictures waiting to send) opens and closes its own
  // space, so nothing below it jumps.
  const reveal = (wrap, on) => { wrap.classList.toggle('on', on); wrap.firstElementChild.inert = !on; };
  // A label that changes (live → "from 2:04pm · 4h ago") rolls into the new words and eases to its new width.
  function morphText(box, text, instant = false) {
    const cur = box.querySelector(':scope > .mt');
    if (!cur) { box.replaceChildren(el('span', { class: 'mt', text })); return; }
    if (cur.textContent === text) return;
    for (const old of box.querySelectorAll(':scope > .mt-out')) old.remove();
    if (instant || reduced || document.hidden || !box.getClientRects().length) { cur.textContent = text; return; }
    const w0 = box.getBoundingClientRect().width;
    cur.className = 'mt-out'; cur.setAttribute('aria-hidden', 'true');
    const next = el('span', { class: 'mt mt-in', text });
    box.append(next);
    const w1 = box.getBoundingClientRect().width;
    if (Math.abs(w1 - w0) > 0.5 && box.animate) box.animate([{ width: `${w0}px` }, { width: `${w1}px` }], { duration: 380, easing: 'cubic-bezier(.2,.8,.2,1)' });
    setTimeout(() => { cur.remove(); next.classList.remove('mt-in'); }, 400);
  }

  async function api(path, { method = 'GET', body, headers = {}, keepalive = false } = {}) {
    const init = { method, credentials: 'same-origin', cache: 'no-store', headers: { ...headers }, keepalive };
    if (body !== undefined) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(body); }
    let r;
    try { r = await fetch(`/feed/api/${path}`, init); } catch { return { status: 0, offline: true, data: null }; }
    let data = null;
    if (r.status !== 304) { try { data = await r.json(); } catch { data = null; } }
    return { status: r.status, data, etag: r.headers.get('etag') };
  }

  // ---------- screens ----------
  function screen(name, instant) {
    const go = () => {
      $('#gate').hidden = name !== 'gate';
      $('#setup').hidden = name !== 'setup';
      $('#app').hidden = name !== 'app';
      setStatus();
    };
    if (instant || !$(`#${name}`).hidden) go(); else smooth(go);
  }
  function showGate(message) {
    signedIn = false; live = false; clearTimeout(timer); dropCache(); statusNote = 'Signed out';
    const reset = () => {
      $('#signin').hidden = false; $('#signin').disabled = false; morphText($('#signin-t'), 'Sign in with GitHub', true);
      $('#codebox').hidden = true;
      gateMessage(message || '');
    };
    // Coming from the feed, the card is made ready out of sight and the screens morph. Already on the card
    // (the code ran out, GitHub said no), the card itself morphs to its new shape instead of jumping.
    if ($('#gate').hidden) { reset(); screen('gate'); } else smooth(() => { reset(); setStatus(); });
  }
  function gateMessage(text) { $('#gate-err').textContent = text; $('#gate-err').hidden = !text; }
  function showSetup(missing) {
    signedIn = false; live = false; clearTimeout(timer); statusNote = 'Not set up yet';
    screen('setup');
    $('#setup-missing').textContent = arr(missing).length ? `Missing: ${arr(missing).join(', ')}.` : '';
  }
  function enter(user) {
    signedIn = true; statusNote = ''; login = str(user && user.login) || login;
    $('#who').textContent = login ? `Signed in as @${login}` : 'Signed in';
    screen('app');
    if (!items.size) skeleton();
    load(true);
  }

  // Opens full: the last feed right away (or shimmering placeholders the first time), then one call that both
  // checks the sign-in and brings the fresh feed, which morphs in (or says the saved one is still the latest).
  // A retry (nothing saved, and the feed couldn't be reached) leaves the screen as it is until an answer comes.
  let again = null;
  async function boot(retry = false) {
    const saved = readCache(); const cached = saved && saved.data;
    again = null;
    if (!retry) {
      // The top of the page eases in together with the cards, once (feed.css › #app.first). Not when the page
      // has just loaded a new version of itself (the worker's doing, marked "quiet"): it was live a moment ago,
      // so everything, the greeting and the status line too, is simply there again.
      const quiet = document.documentElement.classList.contains('quiet');
      $('#app').classList.add('first'); setTimeout(() => $('#app').classList.remove('first'), 1200);
      greet(quiet);
      if (cached) {
        signedIn = true; login = str(cached.user && cached.user.login);
        $('#who').textContent = login ? `Signed in as @${login}` : 'Signed in';
        statusNote = quiet ? '' : 'Updating'; live = quiet;
        screen('app', true); apply(cached, true);
      } else {
        statusNote = 'Opening your feed';
        screen('app', true); skeleton();
      }
    }
    const r = await api('feed', { headers: cached && saved.etag ? { 'if-none-match': saved.etag } : {} });
    if (r.status === 304 && cached) { // the saved feed is still the latest: nothing to draw again
      statusNote = ''; etag = saved.etag; live = true; everLoaded = true; banner('');
      saveCache(cached); setStatus(); schedule();
      return;
    }
    if (r.status === 200 && r.data) {
      signedIn = true; statusNote = ''; login = str(r.data.user && r.data.user.login) || login;
      $('#who').textContent = login ? `Signed in as @${login}` : 'Signed in';
      etag = r.etag; live = true; everLoaded = true; banner('');
      apply(r.data); saveCache(r.data); setStatus(); schedule();
      return;
    }
    if (r.status === 401) return showGate();
    if (r.status === 503 && r.data && r.data.error === 'setup') return showSetup(r.data.missing);
    if (cached) {
      live = false; statusNote = ''; setStatus();
      banner(r.offline ? 'Offline: this is your last feed. It updates by itself when you’re back.' : 'The feed didn’t update. This is your last one; it tries again by itself.');
      schedule();
      return;
    }
    // Nothing saved and no answer. He isn't signed out, the feed just can't be reached: the placeholders stay
    // up with a plain note (no sign-in card, no blinking), and it tries again by itself.
    live = false; statusNote = 'Reconnecting'; setStatus();
    banner(r.status === 503 && r.data && r.data.error === 'vault_key' ? VAULT_KEY_NOTE
      : r.offline ? 'Can’t reach Muse Feed right now. It tries again by itself.' : 'Muse Feed didn’t answer. It tries again by itself.');
    again = setTimeout(() => boot(true), 20000);
  }
  addEventListener('online', () => { if (again) { clearTimeout(again); boot(true); } }); // back on the network: try at once

  function skeleton() {
    painted = '';
    paintFilters();
    $('#gist').hidden = false; $('#gist-k').textContent = 'What matters right now';
    $('#gist-text').replaceChildren(el('span', { class: 'sk sk-line' }), el('span', { class: 'sk sk-line short' }));
    $('#gist-talk').replaceChildren();
    $('#convo').hidden = true;
    $('#river').replaceChildren(...[0, 1, 2, 3].map((i) => el('li', { class: 'm node skel', 'aria-hidden': 'true', style: `--i:${i}` },
      el('div', { class: 'sk sk-tag' }), el('div', { class: 'sk sk-title' }), el('div', { class: 'sk sk-line' }), el('div', { class: 'sk sk-line short' }))));
  }

  // ---------- signing in ----------
  let signTimer = null;
  // A line on the sign-in card comes and goes with a morph, so the card eases to its new height.
  const gateSay = (text) => { if ($('#gate-err').hidden === !text && $('#gate-err').textContent === text) return; smooth(() => gateMessage(text)); };
  $('#signin').addEventListener('click', async () => {
    gateSay(''); clearTimeout(signTimer);
    const btn = $('#signin'); btn.disabled = true; morphText($('#signin-t'), 'Getting a code…');
    const r = await api('auth/start', { method: 'POST', body: {} });
    btn.disabled = false;
    if (r.status !== 200 || !r.data || !r.data.code) {
      morphText($('#signin-t'), 'Sign in with GitHub');
      if (r.status === 503 && r.data && r.data.error === 'setup') return showSetup(r.data.missing);
      return gateSay(r.offline ? 'Can’t reach Muse Feed. Check the connection and try again.' : 'GitHub didn’t give a code this time. Try again in a moment.');
    }
    // The button gives way to the code, and the card morphs to its new shape.
    smooth(() => { btn.hidden = true; $('#code').textContent = r.data.code; $('#codebox').hidden = false; });
    pollSignIn(r.data.interval || 5);
  });
  function pollSignIn(interval) {
    clearTimeout(signTimer);
    signTimer = setTimeout(async () => {
      const r = await api('auth/poll', { method: 'POST', body: {} });
      const s = r.data && r.data.state;
      if (s === 'pending') return pollSignIn(r.data.interval || interval);
      if (s === 'done') { toast(`Signed in as @${r.data.login}`); return enter({ login: r.data.login }); }
      if (r.offline) return pollSignIn(Math.min(interval * 2, 30));
      const why = s === 'denied' ? 'You tapped Cancel on GitHub. Sign in again whenever you like.'
        : s === 'expired' ? 'That code ran out. Sign in again for a new one.'
          : s === 'not-you' ? `@${str(r.data.login)} can’t open this feed. It’s only for Moo’s GitHub account.`
            : 'Signing in didn’t work this time. Try again.';
      showGate(why);
    }, Math.max(5, interval) * 1000);
  }
  $('#copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('#code').textContent); toast('Code copied'); } catch { toast('Select the code to copy it'); }
  });
  $('#signout').addEventListener('click', async () => {
    await flushPrefs();
    await api('auth/out', { method: 'POST', body: {} });
    items.clear(); replies = []; mine.clear(); etag = null; dropCache();
    showGate('Signed out. This device won’t open your feed until you sign in again.');
  });

  // ---------- loading ----------
  function schedule() {
    clearTimeout(timer);
    if (!signedIn || document.hidden) return;
    const waiting = replies.some((r) => r.state !== 'done' && r.atMs > now() - 45 * 60e3);
    timer = setTimeout(() => load(), waiting ? 10000 : 60000);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { clearTimeout(timer); flushPrefs(true); } else if (signedIn) load();
  });

  async function load(force) {
    if (loading || !signedIn) return;
    loading = true;
    const r = await api('feed', { headers: !force && etag ? { 'if-none-match': etag } : {} });
    loading = false;
    if (r.status === 304) { live = true; banner(''); }
    else if (r.status === 200 && r.data) { etag = r.etag; live = true; everLoaded = true; banner(''); apply(r.data); saveCache(r.data); }
    else if (r.status === 401) { return showGate('Your sign-in ran out. Sign in again.'); }
    else if (r.status === 503 && r.data && r.data.error === 'setup') { return showSetup(r.data.missing); }
    else if (r.status === 503 && r.data && r.data.error === 'vault_key') { live = false; banner(VAULT_KEY_NOTE); }
    else { live = false; banner(r.offline ? 'Offline. The feed comes back by itself.' : 'The feed didn’t load. It tries again by itself.'); }
    statusNote = ''; setStatus(); schedule();
  }
  function banner(text) { if (text) $('#banner').textContent = text; reveal($('#banner-wrap'), !!text); }
  const VAULT_KEY_NOTE = 'Muse Feed can’t open your vault right now: GitHub refused its key (it may have run out). Tell Muse OS in your Inbox.';

  const TYPE_ICON = { movie: '🎬', show: '📺', tv: '📺', anime: '🍥', game: '🎮', book: '📖', music: '🎵', album: '🎵', podcast: '🎧', comic: '📚', manga: '📚' };
  const icon = (d) => TYPE_ICON[str(d && d.type).toLowerCase()] || '✦';
  const unitFor = (d) => { const t = str(d.type).toLowerCase(); return t === 'book' ? 'page' : (t === 'show' || t === 'tv' || t === 'anime') ? 'ep' : ''; };

  // Everything the page draws from, as one string. When a fresh answer from the API would draw the very same
  // page, it's left alone: no rebuild, no morph, no tap lost to one, nothing scrolled back to its start.
  let painted = '';
  const signature = () => JSON.stringify([[...items.values()], shelfNow, events, matters, updatedAt, filter, [...newIds], live || items.size > 0,
    Object.entries(prefs.weights).filter(([, v]) => v).sort(),
    replies.map((r) => [r.id, r.item, r.about, r.text, r.pictures, r.atMs, r.state, r.note, r.notePictures, r.answeredAt, r.pinged === false])]);

  function apply(data, instant) {
    const f = data.feed && typeof data.feed === 'object' ? data.feed : {};
    items.clear();
    for (const it of arr(f.items)) {
      if (!it || !it.title) continue;
      const source = SOURCES[it.source] ? it.source : 'vault';
      const kind = /^[a-z0-9][a-z0-9-]{0,60}$/.test(str(it.kind)) ? str(it.kind) : source;
      const id = str(it.id) || `${source}:${str(it.title)}`;
      items.set(id, {
        id, source, kind, tag: str(it.tag), title: str(it.title), detail: str(it.detail), time: parseTime(it.time) || now(),
        link: safeUrl(it.url) || (shelfId(it.shelf) ? shelfHref(shelfId(it.shelf)) : ''),
        linkText: str(it.linkText) || (!safeUrl(it.url) && shelfId(it.shelf) ? 'Open in Muse Shelf ↗' : ''), hot: !!it.hot, by: str(it.by),
        links: arr(it.links).filter((l) => l && safeUrl(l.url)).slice(0, 4).map((l) => ({ url: l.url, label: str(l.label).slice(0, 30) || null })),
        pictures: arr(it.pictures).filter((p) => PIC.test(p)).slice(0, 8),
        actions: arr(it.actions).filter((a) => a && str(a.label) && str(a.text)).slice(0, 3).map((a) => ({ label: str(a.label).slice(0, 24), text: str(a.text).slice(0, 300), confirm: str(a.confirm).slice(0, 160) })),
      });
    }
    shelfNow = arr(f.shelf).filter((d) => d && d.title).map((d) => {
      const prog = +d.progress || 0; const total = +d.total || 0; const unit = unitFor(d);
      const label = total && prog ? (unit === 'ep' ? `${icon(d)} ep ${prog} of ${total}` : unit === 'page' ? `${icon(d)} p. ${prog} of ${total}` : `${icon(d)} ${Math.round((prog / total) * 100)}%`) : `${icon(d)} on it`;
      return { title: str(d.title), label, pct: total ? (prog / total) * 100 : null, id: shelfId(d.id) };
    });
    events = arr(f.soon).map((e) => {
      const start = parseTime(e && e.start);
      return { title: str(e && e.title), start, end: parseTime(e && e.end) || start + 36e5, allDay: !!(e && e.allDay) };
    }).filter((e) => e.title && e.start).sort((a, b) => a.start - b.start);
    matters = str(f.matters); updatedAt = parseTime(f.updated);
    if (!prefsDirty && data.prefs && data.prefs.weights && typeof data.prefs.weights === 'object') prefs.weights = { ...data.prefs.weights };
    const fromVault = arr(data.replies).map((r) => ({ ...r, atMs: Date.parse(r.at) || 0 }));
    for (const r of fromVault) mine.delete(r.id);
    replies = [...fromVault, ...mine.values()];
    if (seenBefore === null) seenBefore = new Set(items.keys()); // the very first visit: nothing is "new" yet
    for (const id of items.keys()) if (!seenBefore.has(id)) newIds.add(id);
    try { localStorage.setItem('musefeed.seen', JSON.stringify([...new Set([...seenBefore, ...items.keys()])].slice(-800))); } catch { /* fine */ }
    if (instant) paint();
    else if (signature() === painted) setStatus(); // the same page: only the status line may have changed
    else smoothPaint();
  }

  // ---------- the live label ----------
  // "Live" only while the feed is under an hour old; after that it says plainly when the feed is from, with a
  // Fresh feed nudge (Moo, Nov 25: "its also still saying its live when its 630pm and it says 204pm rn on the feed").
  let statusNote = ''; let statusFlip = null; let wordTimer = null;
  const refreshing = () => replies.some((r) => r.item === 'refresh' && r.state !== 'done' && r.atMs > now() - 15 * 60e3 && r.atMs > updatedAt);
  function setStatus() {
    if (morphing) { const vt = morphing; vt.finished.then(() => setStatus(), () => setStatus()); return; } // after the cards land
    const age = updatedAt ? now() - updatedAt : null;
    const fresh = age != null && age < HOUR;
    let mode = 'off'; let label = statusNote;
    if (!label) {
      if (!signedIn) label = 'Waking up';
      else if (!live) label = updatedAt ? `Reconnecting · from ${when(updatedAt)}` : everLoaded ? 'Reconnecting' : 'Opening your feed';
      else if (!updatedAt || fresh) { mode = 'live'; label = updatedAt ? `Live · fresh from ${when(updatedAt)}` : 'Live'; }
      else { mode = 'stale'; label = sameDay(updatedAt, now()) ? `from ${clock(updatedAt)} · ${ago(updatedAt)}` : `from ${when(updatedAt)}`; }
    }
    $('#statusline').dataset.mode = mode;
    $('#pulse').classList.toggle('off', mode !== 'live');
    morphText($('#status'), label);
    const btn = $('#refresh'); const coming = signedIn && refreshing();
    if (signedIn && !$('#app').hidden) showSoftly(btn); else hideSoftly(btn); // it leaves with a small exit too
    const nudging = mode === 'stale' || coming; const word = coming ? 'On its way…' : 'Fresh feed';
    btn.classList.toggle('nudge', nudging);
    btn.classList.toggle('coming', coming);
    btn.disabled = coming;
    btn.setAttribute('aria-label', coming ? 'A fresh feed is on its way' : 'Fresh feed');
    // While the nudge folds back into the ↻ its words stay put; they change once it's out of sight.
    clearTimeout(wordTimer);
    if (nudging) morphText($('#refresh-t'), word);
    else wordTimer = setTimeout(() => morphText($('#refresh-t'), word, true), 460);
    clearTimeout(statusFlip);
    if (fresh && signedIn) statusFlip = setTimeout(setStatus, HOUR - age + 1000);
  }

  // ---------- render ----------
  const FILTERS = [['all', 'Everything'], ['apps', 'Muse apps'], ['shelf', 'My shelf'], ['world', 'World'], ['day', 'My day'], ['agents', 'Agents'], ['mail', 'Mail']];
  function inFilter(it) {
    if (filter === 'all') return true;
    if (filter === 'apps') return it.source === 'muse' || it.source === 'feedback' || it.kind === 'mail-app';
    if (filter === 'day') return it.source === 'cal' || it.source === 'vault';
    return it.source === filter;
  }
  function score(it) {
    const hours = Math.max(0, (now() - it.time) / 36e5);
    return kindInfo(it.kind).base + weight(it.kind) * 1.5 + (it.hot ? 3 : 0) + (newIds.has(it.id) ? 1 : 0) - hours / 10;
  }
  let hello = '';
  function greet(instant = false) {
    const h = new Date().getHours();
    hello = h < 5 ? 'Up late, Moo' : h < 12 ? 'Morning, Moo' : h < 17 ? 'Afternoon, Moo' : 'Evening, Moo';
    morphText($('#greet'), hello, instant); // rolls in (boot() says the first hello), and rolls over when the time of day changes
  }
  setInterval(() => greet(), 600000);

  // Links in Muse OS's answers become small buttons with plain names (Moo, Nov 24: "make the buttons look nice").
  const LINK_NAMES = [
    [/^https:\/\/claude\.ai\/artifact\/Ec7qxUtGKUXcsnWjycF6G6/, () => '📱 PR Hub'],
    [/^https:\/\/claude\.ai\/artifact\/9NXgcmqDfNv1JH8hDWhdzT/, () => '📱 PRs page'],
    [/^https:\/\/claude\.ai\/artifact\//, () => '📱 Open page'],
    [/^https:\/\/claude\.ai\/code\//, () => '💬 Open chat'],
    [/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/(\d+)/, (m) => `GitHub #${m[1]}`],
    [/^https:\/\/github\.com\//, () => 'GitHub'],
    [/^https:\/\/muselabs\.app\/feed/, () => 'Muse Feed'],
  ];
  const linkName = (u) => {
    for (const [re, name] of LINK_NAMES) { const m = re.exec(u); if (m) return name(m); }
    try { return `${new URL(u).hostname.replace(/^www\./, '')} ↗`; } catch { return 'Open ↗'; }
  };
  const pill = (u, name) => el('a', { class: 'pill', href: u, target: '_blank', rel: 'noopener noreferrer', text: name || linkName(u) });
  function rich(text) {
    const out = []; const s = str(text); let last = 0; let m;
    const re = /(?:https:\/\/|\b(?=(?:claude\.ai|github\.com|muselabs\.app)\/))[^\s<>"']+/g;
    while ((m = re.exec(s))) {
      const raw = m[0].replace(/[.,;:!?)\]]+$/, '');
      const u = raw.startsWith('https://') ? raw : `https://${raw}`;
      // "PR Hub https://…" would say it twice once the link is a button, so the word in front goes.
      const before = s.slice(last, m.index).replace(/(?:📱\s*)?\b(?:PR Hub|PRs page|GitHub(?: PR)?)\s*:?\s*$/i, '');
      if (before) out.push(before);
      out.push(pill(u));
      last = m.index + raw.length; re.lastIndex = last;
    }
    if (last < s.length) out.push(s.slice(last));
    return out;
  }
  // A card's own confirm text comes from the vault, written before the page said Muse OS; it reads Muse OS too.
  const asMuse = (s) => str(s).replace(/\bClaude\b(?![ -]?(?:Code|\.ai))/g, 'Muse OS');

  // Pictures live in the vault (Notes/Muse Feed/pictures/); the API hands them over only to Moo.
  const PIC = /^pictures\/[A-Za-z0-9._-]{1,120}\.(jpe?g|png|webp|gif)$/;
  const picUrl = (p) => `/feed/api/picture?path=${encodeURIComponent(p)}`;
  // A picture's frame shimmers until the picture has arrived, then it fades in. The cards are drawn again at
  // every update, so a picture that has arrived once shows at once after that (no fading in over and over).
  const arrived = new Set();
  function thumbs(paths) {
    const list = arr(paths).filter((p) => PIC.test(p));
    if (!list.length) return null;
    return el('div', { class: 'thumbs' }, list.map((p, i) => {
      const here = arrived.has(p);
      const frame = el('button', { type: 'button', class: `thumb${here ? '' : ' wait'}`, 'aria-label': 'Open the picture', onclick: () => openLightbox(list, i) },
        el('img', {
          src: picUrl(p), alt: '', loading: 'lazy', decoding: 'async', class: here ? 'in' : null,
          onload: (e) => { arrived.add(p); e.currentTarget.classList.add('in'); frame.classList.remove('wait'); },
          onerror: () => frame.classList.remove('wait'),
        }));
      return frame;
    }));
  }

  // ---------- talk: your words and Muse OS's answers ----------
  const byTime = (a, b) => a.atMs - b.atMs;
  const answeredMs = (r) => Date.parse(r.answeredAt) || 0;
  const lastActive = (r) => Math.max(r.atMs, answeredMs(r));
  // A back-and-forth stays open while it's going and for 12 hours after its answer; older ones fold behind
  // "earlier (N)" (Moo, Nov 25: "when do the old msgs get sorted and moved on like im kinda just adding on to one
  // long thread when i just want a spot to ptut a comment atm").
  const current = (r) => (r.state !== 'done' && now() - r.atMs < 3 * 864e5) || now() - lastActive(r) < 12 * HOUR;
  // A line that hasn't been on screen yet eases in by itself: the page's morph is skipped while there are words
  // in a box, and an answer that lands just then shouldn't pop.
  const said = new Set();
  const landing = (key) => { if (said.has(key)) return ''; said.add(key); return ' land'; };
  const youNode = (r) => el('li', { class: `you${landing(`you:${r.id}`)}` },
    el('span', { class: 'sr', text: 'You: ' }), r.text ? el('span', { class: 'words', text: r.text }) : null, thumbs(r.pictures),
    el('span', { class: 'when', text: when(r.atMs) }));
  function answerNode(r) {
    if (r.state === 'done' && (r.note || arr(r.notePictures).length)) {
      const t = answeredMs(r);
      return el('li', { class: `os${landing(`os:${r.id}`)}` },
        el('span', { class: 'os-k' }, el('b', { text: 'Muse OS' }), t ? el('span', { class: 'when', text: when(t) }) : null),
        r.note ? el('span', { class: 'words' }, ...rich(r.note)) : null, thumbs(r.notePictures));
    }
    const wait = r.state === 'working' ? 'Muse OS is on it…'
      : r.state === 'done' ? 'Done.'
        : r.pinged === false ? `Saved. Muse OS sees it at the next check (${nextCheck()}).`
          : `Sent to Muse OS ${ago(r.atMs)} · the answer shows up here`;
    return el('li', { class: `wait-li${r.state === 'working' ? ' working' : ''}${r.state !== 'done' ? ' waiting' : ''}${landing(`wait:${r.id}:${r.state}`)}`, text: wait });
  }
  const exchange = (r) => [youNode(r), answerNode(r)];
  const replyBtn = (target, prev) => el('div', { class: 'thread-act' },
    el('button', { type: 'button', class: 'replybtn', onclick: () => openReply(target, prev || null), text: '↩ reply' }));
  // A fold that opens its own space (and stays open across repaints until Moo closes it).
  let foldN = 0;
  function fold(key, label, content, kind = 'earlier') {
    const id = `fold-${++foldN}`; const on = openFolds.has(key);
    const inner = el('div', { class: 'fold-in', inert: !on }, content);
    const body = el('div', { class: `fold${on ? ' open' : ''}`, id }, inner);
    const btn = el('button', {
      type: 'button', class: kind, 'aria-expanded': String(on), 'aria-controls': id,
      onclick: () => {
        const open = !openFolds.has(key);
        if (open) openFolds.add(key); else openFolds.delete(key);
        body.classList.toggle('open', open); btn.setAttribute('aria-expanded', String(open)); inner.inert = !open;
      },
    }, el('span', { class: 'chev-s', 'aria-hidden': 'true' }), el('span', { text: label }));
    return [btn, body];
  }
  // A thread on a card or on "What matters": only the latest exchange stays open (Moo, Nov 25: "this is like
  // incredibly long now and like a walll of text hard to read").
  function threadNode(list, { key, target, gate = false }) {
    const last = list[list.length - 1];
    const open = last && (!gate || current(last)) ? last : null;
    const earlier = open ? list.slice(0, -1) : list;
    return el('div', { class: 'thread' },
      earlier.length ? fold(key, `earlier (${earlier.length})`, el('ul', { class: 'talk' }, earlier.flatMap(exchange))) : null,
      open ? el('ul', { class: 'talk' }, exchange(open)) : null,
      target ? replyBtn(target, open) : null);
  }
  const aboutBase = (r) => str(r.about).replace(/ · follow-up to:[\s\S]*$/, '');
  const aboutLabel = (r) => (r.item === 'feed' ? 'To Muse OS' : r.item === 'refresh' ? 'Fresh feed' : aboutBase(r).replace(/^\[[^\]]*\]\s*/, ''));
  const talkTarget = (r) => ({ id: r.item, title: aboutLabel(r), about: aboutBase(r) });
  // Under the Say something box: the latest exchange while it's going, and everything older behind one 💬 chip.
  function paintConvo() {
    const list = replies.filter((r) => r.item !== 'gist' && !items.has(r.item)).sort(byTime);
    const talk = list.filter((r) => r.item !== 'refresh');
    const last = talk[talk.length - 1];
    const open = last && current(last) ? last : null;
    const groups = new Map();
    for (const r of list) {
      if (r === open) continue;
      if (!groups.has(r.item)) groups.set(r.item, []);
      groups.get(r.item).push(r);
    }
    const past = [...groups.values()].sort((a, b) => lastActive(b[b.length - 1]) - lastActive(a[a.length - 1])).slice(0, 8);
    const count = past.reduce((n, rs) => n + rs.length, 0);
    const box = $('#convo');
    box.hidden = !open && !count;
    // One row holds ↩ reply and the 💬 chip; the older talk opens underneath it.
    const [chip, pastBody] = count ? fold('convo', `💬 ${count} ${open ? 'earlier' : 'with Muse OS'}`, el('div', { class: 'convo-list' },
      past.map((rs) => el('section', { class: 'convo-group' },
        el('div', { class: 'about', text: `${aboutLabel(rs[0])} · ${ago(lastActive(rs[rs.length - 1]))}` }),
        el('ul', { class: 'talk' }, rs.flatMap(exchange)),
        replyBtn(talkTarget(rs[rs.length - 1]), rs[rs.length - 1])))), 'chip-fold') : [null, null];
    box.replaceChildren(...[ // (replaceChildren would print a null as the word "null")
      open ? el('div', { class: 'convo-open' },
        open.item !== 'feed' ? el('div', { class: 'about', text: `About: ${aboutLabel(open)}` }) : null,
        el('ul', { class: 'talk' }, exchange(open))) : null,
      open || chip ? el('div', { class: 'convo-row' }, open ? replyBtn(talkTarget(open), open) : null, chip) : null,
      pastBody].filter(Boolean));
  }
  const gistTarget = () => ({ id: 'gist', title: `What matters right now: ${matters}`, tag: 'The gist' });
  function paintGist() {
    // Read it to me sits in this panel's head, so the panel stays up whenever there's something to read,
    // even on a feed with no summary (Codex's note on #7).
    $('#gist').hidden = !(matters || (synth && items.size));
    $('#gist-text').replaceChildren(...(matters ? rich(matters) : ['Nothing pressing right now.']));
    $('#gist-k').textContent = updatedAt ? `What matters right now · ${when(updatedAt)}` : 'What matters right now';
    const list = replies.filter((r) => r.item === 'gist').sort(byTime);
    $('#gist-talk').replaceChildren(threadNode(list, { key: 'gist', target: gistTarget(), gate: true }));
  }

  // ---------- the river ----------
  function itemNode(it, i) {
    const fresh = !shown.has(it.id); shown.add(it.id);
    const talk = replies.filter((r) => r.item === it.id).sort(byTime);
    return el('li', { class: `m node${it.hot ? ' hot' : ''}${fresh ? ' arrive' : ''}`, 'data-id': it.id, 'data-vt': vtName(it.id), style: `--dot:${(SOURCES[it.source] || SOURCES.vault).dot};${fresh ? `animation-delay:${Math.min(i, 10) * 60}ms` : ''}` },
      el('div', { class: 'm-head' },
        el('span', { class: 'tag', text: it.tag || (SOURCES[it.source] || SOURCES.vault).label }),
        newIds.has(it.id) ? el('span', { class: 'new', text: 'new' }) : null,
        el('span', { 'data-t': String(it.time), text: ago(it.time) }),
        it.by ? el('span', { text: `· ${it.by}` }) : null),
      el('p', { class: 'm-title', text: it.title }),
      it.detail || it.link ? el('p', { class: 'm-detail' }, it.detail || '', it.link ? [it.detail ? ' ' : '', el('a', { href: it.link, target: it.link.startsWith('https://') ? '_blank' : null, rel: it.link.startsWith('https://') ? 'noopener noreferrer' : null, text: it.linkText || 'Open ↗' })] : null) : null,
      it.links.length ? el('div', { class: 'pills' }, it.links.map((l) => pill(l.url, l.label))) : null,
      thumbs(it.pictures),
      it.actions.length ? el('div', { class: 'acts' }, it.actions.map((a) => el('button', { type: 'button', class: 'actbtn', onclick: (e) => runAction(it, a, e.currentTarget), text: a.label }))) : null,
      el('div', { class: 'm-act' },
        el('button', { type: 'button', 'aria-pressed': String(weight(it.kind) > 0), title: `More ${kindInfo(it.kind).label}`, onclick: () => teach(it.kind, +1), text: '👍 more' }),
        el('button', { type: 'button', title: `Less ${kindInfo(it.kind).label}`, onclick: () => teach(it.kind, -1), text: '👎 less' }),
        el('button', { type: 'button', onclick: () => openReply(it), text: '↩ reply' })),
      talk.length ? threadNode(talk, { key: `item:${it.id}`, target: it }) : null);
  }
  // "On your shelf" and "Coming up" ride in the river now, a few cards down, so the feed comes first
  // (Moo, Nov 25: "look how much shi in the way before we can even get to the feed ?").
  function stripNode(name, label, dot, kids) {
    const fresh = !shown.has(name); shown.add(name);
    return el('li', { class: `node strip-node${fresh ? ' arrive' : ''}`, 'data-vt': name, style: `--dot:${dot}` },
      el('div', { class: 'm-head' }, el('span', { class: 'tag', text: label })),
      el('div', { class: 'strip', 'aria-label': label }, kids));
  }
  function nextStrip() {
    const soon = events.filter((e) => e.end > now()).slice(0, 6);
    if (!soon.length) return null;
    return stripNode('next-strip', 'Coming up', 'var(--sky)', soon.map((e) => el('div', { class: 'ev' },
      el('div', { class: 't', text: e.allDay ? `${sameDay(e.start, now()) ? 'today' : dayName(e.start).toLowerCase()} · all day` : `${sameDay(e.start, now()) ? 'today' : dayName(e.start).toLowerCase()} · ${clock(e.start)}` }),
      el('div', { class: 'n', text: e.title, title: e.title }))));
  }
  function shelfStrip() {
    if (!shelfNow.length) return null;
    return stripNode('shelf-strip', 'On your shelf', 'var(--amber)', shelfNow.slice(0, 12).map((s) => el(s.id ? 'a' : 'div', s.id
      ? { class: 'ev shelf', href: shelfHref(s.id), target: IOS ? null : '_blank', rel: IOS ? null : 'noopener noreferrer', title: `Open ${s.title} in Muse Shelf`, 'aria-label': `${s.title}, open in Muse Shelf` }
      : { class: 'ev shelf', title: s.title },
      el('div', { class: 't', text: s.label }), el('div', { class: 'n', text: s.title }),
      s.pct != null ? el('div', { class: 'bar' }, el('span', { style: `width:${Math.max(3, Math.min(100, s.pct))}%` })) : null)));
  }
  // Only what's on or near the screen gets its own morph layer (its name is kept in data-vt); cards far away
  // simply cross-fade with the page. So a long feed morphs as quickly as a short one: with every card a layer,
  // 80 cards took more than twice as long as 8, and taps wait for a morph.
  const nearby = canMorph && 'IntersectionObserver' in window ? new IntersectionObserver((seen) => {
    for (const e of seen) e.target.style.viewTransitionName = e.isIntersecting ? e.target.dataset.vt : '';
  }, { rootMargin: '100% 0px' }) : null;
  function nameNear(nodes) {
    if (!canMorph) return;
    if (nearby) nearby.disconnect();
    const tall = innerHeight;
    for (const n of nodes) {
      if (!n.dataset.vt) continue;
      const box = n.getBoundingClientRect();
      n.style.viewTransitionName = !nearby || (box.bottom > -tall && box.top < 2 * tall) ? n.dataset.vt : '';
      if (nearby) nearby.observe(n); // and it keeps up as he scrolls
    }
  }
  function paintRiver() {
    const list = [...items.values()].filter((it) => !muted(it.kind) && inFilter(it)).sort((a, b) => score(b) - score(a)).slice(0, 80);
    // Each strip sits after that many cards: the matching view puts its own strip first.
    const spots = filter === 'day' ? [[0, nextStrip()], [3, shelfStrip()]] : filter === 'shelf' ? [[0, shelfStrip()], [3, nextStrip()]] : [[2, nextStrip()], [5, shelfStrip()]];
    const waiting = spots.filter(([, node]) => node);
    const out = [];
    const place = (n) => { while (waiting.length && waiting[0][0] <= n) out.push(waiting.shift()[1]); };
    list.forEach((it, i) => { place(i); out.push(itemNode(it, i)); });
    place(Infinity);
    if (!list.length) {
      const empty = items.size === 0;
      out.push(el('li', { class: 'empty' },
        el('b', { text: empty ? (live ? 'Nothing here yet' : 'Your feed is waking up') : 'All quiet here' }),
        empty ? 'Muse OS fills this at its next check, or tap Fresh feed to ask for one now.' : 'Nothing in this view right now. Try Everything.'));
    }
    // The sideways strips keep their place across a redraw: a 👍 on some card shouldn't throw the shelf back to its start.
    const river = $('#river');
    const kept = new Map([...river.querySelectorAll('.strip')].map((strip) => [strip.getAttribute('aria-label'), strip.scrollLeft]));
    river.replaceChildren(...out);
    for (const strip of river.querySelectorAll('.strip')) { const x = kept.get(strip.getAttribute('aria-label')); if (x) strip.scrollLeft = x; }
    nameNear(out);
  }
  function paintFilters() {
    $('#filters').replaceChildren(...FILTERS.map(([k, label]) => el('button', {
      type: 'button', 'aria-pressed': String(filter === k), text: label,
      onclick: () => { filter = k; try { localStorage.setItem('musefeed.filter', k); } catch { /* fine */ } smoothPaint(); },
    })));
  }
  function paint() {
    painted = signature();
    paintFilters();
    paintConvo();
    paintGist();
    paintRiver();
    const mutedKinds = Object.keys(prefs.weights).filter(muted);
    $('#muted').hidden = !mutedKinds.length;
    $('#muted').replaceChildren(...(mutedKinds.length ? ['Hidden for you:', ...mutedKinds.map((k) => el('button', {
      type: 'button', text: `${kindInfo(k).label} · show again`,
      onclick: () => { prefs.weights[k] = 0; savePrefs(); smoothPaint(); toast(`${kindInfo(k).label} are back`); },
    }))] : []));
    $('#read').hidden = !(synth && (items.size || matters));
    setStatus();
  }
  setInterval(() => {
    for (const s of document.querySelectorAll('[data-t]')) s.textContent = ago(+s.dataset.t);
    if (signedIn) setStatus();
  }, 30000);

  // ---------- 👍 / 👎 ----------
  function teach(kind, delta) {
    prefs.weights[kind] = Math.max(-3, Math.min(5, weight(kind) + delta));
    savePrefs(); smoothPaint();
    const label = kindInfo(kind).label;
    toast(delta > 0 ? `Got it: more ${label}` : muted(kind) ? `Hidden: ${label}` : `Got it: less ${label}`);
  }
  function savePrefs() {
    prefsDirty = true; savedPrefs(prefs.weights);
    clearTimeout(prefsTimer); prefsTimer = setTimeout(() => flushPrefs(), 4000);
  }
  async function flushPrefs(keepalive = false) {
    clearTimeout(prefsTimer);
    if (!prefsDirty || !signedIn) return;
    const r = await api('prefs', { method: 'POST', body: { weights: prefs.weights }, keepalive });
    if (r.status === 200) prefsDirty = false;
  }
  addEventListener('pagehide', () => { flushPrefs(true); });

  // ---------- pictures to send: 📎, paste, or drop; shrunk to 1600 px as a JPEG before they go ----------
  const MAX_PICS = 4;
  async function shrink(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = url; });
      const scale = Math.min(1, 1600 / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
      const w = Math.max(1, Math.round(img.naturalWidth * scale)); const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const ctx = c.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(img, 0, 0, w, h);
      const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.85));
      if (!blob) throw new Error('no picture');
      const data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = rej; r.readAsDataURL(blob); });
      return { data, preview: URL.createObjectURL(blob) };
    } finally { URL.revokeObjectURL(url); }
  }
  function picker({ wrap, list, button, input, zone, field, onChange }) {
    const p = { items: [] };
    // Each preview keeps its own node: a new one rises in, one taken away folds out of the row, the rest stay put.
    const leave = (a, softly) => {
      const node = a.node; a.node = null;
      const gone = () => { if (node) node.remove(); URL.revokeObjectURL(a.preview); };
      if (!node || !softly || reduced) return gone();
      node.classList.add('leaving'); node.inert = true; setTimeout(gone, 210);
    };
    p.paint = () => {
      reveal(wrap, p.items.length > 0);
      for (const a of p.items) {
        if (a.node) continue;
        a.node = el('div', { class: 'att-item' },
          el('img', { src: a.preview, alt: '' }),
          el('button', { type: 'button', 'aria-label': 'Remove this picture', text: '✕', onclick: () => { p.items = p.items.filter((x) => x !== a); leave(a, true); p.paint(); } }));
        list.append(a.node);
      }
      button.disabled = p.items.length >= MAX_PICS;
      if (onChange) onChange();
    };
    p.clear = () => { for (const a of p.items) leave(a, false); p.items = []; p.paint(); };
    p.add = async (files) => {
      const imgs = [...(files || [])].filter((f) => f && /^image\//.test(f.type));
      if (!imgs.length) return;
      for (const f of imgs) {
        if (p.items.length >= MAX_PICS) { toast(`Up to ${MAX_PICS} pictures at a time`); break; }
        try { p.items.push(await shrink(f)); } catch { toast('That picture couldn’t be read'); }
        p.paint();
      }
    };
    button.addEventListener('click', () => input.click());
    input.addEventListener('change', async (e) => { await p.add(e.target.files); e.target.value = ''; });
    field.addEventListener('paste', async (e) => {
      const files = e.clipboardData ? [...e.clipboardData.files] : [];
      if (files.some((f) => /^image\//.test(f.type))) { e.preventDefault(); await p.add(files); }
    });
    zone.addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.items].some((i) => i.kind === 'file')) { e.preventDefault(); zone.classList.add('drop'); } });
    zone.addEventListener('dragleave', () => zone.classList.remove('drop'));
    zone.addEventListener('drop', async (e) => { zone.classList.remove('drop'); if (e.dataTransfer && e.dataTransfer.files.length) { e.preventDefault(); await p.add(e.dataTransfer.files); } });
    return p;
  }

  function sendError(r) {
    if (r.status === 401) { closeSheet(); showGate('Your sign-in ran out. Sign in again, then send it.'); return ''; }
    if (r.status === 503 && r.data && r.data.error === 'vault_key') return 'Not sent: GitHub refused Muse Feed’s key, so it can’t save to your vault. Tell Muse OS in your Inbox.';
    if (r.status === 413 || (r.status === 400 && r.data && r.data.error === 'pictures')) return 'Not sent: a picture is too big or isn’t a picture. Try a smaller one.';
    return r.offline ? 'Not sent: you look offline. Try again in a moment.' : 'Not sent. Tap Send to try once more.';
  }
  function remember(reply) {
    if (!reply || !reply.id) return;
    const r = { ...reply, atMs: Date.parse(reply.at) || now() };
    mine.set(r.id, r);
    replies = [...replies.filter((x) => x.id !== r.id), r];
  }
  const SAY_ABOUT = 'Say something (the box at the top of Muse Feed)';
  const aboutFor = (it) => it.about || (it.id === 'feed' ? SAY_ABOUT
    : it.id === 'gist' ? `What matters right now: ${matters}`
      : `[${it.tag || (SOURCES[it.source] || SOURCES.vault).label}] ${it.title}${it.detail ? ` (${it.detail})` : ''}`);

  // ---------- Say something: its own spot for a new message (Moo, Nov 25: "i just want a spot to ptut a comment") ----------
  const sayText = $('#say-text'); let saying = false;
  // The box grows with the words (and eases back); inside a morph it takes its new height at once, so the
  // morph itself carries the change and nothing below lands late.
  function growSay(instant = false) {
    const from = sayText.offsetHeight;
    sayText.style.height = 'auto';
    const full = sayText.scrollHeight; const to = Math.min(Math.max(full, 36), 184);
    if (instant) sayText.style.transition = 'none';
    else { sayText.style.height = `${from}px`; void sayText.offsetHeight; }
    sayText.style.height = `${to}px`;
    sayText.style.overflowY = full > 184 ? 'auto' : 'hidden';
    if (instant) { void sayText.offsetHeight; sayText.style.transition = ''; }
  }
  function syncSay() {
    const has = !!sayText.value.trim() || sayPics.items.length > 0;
    $('#say-send').disabled = !has || saying;
    $('#say').classList.toggle('busy', saying);
  }
  const sayPics = picker({ wrap: $('#say-att-wrap'), list: $('#say-att'), button: $('#say-pic'), input: $('#say-file'), zone: $('#say-box'), field: sayText, onChange: syncSay });
  const enterSends = matchMedia('(hover: hover) and (pointer: fine)');
  sayText.addEventListener('input', () => { growSay(); syncSay(); reveal($('#say-err-wrap'), false); });
  sayText.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
    if (e.metaKey || e.ctrlKey || (enterSends.matches && !e.shiftKey)) { e.preventDefault(); sendSay(); }
  });
  $('#say-send').addEventListener('click', () => sendSay());
  async function sendSay() {
    const words = sayText.value.trim();
    if (saying || (!words && !sayPics.items.length)) return;
    saying = true; syncSay(); sayText.readOnly = true; reveal($('#say-err-wrap'), false);
    const body = { item: 'feed', about: SAY_ABOUT, text: words };
    if (sayPics.items.length) body.pictures = sayPics.items.map((a) => ({ type: 'image/jpeg', data: a.data }));
    const r = await api('send', { method: 'POST', body });
    saying = false; sayText.readOnly = false;
    if (r.status === 200 && r.data && r.data.reply) {
      remember(r.data.reply);
      // The words fade out of the box as they land underneath it, and the box eases back to one line.
      smooth(() => { sayText.value = ''; sayPics.clear(); growSay(canMorph && !document.hidden); syncSay(); paint(); }, true);
      schedule();
      toast(r.data.pinged ? 'Sent. Muse OS answers right here.' : `Saved. Muse OS sees it at the next check (${nextCheck()}).`);
      return;
    }
    syncSay();
    const msg = sendError(r);
    if (msg) { $('#say-err').textContent = msg; reveal($('#say-err-wrap'), true); }
  }

  // ---------- replies to Muse OS (the sheet) ----------
  let replyTarget = null; let followUp = null;
  const sheetPics = picker({ wrap: $('#sheet-att-wrap'), list: $('#sheet-att'), button: $('#sheet-pic'), input: $('#sheet-file'), zone: $('#sheet .sheet'), field: $('#sheet-text') });
  const sheetError = (text) => { if (text) $('#sheet-err').textContent = text; reveal($('#sheet-err-wrap'), !!text); };
  function openReply(it, prev) {
    replyTarget = it; followUp = prev || null;
    const tell = it.id === 'feed' && !prev;
    $('#sheet-title').textContent = tell ? 'Tell Muse OS' : 'Reply to Muse OS';
    $('#sheet-about').textContent = tell ? 'Anything at all: a task, a question, something for your feed, something that looks wrong. Pictures too.' : `About: ${it.title}`;
    $('#sheet-prev').hidden = !(prev && (prev.note || prev.text));
    if (prev) $('#sheet-prev').replaceChildren(el('b', { text: prev.note ? 'Muse OS' : 'You' }), ' ', ...(prev.note ? rich(prev.note) : [prev.text]));
    $('#sheet-text').value = ''; sheetError(''); sheetPics.clear();
    $('#sheet-send').disabled = false; morphText($('#sheet-send-t'), 'Send to Muse OS', true);
    showSoftly($('#sheet')); $('#sheet-text').focus();
  }
  const closeSheet = (then) => { hideSoftly($('#sheet'), () => { replyTarget = null; followUp = null; sheetPics.clear(); if (typeof then === 'function') then(); }); };
  $('#sheet-cancel').addEventListener('click', closeSheet);
  $('#sheet').addEventListener('click', (e) => { if (e.target === $('#sheet')) closeSheet(); });
  document.addEventListener('keydown', (e) => {
    if (!$('#lightbox').hidden) {
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowLeft') stepLightbox(-1);
      if (e.key === 'ArrowRight') stepLightbox(1);
      return;
    }
    if ($('#sheet').hidden) return;
    if (e.key === 'Escape') closeSheet();
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) $('#sheet-send').click();
  });
  $('#sheet-send').addEventListener('click', async () => {
    const words = $('#sheet-text').value.trim(); const it = replyTarget;
    if (!it) return;
    if (!words && !sheetPics.items.length) { sheetError('Write something or add a picture first.'); return; }
    const btn = $('#sheet-send'); btn.disabled = true;
    const n = sheetPics.items.length;
    morphText($('#sheet-send-t'), n ? `Sending ${n > 1 ? `${n} pictures` : 'the picture'}…` : 'Sending…');
    let about = aboutFor(it);
    if (followUp && followUp.note) about = `${about.slice(0, 200)} · follow-up to: ${followUp.note.slice(0, 190)}`;
    const body = { item: it.id, about: about.slice(0, 400), text: words };
    if (n) body.pictures = sheetPics.items.map((a) => ({ type: 'image/jpeg', data: a.data }));
    const r = await api('send', { method: 'POST', body });
    if (r.status === 200 && r.data && r.data.reply) {
      remember(r.data.reply); closeSheet(smoothPaint); schedule(); // the sheet sinks away, then your words glide onto the card
      toast(r.data.pinged ? 'Sent. Muse OS answers right on that card.' : `Saved. Muse OS sees it at the next check (${nextCheck()}).`);
      return;
    }
    const msg = sendError(r);
    if (msg) { sheetError(msg); btn.disabled = false; morphText($('#sheet-send-t'), 'Send to Muse OS'); }
  });

  // A card's own buttons, like Merge on a PR card: one tap sends those words to Muse OS (Moo, Nov 24: "a merge button from there").
  async function runAction(it, a, btn) {
    if (!window.confirm(asMuse(a.confirm) || `${a.label}: ${it.title}?`)) return;
    btn.disabled = true;
    const r = await api('send', { method: 'POST', body: { item: it.id, about: aboutFor(it).slice(0, 400), text: a.text } });
    btn.disabled = false;
    if (r.status === 200 && r.data && r.data.reply) {
      remember(r.data.reply); smoothPaint(); schedule();
      toast(r.data.pinged ? `Sent “${a.text}”. Muse OS answers on this card.` : `Saved. Muse OS sees it at the next check (${nextCheck()}).`);
      return;
    }
    const msg = sendError(r);
    if (msg) toast(msg);
  }

  // ---------- pictures, big ----------
  let lightbox = { list: [], i: 0 };
  // A picture fades in once it has arrived (its place shimmers if that takes a while), and going on to the
  // next one is a quick cross-fade: the one on screen fades out, then the next fades in.
  let lbTimer = null;
  function showLightbox(step) {
    const { list, i } = lightbox; const img = $('#lb-img'); const box = $('#lightbox');
    const bring = () => { img.src = picUrl(list[i]); if (img.complete && img.naturalWidth) { img.classList.add('in'); box.classList.remove('wait'); } };
    clearTimeout(lbTimer);
    img.classList.remove('in'); box.classList.add('wait');
    if (step && !reduced) lbTimer = setTimeout(bring, 150); else bring();
    morphText($('#lb-count'), list.length > 1 ? `${i + 1} of ${list.length}` : '');
    $('#lb-prev').hidden = list.length < 2; $('#lb-next').hidden = list.length < 2;
  }
  for (const what of ['load', 'error']) $('#lb-img').addEventListener(what, () => { $('#lb-img').classList.add('in'); $('#lightbox').classList.remove('wait'); });
  function openLightbox(list, i) { lightbox = { list, i }; showLightbox(false); showSoftly($('#lightbox')); $('#lb-close').focus(); }
  function stepLightbox(d) { if (lightbox.list.length > 1) { lightbox.i = (lightbox.i + d + lightbox.list.length) % lightbox.list.length; showLightbox(true); } }
  function closeLightbox() { clearTimeout(lbTimer); hideSoftly($('#lightbox'), () => { $('#lb-img').removeAttribute('src'); $('#lb-img').classList.remove('in'); }); }
  $('#lb-close').addEventListener('click', closeLightbox);
  $('#lb-prev').addEventListener('click', () => stepLightbox(-1));
  $('#lb-next').addEventListener('click', () => stepLightbox(1));
  $('#lightbox').addEventListener('click', (e) => { if (e.target === $('#lightbox')) closeLightbox(); });

  $('#gist-fold').addEventListener('click', () => {
    gistFolded = !gistFolded; setGistFold(gistFolded);
    try { localStorage.setItem('musefeed.gistFolded', gistFolded ? '1' : '0'); } catch { /* fine */ }
  });
  $('#refresh').addEventListener('click', async () => {
    const btn = $('#refresh');
    if (btn.disabled) return;
    btn.disabled = true;
    const r = await api('send', { method: 'POST', body: { item: 'refresh', about: 'A fresh feed', text: 'Make me a fresh feed, please.' } });
    btn.disabled = false;
    if (r.status === 200 && r.data && r.data.reply) {
      remember(r.data.reply); smoothPaint(); schedule();
      toast(r.data.already ? 'Muse OS is already making a fresh one.' : r.data.pinged ? 'Asked Muse OS for a fresh feed. It shows up here in a few minutes.' : `Saved. Muse OS makes a fresh one at the next check (${nextCheck()}).`);
      return;
    }
    setStatus();
    const msg = sendError(r);
    if (msg) toast(msg);
  });

  // ---------- read it to me ----------
  const plain = (s) => str(s).replace(/https?:\S+/g, '').replace(/[^\p{L}\p{N}\s.,:;!?'’@&()-]/gu, '').trim();
  $('#read').addEventListener('click', () => {
    if (!synth) return;
    const btn = $('#read');
    const done = () => { btn.classList.remove('on'); btn.title = 'Read it to me'; btn.setAttribute('aria-label', 'Read it to me'); };
    if (synth.speaking) { synth.cancel(); done(); return; }
    const top = [...items.values()].filter((it) => !muted(it.kind)).sort((a, b) => score(b) - score(a)).slice(0, 7);
    const lines = [`${hello}.`, matters ? plain(matters) : '', ...top.map((it) => `${plain(it.title)}. ${plain(it.detail)}`)].filter(Boolean);
    lines.forEach((t, i) => {
      const u = new SpeechSynthesisUtterance(t); u.rate = 1.03;
      if (i === lines.length - 1) u.onend = done;
      synth.speak(u);
    });
    btn.classList.add('on'); btn.title = 'Stop reading'; btn.setAttribute('aria-label', 'Stop reading');
  });

  // ---------- install ----------
  let installEvent = null;
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e; showSoftly($('#install')); });
  $('#install').addEventListener('click', async () => {
    if (!installEvent) return;
    installEvent.prompt();
    try { await installEvent.userChoice; } catch { /* fine */ }
    installEvent = null; $('#install').hidden = true;
  });
  if ('serviceWorker' in navigator) addEventListener('load', () => { navigator.serviceWorker.register('/feed/sw.js', { scope: '/feed/' }).catch(() => {}); });

  setStatus(); boot();
})();
