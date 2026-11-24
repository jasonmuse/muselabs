// Muse Feed (muselabs.app/feed): the page. It only talks to its own API (/feed/api/*), which signs Moo in
// with GitHub, reads the feed Claude keeps in his vault, and hands anything he sends to Claude.
(() => {
  'use strict';

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
    const b = $('#toast');
    b.textContent = t;
    b.classList.remove('closing');
    b.hidden = false;
    clearTimeout(toast.h);
    toast.h = setTimeout(() => {
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) { b.hidden = true; return; }
      b.classList.add('closing'); setTimeout(() => { b.classList.remove('closing'); b.hidden = true; }, 190);
    }, 3600);
  };

  // ---------- aurora ----------
  (() => {
    const c = $('#aurora'); const ctx = c.getContext('2d'); let w = 0; let h = 0; const S = 0.25;
    const blobs = [
      { col: [167, 123, 255], r: 0.55, ax: 0.28, ay: 0.18, sx: 0.00011, sy: 0.00017, px: 0.2, py: 0.15 },
      { col: [63, 224, 197], r: 0.45, ax: 0.32, ay: 0.22, sx: 0.00008, sy: 0.00012, px: 0.8, py: 0.35 },
      { col: [255, 111, 174], r: 0.40, ax: 0.25, ay: 0.25, sx: 0.00013, sy: 0.00009, px: 0.5, py: 0.85 },
      { col: [106, 162, 255], r: 0.35, ax: 0.30, ay: 0.20, sx: 0.00010, sy: 0.00014, px: 0.15, py: 0.7 },
    ];
    const size = () => { w = Math.max(1, Math.round(innerWidth * S)); h = Math.max(1, Math.round(innerHeight * S)); c.width = w; c.height = h; };
    const draw = (t) => {
      ctx.fillStyle = '#0a0913'; ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';
      for (const b of blobs) {
        const x = (b.px + Math.sin(t * b.sx) * b.ax) * w; const y = (b.py + Math.cos(t * b.sy) * b.ay) * h;
        const rad = b.r * Math.max(w, h);
        const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
        g.addColorStop(0, `rgba(${b.col},0.30)`); g.addColorStop(1, `rgba(${b.col},0)`);
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      }
      ctx.globalCompositeOperation = 'source-over';
    };
    size(); addEventListener('resize', size); draw(4000);
    if (reduced) return;
    let last = 0;
    const loop = (t) => { if (!document.hidden && t - last > 50) { draw(t + 4000); last = t; } requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  })();

  // ---------- time ----------
  const now = () => Date.now();
  const ago = (t) => {
    const s = Math.round((now() - t) / 1000);
    if (s < -60) { const m = Math.round(-s / 60); if (m < 60) return `in ${m} min`; const hh = Math.round(m / 60); return hh < 24 ? `in ${hh}h` : `in ${Math.round(hh / 24)} days`; }
    if (s < 60) return 'just now'; const m = Math.round(s / 60); if (m < 60) return `${m} min ago`;
    const hh = Math.round(m / 60); if (hh < 24) return `${hh}h ago`; const d = Math.round(hh / 24); return d === 1 ? 'yesterday' : `${d} days ago`;
  };
  const clock = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(' ', '').toLowerCase();
  const dayName = (t) => new Date(t).toLocaleDateString([], { weekday: 'short' });
  const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
  const when = (t) => (sameDay(t, now()) ? clock(t) : `${dayName(t)} ${clock(t)}`);
  const parseTime = (s) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(s));
    return m ? new Date(+m[1], +m[2] - 1, +m[3], 0, 0).getTime() : Date.parse(str(s)) || 0;
  };
  // Claude's checks: 4:43am, 12:39pm and 8:39pm (Eastern, like Moo).
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
  let shelfNow = []; let events = []; let matters = ''; let updatedAt = 0; let updatedBy = '';
  let replies = [];
  const mine = new Map(); // replies sent from this page that the vault hasn't shown yet
  let prefs = { weights: {} }; let prefsDirty = false; let prefsTimer = null;
  let filter = 'all';
  try { filter = localStorage.getItem('musefeed.filter') || 'all'; } catch { /* fine */ }
  let seenBefore = null; const newIds = new Set();
  try { const raw = localStorage.getItem('musefeed.seen'); if (raw) seenBefore = new Set(JSON.parse(raw)); } catch { seenBefore = null; }
  const shown = new Set();
  const synth = 'speechSynthesis' in window ? window.speechSynthesis : null;
  const weight = (kind) => Number(prefs.weights[kind] || 0);
  const muted = (kind) => weight(kind) <= -3;

  // Liquid, never pops (Moo, Nov 24: "buttery smooth sleek liquid everything always"): every change of what's on
  // screen morphs (View Transitions where the browser has them, so cards glide to their new places), the last feed
  // shows at once while a fresh one loads, and a first visit gets shimmering placeholders instead of an empty box.
  const canMorph = typeof document.startViewTransition === 'function' && !reduced;
  function smooth(fn) {
    if (!canMorph || document.hidden) { fn(); return; }
    try { document.startViewTransition(fn); } catch { fn(); }
  }
  const smoothPaint = () => smooth(paint);
  const vtName = (id) => { let h = 5381; for (const ch of str(id)) h = ((h * 33) ^ ch.codePointAt(0)) >>> 0; return `c${h.toString(36)}`; };
  // The last feed, kept on this device for a day so the page opens full, never empty. Signing out clears it.
  const CACHE = 'musefeed.last';
  const saveCache = (data) => { try { localStorage.setItem(CACHE, JSON.stringify({ at: now(), data })); } catch { /* fine */ } };
  const dropCache = () => { try { localStorage.removeItem(CACHE); } catch { /* fine */ } };
  const readCache = () => {
    try { const c = JSON.parse(localStorage.getItem(CACHE) || 'null'); return c && c.data && now() - c.at < 864e5 ? c.data : null; } catch { return null; }
  };
  // Leaving the screen gets a short exit too, not a blink.
  function hideSoftly(node, after) {
    clearTimeout(node.hideTimer);
    if (reduced || node.hidden) { node.hidden = true; if (after) after(); return; }
    node.classList.add('closing');
    node.hideTimer = setTimeout(() => { node.classList.remove('closing'); node.hidden = true; if (after) after(); }, 190);
  }
  function showSoftly(node) { clearTimeout(node.hideTimer); node.classList.remove('closing'); node.hidden = false; }

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
    };
    if (instant || !$(`#${name}`).hidden) go(); else smooth(go);
  }
  function showGate(message) {
    signedIn = false; live = false; clearTimeout(timer); dropCache(); setStatus('Signed out');
    screen('gate');
    $('#signin').hidden = false; $('#signin').disabled = false; $('#signin').textContent = 'Sign in with GitHub';
    $('#codebox').hidden = true;
    gateMessage(message || '');
  }
  function gateMessage(text) { $('#gate-err').textContent = text; $('#gate-err').hidden = !text; }
  function showSetup(missing) {
    signedIn = false; live = false; clearTimeout(timer); setStatus('Not set up yet');
    screen('setup');
    $('#setup-missing').textContent = arr(missing).length ? `Missing: ${arr(missing).join(', ')}.` : '';
  }
  function enter(user) {
    signedIn = true; login = str(user && user.login) || login;
    $('#who').textContent = login ? `Signed in as @${login}` : 'Signed in';
    screen('app');
    if (!items.size) skeleton();
    load(true);
  }

  // Opens full: the last feed right away (or shimmering placeholders the first time), then one call that both
  // checks the sign-in and brings the fresh feed, which morphs in.
  async function boot() {
    const cached = readCache();
    if (cached) {
      signedIn = true; login = str(cached.user && cached.user.login);
      $('#who').textContent = login ? `Signed in as @${login}` : 'Signed in';
      screen('app', true); apply(cached, true); setStatus('Updating');
    } else {
      screen('app', true); skeleton(); setStatus('Opening your feed');
    }
    const r = await api('feed');
    if (r.status === 200 && r.data) {
      signedIn = true; login = str(r.data.user && r.data.user.login) || login;
      $('#who').textContent = login ? `Signed in as @${login}` : 'Signed in';
      etag = r.etag; live = true; everLoaded = true; banner('');
      apply(r.data); saveCache(r.data); setStatus(); schedule();
      return;
    }
    if (r.status === 401) return showGate();
    if (r.status === 503 && r.data && r.data.error === 'setup') return showSetup(r.data.missing);
    if (cached) {
      live = false; setStatus();
      banner(r.offline ? 'Offline: this is your last feed. It updates by itself when you’re back.' : 'The feed didn’t update. This is your last one; it tries again by itself.');
      schedule();
      return;
    }
    showGate(r.offline ? 'Can’t reach Muse Feed right now. It tries again by itself.' : 'Muse Feed didn’t answer. It tries again by itself.');
    setTimeout(boot, 20000);
  }

  function skeleton() {
    paintFilters();
    $('#gist').hidden = false; $('#gist-k').textContent = 'What matters right now';
    $('#gist-text').replaceChildren(el('span', { class: 'sk sk-line' }), el('span', { class: 'sk sk-line short' }));
    $('#gist-talk').replaceChildren(); $('#gist-reply').parentElement.hidden = true;
    $('#chat-wrap').hidden = true; $('#shelf-wrap').hidden = true; $('#next-wrap').hidden = true;
    $('#river').replaceChildren(...[0, 1, 2, 3].map((i) => el('li', { class: 'm skel', 'aria-hidden': 'true', style: `--i:${i}` },
      el('div', { class: 'sk sk-tag' }), el('div', { class: 'sk sk-title' }), el('div', { class: 'sk sk-line' }), el('div', { class: 'sk sk-line short' }))));
  }

  // ---------- signing in ----------
  let signTimer = null;
  $('#signin').addEventListener('click', async () => {
    gateMessage(''); clearTimeout(signTimer);
    const btn = $('#signin'); btn.disabled = true; btn.textContent = 'Getting a code…';
    const r = await api('auth/start', { method: 'POST', body: {} });
    btn.disabled = false;
    if (r.status !== 200 || !r.data || !r.data.code) {
      btn.textContent = 'Sign in with GitHub';
      if (r.status === 503 && r.data && r.data.error === 'setup') return showSetup(r.data.missing);
      return gateMessage(r.offline ? 'Can’t reach Muse Feed. Check the connection and try again.' : 'GitHub didn’t give a code this time. Try again in a moment.');
    }
    btn.hidden = true;
    $('#code').textContent = r.data.code;
    $('#codebox').hidden = false;
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
    else if (r.status === 503 && r.data && r.data.error === 'vault_key') { live = false; banner('Muse Feed can’t open your vault right now: GitHub refused its key (it may have run out). Tell Claude in your Inbox.'); }
    else { live = false; banner(r.offline ? 'Offline. The feed comes back by itself.' : 'The feed didn’t load. It tries again by itself.'); }
    setStatus(); schedule();
  }
  function banner(text) { $('#banner').textContent = text; $('#banner').hidden = !text; }

  const TYPE_ICON = { movie: '🎬', show: '📺', tv: '📺', anime: '🍥', game: '🎮', book: '📖', music: '🎵', album: '🎵', podcast: '🎧', comic: '📚', manga: '📚' };
  const icon = (d) => TYPE_ICON[str(d && d.type).toLowerCase()] || '✦';
  const unitFor = (d) => { const t = str(d.type).toLowerCase(); return t === 'book' ? 'page' : (t === 'show' || t === 'tv' || t === 'anime') ? 'ep' : ''; };

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
        link: safeUrl(it.url), linkText: str(it.linkText), hot: !!it.hot, by: str(it.by),
        links: arr(it.links).filter((l) => l && safeUrl(l.url)).slice(0, 4).map((l) => ({ url: l.url, label: str(l.label).slice(0, 30) || null })),
        pictures: arr(it.pictures).filter((p) => PIC.test(p)).slice(0, 8),
        actions: arr(it.actions).filter((a) => a && str(a.label) && str(a.text)).slice(0, 3).map((a) => ({ label: str(a.label).slice(0, 24), text: str(a.text).slice(0, 300), confirm: str(a.confirm).slice(0, 160) })),
      });
    }
    shelfNow = arr(f.shelf).filter((d) => d && d.title).map((d) => {
      const prog = +d.progress || 0; const total = +d.total || 0; const unit = unitFor(d);
      const label = total && prog ? (unit === 'ep' ? `${icon(d)} ep ${prog} of ${total}` : unit === 'page' ? `${icon(d)} p. ${prog} of ${total}` : `${icon(d)} ${Math.round((prog / total) * 100)}%`) : `${icon(d)} on it`;
      return { title: str(d.title), label, pct: total ? (prog / total) * 100 : null };
    });
    events = arr(f.soon).map((e) => {
      const start = parseTime(e && e.start);
      return { title: str(e && e.title), start, end: parseTime(e && e.end) || start + 36e5, allDay: !!(e && e.allDay) };
    }).filter((e) => e.title && e.start).sort((a, b) => a.start - b.start);
    matters = str(f.matters); updatedAt = parseTime(f.updated); updatedBy = str(f.by);
    if (!prefsDirty && data.prefs && data.prefs.weights && typeof data.prefs.weights === 'object') prefs.weights = { ...data.prefs.weights };
    const fromVault = arr(data.replies).map((r) => ({ ...r, atMs: Date.parse(r.at) || 0 }));
    for (const r of fromVault) mine.delete(r.id);
    replies = [...fromVault, ...mine.values()];
    if (seenBefore === null) seenBefore = new Set(items.keys()); // the very first visit: nothing is "new" yet
    for (const id of items.keys()) if (!seenBefore.has(id)) newIds.add(id);
    try { localStorage.setItem('musefeed.seen', JSON.stringify([...new Set([...seenBefore, ...items.keys()])].slice(-800))); } catch { /* fine */ }
    if (instant) paint(); else smoothPaint();
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
  function setStatus(text) {
    $('#pulse').classList.toggle('off', !live);
    $('#status').textContent = text || (live ? (updatedAt ? `Live · fresh from ${when(updatedAt)}` : 'Live') : signedIn ? (everLoaded ? 'Reconnecting' : 'Opening your feed') : 'Waking up');
  }
  function greet() {
    const h = new Date().getHours();
    $('#greet').textContent = h < 5 ? 'Up late, Moo' : h < 12 ? 'Morning, Moo' : h < 17 ? 'Afternoon, Moo' : 'Evening, Moo';
  }
  greet(); setInterval(greet, 600000);

  // Links in Claude's answers become small buttons with plain names (Moo, Nov 24: "make the buttons look nice").
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

  // Pictures live in the vault (Notes/Muse Feed/pictures/); the API hands them over only to Moo.
  const PIC = /^pictures\/[A-Za-z0-9._-]{1,120}\.(jpe?g|png|webp|gif)$/;
  const picUrl = (p) => `/feed/api/picture?path=${encodeURIComponent(p)}`;
  function thumbs(paths) {
    const list = arr(paths).filter((p) => PIC.test(p));
    if (!list.length) return null;
    return el('div', { class: 'thumbs' }, list.map((p, i) => el('button', { type: 'button', class: 'thumb', 'aria-label': 'Open the picture', onclick: () => openLightbox(list, i) },
      el('img', { src: picUrl(p), alt: '', loading: 'lazy', decoding: 'async' }))));
  }

  function answerNode(r) {
    if (r.state === 'done' && (r.note || arr(r.notePictures).length)) return el('li', { class: 'claude' }, el('b', { text: 'Claude' }), ' ', ...rich(r.note), thumbs(r.notePictures));
    const wait = r.state === 'working' ? 'Claude’s on it…'
      : r.state === 'done' ? 'Done.'
        : r.pinged === false ? `Saved. Claude sees it at the next check (${nextCheck()}).`
          : `Sent to Claude ${ago(r.atMs)} · the answer shows up here`;
    return el('li', { class: 'wait-li', text: wait });
  }
  const youNode = (r) => el('li', {}, el('b', { text: 'You' }), ' ', r.text, thumbs(r.pictures));
  // A card's back-and-forth, with ↩ reply under the last answer (Moo, Nov 24: "i should be able to reply to ur reply").
  function thread(list, target) {
    const lastOne = list[list.length - 1];
    return el('ul', { class: 'talk' }, list.flatMap((r) => [youNode(r), answerNode(r)]),
      target ? el('li', { class: 'more' }, el('button', { type: 'button', class: 'replybtn', onclick: () => openReply(target, lastOne), text: '↩ reply' })) : null);
  }
  function talkFor(id, target) {
    const list = replies.filter((r) => r.item === id).sort((a, b) => a.atMs - b.atMs);
    return list.length ? thread(list, target) : null;
  }
  function paintChat() {
    const groups = new Map();
    for (const r of replies) {
      if (r.item === 'gist' || items.has(r.item)) continue;
      if (!groups.has(r.item)) groups.set(r.item, []);
      groups.get(r.item).push(r);
    }
    const list = [...groups.entries()].map(([item, rs]) => { rs.sort((a, b) => a.atMs - b.atMs); return { item, rs, last: rs[rs.length - 1].atMs }; })
      .sort((a, b) => b.last - a.last).slice(0, 6);
    $('#chat-wrap').hidden = !list.length;
    $('#chat').replaceChildren(...list.map(({ item, rs }) => {
      const base = str(rs[0].about).replace(/ · follow-up to:[\s\S]*$/, '');
      const about = item === 'feed' ? 'To Claude' : item === 'refresh' ? 'Fresh feed' : base.replace(/^\[[^\]]*\]\s*/, '');
      const t = thread(rs, { id: item, title: about, about: base });
      t.prepend(el('li', { class: 'about-li' }, el('span', { class: 'about', text: `${about} · ${ago(rs[rs.length - 1].atMs)}` })));
      return el('li', { class: 'pair' }, t);
    }));
  }
  function paintStrips() {
    const soon = events.filter((e) => e.end > now()).slice(0, 6);
    $('#next-wrap').hidden = !soon.length;
    $('#next').replaceChildren(...soon.map((e) => el('div', { class: 'ev' },
      el('div', { class: 't', text: e.allDay ? `${sameDay(e.start, now()) ? 'today' : dayName(e.start).toLowerCase()} · all day` : `${sameDay(e.start, now()) ? 'today' : dayName(e.start).toLowerCase()} · ${clock(e.start)}` }),
      el('div', { class: 'n', text: e.title, title: e.title }))));
    $('#shelf-wrap').hidden = !shelfNow.length;
    $('#shelf').replaceChildren(...shelfNow.slice(0, 12).map((s) => el('div', { class: 'ev shelf', title: s.title },
      el('div', { class: 't', text: s.label }), el('div', { class: 'n', text: s.title }),
      s.pct != null ? el('div', { class: 'bar' }, el('span', { style: `width:${Math.max(3, Math.min(100, s.pct))}%` })) : null)));
  }
  function itemNode(it, i) {
    const fresh = !shown.has(it.id); shown.add(it.id);
    return el('li', { class: `m${it.hot ? ' hot' : ''}${fresh ? ' arrive' : ''}`, 'data-id': it.id, style: `--dot:${(SOURCES[it.source] || SOURCES.vault).dot};view-transition-name:${vtName(it.id)};${fresh ? `animation-delay:${Math.min(i, 10) * 60}ms` : ''}` },
      el('div', { class: 'm-head' },
        el('span', { class: 'tag', text: it.tag || (SOURCES[it.source] || SOURCES.vault).label }),
        newIds.has(it.id) ? el('span', { class: 'new', text: 'new' }) : null,
        el('span', { 'data-t': String(it.time), text: ago(it.time) }),
        it.by ? el('span', { text: `· ${it.by}` }) : null),
      el('p', { class: 'm-title', text: it.title }),
      it.detail || it.link ? el('p', { class: 'm-detail' }, it.detail || '', it.link ? [it.detail ? ' ' : '', el('a', { href: it.link, target: '_blank', rel: 'noopener noreferrer', text: it.linkText || 'Open ↗' })] : null) : null,
      it.links.length ? el('div', { class: 'pills' }, it.links.map((l) => pill(l.url, l.label))) : null,
      thumbs(it.pictures),
      it.actions.length ? el('div', { class: 'acts' }, it.actions.map((a) => el('button', { type: 'button', class: 'actbtn', onclick: (e) => runAction(it, a, e.currentTarget), text: a.label }))) : null,
      el('div', { class: 'm-act' },
        el('button', { type: 'button', 'aria-pressed': String(weight(it.kind) > 0), title: `More ${kindInfo(it.kind).label}`, onclick: () => teach(it.kind, +1), text: '👍 more' }),
        el('button', { type: 'button', title: `Less ${kindInfo(it.kind).label}`, onclick: () => teach(it.kind, -1), text: '👎 less' }),
        el('button', { type: 'button', onclick: () => openReply(it), text: '↩ reply' })),
      talkFor(it.id, it));
  }
  function paintFilters() {
    $('#filters').replaceChildren(...FILTERS.map(([k, label]) => el('button', {
      type: 'button', 'aria-pressed': String(filter === k), text: label,
      onclick: () => { filter = k; try { localStorage.setItem('musefeed.filter', k); } catch { /* fine */ } smoothPaint(); },
    })));
  }
  function paint() {
    paintFilters();
    paintStrips(); paintChat();
    $('#gist').hidden = !matters;
    $('#gist-text').replaceChildren(...rich(matters));
    $('#gist-k').textContent = updatedAt ? `What matters right now · ${when(updatedAt)}` : 'What matters right now';
    const gt = talkFor('gist', { id: 'gist', title: `What matters right now: ${matters}`, tag: 'The gist' });
    $('#gist-talk').replaceChildren(...(gt ? [...gt.children] : []));
    $('#gist-reply').parentElement.hidden = !!gt;
    const list = [...items.values()].filter((it) => !muted(it.kind) && inFilter(it)).sort((a, b) => score(b) - score(a)).slice(0, 80);
    const river = $('#river');
    if (!list.length) {
      const empty = items.size === 0;
      river.replaceChildren(el('li', { class: 'empty' },
        el('b', { text: empty ? (live ? 'Nothing here yet' : 'Your feed is waking up') : 'All quiet here' }),
        empty ? 'Claude fills this at its next check, or tap Fresh feed to ask for one now.' : 'Nothing in this view right now. Try Everything.'));
    } else river.replaceChildren(...list.map(itemNode));
    const mutedKinds = Object.keys(prefs.weights).filter(muted);
    $('#muted').hidden = !mutedKinds.length;
    $('#muted').replaceChildren(...(mutedKinds.length ? ['Hidden for you:', ...mutedKinds.map((k) => el('button', {
      type: 'button', text: `${kindInfo(k).label} · show again`,
      onclick: () => { prefs.weights[k] = 0; savePrefs(); smoothPaint(); toast(`${kindInfo(k).label} are back`); },
    }))] : []));
    $('#read').hidden = !(synth && (items.size || matters));
    setStatus();
  }
  setInterval(() => { for (const s of document.querySelectorAll('[data-t]')) s.textContent = ago(+s.dataset.t); }, 60000);

  // ---------- 👍 / 👎 ----------
  function teach(kind, delta) {
    prefs.weights[kind] = Math.max(-3, Math.min(5, weight(kind) + delta));
    savePrefs(); smoothPaint();
    const label = kindInfo(kind).label;
    toast(delta > 0 ? `Got it: more ${label}` : muted(kind) ? `Hidden: ${label}` : `Got it: less ${label}`);
  }
  function savePrefs() {
    prefsDirty = true;
    clearTimeout(prefsTimer); prefsTimer = setTimeout(() => flushPrefs(), 4000);
  }
  async function flushPrefs(keepalive = false) {
    clearTimeout(prefsTimer);
    if (!prefsDirty || !signedIn) return;
    const r = await api('prefs', { method: 'POST', body: { weights: prefs.weights }, keepalive });
    if (r.status === 200) prefsDirty = false;
  }
  addEventListener('pagehide', () => { flushPrefs(true); });

  // ---------- replies to Claude ----------
  let replyTarget = null; let followUp = null; let attach = [];
  const MAX_PICS = 4;
  function openReply(it, prev) {
    replyTarget = it; followUp = prev || null;
    const tell = it.id === 'feed' && !prev;
    $('#sheet-title').textContent = tell ? 'Tell Claude' : 'Reply to Claude';
    $('#sheet-about').textContent = tell ? 'Anything at all: a task, a question, something for your feed, something that looks wrong. Pictures too.' : `About: ${it.title}`;
    $('#sheet-prev').hidden = !(prev && (prev.note || prev.text));
    if (prev) $('#sheet-prev').replaceChildren(el('b', { text: prev.note ? 'Claude' : 'You' }), ' ', ...(prev.note ? rich(prev.note) : [prev.text]));
    $('#sheet-text').value = ''; $('#sheet-err').hidden = true; clearAttach();
    $('#sheet-send').disabled = false; $('#sheet-send').textContent = 'Send to Claude';
    showSoftly($('#sheet')); $('#sheet-text').focus();
  }
  const closeSheet = () => { hideSoftly($('#sheet'), () => { replyTarget = null; followUp = null; clearAttach(); }); };
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

  // Pictures in the reply box: 📎, paste, or drop. Shrunk to 1600 px as a JPEG before they go.
  function clearAttach() { for (const a of attach) URL.revokeObjectURL(a.preview); attach = []; paintAttach(); }
  function paintAttach() {
    $('#sheet-att').hidden = !attach.length;
    $('#sheet-att').replaceChildren(...attach.map((a, i) => el('div', { class: 'att-item' },
      el('img', { src: a.preview, alt: '' }),
      el('button', { type: 'button', 'aria-label': 'Remove this picture', text: '✕', onclick: () => { URL.revokeObjectURL(a.preview); attach.splice(i, 1); paintAttach(); } }))));
    $('#sheet-pic').disabled = attach.length >= MAX_PICS;
  }
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
  async function addPictures(files) {
    const imgs = [...(files || [])].filter((f) => f && /^image\//.test(f.type));
    if (!imgs.length) return false;
    for (const f of imgs) {
      if (attach.length >= MAX_PICS) { toast(`Up to ${MAX_PICS} pictures at a time`); break; }
      try { attach.push(await shrink(f)); } catch { toast('That picture couldn’t be read'); }
      paintAttach();
    }
    return true;
  }
  $('#sheet-pic').addEventListener('click', () => $('#sheet-file').click());
  $('#sheet-file').addEventListener('change', async (e) => { await addPictures(e.target.files); e.target.value = ''; });
  $('#sheet-text').addEventListener('paste', async (e) => {
    const files = e.clipboardData ? [...e.clipboardData.files] : [];
    if (files.some((f) => /^image\//.test(f.type))) { e.preventDefault(); await addPictures(files); }
  });
  const sheetBox = $('#sheet .sheet');
  sheetBox.addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.items].some((i) => i.kind === 'file')) { e.preventDefault(); sheetBox.classList.add('drop'); } });
  sheetBox.addEventListener('dragleave', () => sheetBox.classList.remove('drop'));
  sheetBox.addEventListener('drop', async (e) => { sheetBox.classList.remove('drop'); if (e.dataTransfer && e.dataTransfer.files.length) { e.preventDefault(); await addPictures(e.dataTransfer.files); } });

  function sendError(r) {
    if (r.status === 401) { closeSheet(); showGate('Your sign-in ran out. Sign in again, then send it.'); return ''; }
    if (r.status === 503 && r.data && r.data.error === 'vault_key') return 'Not sent: GitHub refused Muse Feed’s key, so it can’t save to your vault. Tell Claude in your Inbox.';
    if (r.status === 413 || (r.status === 400 && r.data && r.data.error === 'pictures')) return 'Not sent: a picture is too big or isn’t a picture. Try a smaller one.';
    return r.offline ? 'Not sent: you look offline. Try again in a moment.' : 'Not sent. Tap Send to try once more.';
  }
  function remember(reply) {
    if (!reply || !reply.id) return;
    const r = { ...reply, atMs: Date.parse(reply.at) || now() };
    mine.set(r.id, r);
    replies = [...replies.filter((x) => x.id !== r.id), r];
  }
  const aboutFor = (it) => it.about || (it.id === 'feed' ? 'Tell Claude (the feed’s button)'
    : it.id === 'gist' ? `What matters right now: ${matters}`
      : `[${it.tag || (SOURCES[it.source] || SOURCES.vault).label}] ${it.title}${it.detail ? ` (${it.detail})` : ''}`);
  $('#sheet-send').addEventListener('click', async () => {
    const words = $('#sheet-text').value.trim(); const it = replyTarget;
    if (!it) return;
    if (!words && !attach.length) { $('#sheet-err').textContent = 'Write something or add a picture first.'; $('#sheet-err').hidden = false; return; }
    const btn = $('#sheet-send'); btn.disabled = true;
    btn.textContent = attach.length ? `Sending ${attach.length > 1 ? `${attach.length} pictures` : 'the picture'}…` : 'Sending…';
    let about = aboutFor(it);
    if (followUp && followUp.note) about = `${about.slice(0, 200)} · follow-up to: ${followUp.note.slice(0, 190)}`;
    const body = { item: it.id, about: about.slice(0, 400), text: words };
    if (attach.length) body.pictures = attach.map((a) => ({ type: 'image/jpeg', data: a.data }));
    const r = await api('send', { method: 'POST', body });
    if (r.status === 200 && r.data && r.data.reply) {
      remember(r.data.reply); closeSheet(); smoothPaint(); schedule();
      toast(r.data.pinged ? 'Sent. Claude answers right on that card.' : `Saved. Claude sees it at the next check (${nextCheck()}).`);
      return;
    }
    const msg = sendError(r);
    if (msg) { $('#sheet-err').textContent = msg; $('#sheet-err').hidden = false; btn.disabled = false; btn.textContent = 'Send to Claude'; }
  });

  // A card's own buttons, like Merge on a PR card: one tap sends those words to Claude (Moo, Nov 24: "a merge button from there").
  async function runAction(it, a, btn) {
    if (!window.confirm(a.confirm || `${a.label}: ${it.title}?`)) return;
    btn.disabled = true;
    const r = await api('send', { method: 'POST', body: { item: it.id, about: aboutFor(it).slice(0, 400), text: a.text } });
    btn.disabled = false;
    if (r.status === 200 && r.data && r.data.reply) {
      remember(r.data.reply); smoothPaint(); schedule();
      toast(r.data.pinged ? `Sent “${a.text}”. Claude answers on this card.` : `Saved. Claude sees it at the next check (${nextCheck()}).`);
      return;
    }
    const msg = sendError(r);
    if (msg) toast(msg);
  }

  // ---------- pictures, big ----------
  let lightbox = { list: [], i: 0 };
  function showLightbox() {
    const { list, i } = lightbox;
    $('#lb-img').src = picUrl(list[i]);
    $('#lb-count').textContent = list.length > 1 ? `${i + 1} of ${list.length}` : '';
    $('#lb-prev').hidden = list.length < 2; $('#lb-next').hidden = list.length < 2;
  }
  function openLightbox(list, i) { lightbox = { list, i }; showLightbox(); showSoftly($('#lightbox')); $('#lb-close').focus(); }
  function stepLightbox(d) { if (lightbox.list.length > 1) { lightbox.i = (lightbox.i + d + lightbox.list.length) % lightbox.list.length; showLightbox(); } }
  function closeLightbox() { hideSoftly($('#lightbox'), () => $('#lb-img').removeAttribute('src')); }
  $('#lb-close').addEventListener('click', closeLightbox);
  $('#lb-prev').addEventListener('click', () => stepLightbox(-1));
  $('#lb-next').addEventListener('click', () => stepLightbox(1));
  $('#lightbox').addEventListener('click', (e) => { if (e.target === $('#lightbox')) closeLightbox(); });

  $('#tell').addEventListener('click', () => openReply({ id: 'feed', title: 'your feed', tag: 'Feed' }));
  $('#gist-reply').addEventListener('click', () => openReply({ id: 'gist', title: `What matters right now: ${matters}`, tag: 'The gist' }));
  $('#refresh').addEventListener('click', async () => {
    const btn = $('#refresh'); btn.disabled = true;
    const r = await api('send', { method: 'POST', body: { item: 'refresh', about: 'A fresh feed', text: 'Make me a fresh feed, please.' } });
    btn.disabled = false;
    if (r.status === 200 && r.data && r.data.reply) {
      remember(r.data.reply); smoothPaint(); schedule();
      toast(r.data.already ? 'Claude’s already making a fresh one.' : r.data.pinged ? 'Asked Claude for a fresh feed. It shows up here in a few minutes.' : `Saved. Claude makes a fresh one at the next check (${nextCheck()}).`);
      return;
    }
    const msg = sendError(r);
    if (msg) toast(msg);
  });

  // ---------- read it to me ----------
  const plain = (s) => str(s).replace(/https?:\S+/g, '').replace(/[^\p{L}\p{N}\s.,:;!?'’@&()-]/gu, '').trim();
  $('#read').addEventListener('click', () => {
    if (!synth) return;
    const btn = $('#read');
    if (synth.speaking) { synth.cancel(); btn.lastChild.textContent = 'Read it to me'; return; }
    const top = [...items.values()].filter((it) => !muted(it.kind)).sort((a, b) => score(b) - score(a)).slice(0, 7);
    const lines = [`${$('#greet').textContent}.`, matters ? plain(matters) : '', ...top.map((it) => `${plain(it.title)}. ${plain(it.detail)}`)].filter(Boolean);
    lines.forEach((t, i) => {
      const u = new SpeechSynthesisUtterance(t); u.rate = 1.03;
      if (i === lines.length - 1) u.onend = () => { btn.lastChild.textContent = 'Read it to me'; };
      synth.speak(u);
    });
    btn.lastChild.textContent = 'Stop reading';
  });

  // ---------- install ----------
  let installEvent = null;
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e; $('#install').hidden = false; });
  $('#install').addEventListener('click', async () => {
    if (!installEvent) return;
    installEvent.prompt();
    try { await installEvent.userChoice; } catch { /* fine */ }
    installEvent = null; $('#install').hidden = true;
  });
  if ('serviceWorker' in navigator) addEventListener('load', () => { navigator.serviceWorker.register('/feed/sw.js', { scope: '/feed/' }).catch(() => {}); });

  setStatus(); boot();
})();
