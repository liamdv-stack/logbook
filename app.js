/* ---------- HELPERS ---------- */
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const TRAIN = [0, 1, 3, 4];
const $ = (s, r = document) => r.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => { if (v === '' || v == null) return null; const n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? null : n; };
const pad = n => String(n).padStart(2, '0');
const keyOf = dt => dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate());
const parseKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (dt, n) => { const x = new Date(dt); x.setDate(x.getDate() + n); return x; };
const todayKey = () => keyOf(new Date());
const fmtDate = (dt, o = { weekday: 'long', day: 'numeric', month: 'long' }) => dt.toLocaleDateString('en-GB', o);
const clone = o => JSON.parse(JSON.stringify(o));
const mondayOf = dt => addDays(dt, -((dt.getDay() + 6) % 7));
const sid = (w, d) => 'w' + pad(w) + '-' + DAYS[d];
const ckid = w => 'w' + pad(w);
const ord = (w, d) => w * 7 + d;
function dateOf(w, d) { return addDays(parseKey(S.settings.startDate), (w - 1) * 7 + d); }
function posOf(dt) {
  const s = parseKey(S.settings.startDate);
  const t = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
  const diff = Math.round((t - s) / 864e5);
  return { w: Math.floor(diff / 7) + 1, d: ((diff % 7) + 7) % 7 };
}
const phaseOf = w => PHASES.find(p => w >= p.from && w <= p.to) || PHASES[0];

/* ---------- STATE ---------- */
const LS = 'cal16-state-v1';
let S = { settings: { startDate: '2026-09-21', branch: 'B', height: '172', age: '', _u: 0 }, bw: { entries: {}, _u: 0 }, sessions: {}, checkins: {}, weeks: {}, food: {}, foodMeta: null };
let dirty = new Set();
try {
  const raw = localStorage.getItem(LS);
  if (raw) { const o = JSON.parse(raw); if (o && o.S) { S = Object.assign(S, o.S); dirty = new Set(o.dirty || []); } }
} catch (e) { }
if (!S.food) S.food = {};
function persist() { try { localStorage.setItem(LS, JSON.stringify({ S, dirty: [...dirty] })); } catch (e) { } }

let V = { tab: 'day', w: 1, d: 0, showRed: false, cmpA: '', cmpB: '', cmpSlot: 'front' };
function goToday() {
  const p = posOf(new Date());
  if (p.w < 1) { V.w = 1; V.d = 0; } else if (p.w > 16) { V.w = 16; V.d = 6; } else { V.w = p.w; V.d = p.d; }
}
goToday();

/* ---------- SYNC (Supabase, local-first: every change is saved on the phone first) ---------- */
const CFG = window.APP_CONFIG || {};
let sb = null, user = null, syncState = 'local', lastSyncErr = '';
const timers = {}, inflight = {};
const COLLS = ['sessions', 'checkins', 'weeks', 'food'];
function getDoc(path) {
  const [c, id] = path.split('/');
  if (c === 'meta') return id === 'settings' ? S.settings : id === 'bw' ? S.bw : id === 'food' ? foodMeta() : id === 'mind' ? S.mindMeta : null;
  return S[c] ? S[c][id] : null;
}
function setDocLocal(path, data) {
  const [c, id] = path.split('/');
  if (c === 'meta') { if (id === 'settings') S.settings = data; else if (id === 'bw') S.bw = data; else if (id === 'food') S.foodMeta = data; else if (id === 'mind') S.mindMeta = data; }
  else { if (!S[c]) S[c] = {}; S[c][id] = data; }
}
function allPaths() {
  const out = ['meta/settings', 'meta/bw'];
  if (S.foodMeta) out.push('meta/food');
  COLLS.forEach(c => Object.keys(S[c] || {}).forEach(id => out.push(c + '/' + id)));
  return out;
}
function touch(path) {
  const d = getDoc(path); if (!d) return;
  d._u = Date.now(); dirty.add(path); persist(); schedule(path); setSync();
}
function schedule(path, ms = 700) { clearTimeout(timers[path]); timers[path] = setTimeout(() => flush(path), ms); }
function flushAll() { dirty.forEach(p => { if (!inflight[p]) flush(p); }); }
function flush(path) {
  if (!sb || !user) return;
  if (inflight[path]) { inflight[path].then(() => schedule(path, 200)); return; }
  const d = getDoc(path); if (!d) { dirty.delete(path); return; }
  const u = d._u;
  inflight[path] = sb.from('docs').upsert({ user_id: user.id, path, data: clone(d), updated_at: new Date().toISOString() }, { onConflict: 'user_id,path' })
    .then(({ error }) => {
      if (error) { lastSyncErr = error.message || 'error'; return; }
      lastSyncErr = ''; const cur = getDoc(path); if (cur && cur._u === u) { dirty.delete(path); persist(); }
    })
    .catch(e => { lastSyncErr = (e && e.message) || 'offline'; })
    .finally(() => { inflight[path] = null; setSync(); });
}
function setSync() {
  syncState = !sb ? 'local' : !user ? 'signedout' : (lastSyncErr ? 'pending' : (dirty.size ? 'pending' : 'ok'));
  document.querySelectorAll('.sync').forEach(el => { el.className = 'sync ' + (syncState === 'signedout' ? 'local' : syncState); el.title = syncLabel(); });
  const t = $('#synctext'); if (t) t.textContent = syncLabel();
}
function syncLabel() {
  if (syncState === 'ok') return 'Backed up to your account';
  if (syncState === 'pending') return navigator.onLine === false ? 'Saved on this phone — syncs when you’re back online' : 'Saved on this phone — syncing';
  if (syncState === 'signedout') return 'Saved on this phone only — sign in to back it up';
  return 'Saved on this phone only — online backup not set up yet';
}
function applyRemote(path, data) {
  if (!data || typeof data !== 'object') return false;
  const local = getDoc(path);
  const ru = data._u || 0, lu = local ? (local._u || 0) : -1;
  if (local && lu >= ru) { if (lu > ru) { dirty.add(path); schedule(path); } return false; }
  setDocLocal(path, clone(data));
  return true;
}
let pulling = false;
async function pull() {
  if (!sb || !user || pulling) return; pulling = true;
  try {
    const { data, error } = await sb.from('docs').select('path,data');
    if (error) { lastSyncErr = error.message; return; }
    let ch = false; const remote = new Set();
    (data || []).forEach(r => { remote.add(r.path); if (applyRemote(r.path, r.data)) ch = true; });
    allPaths().forEach(p => { const d = getDoc(p); if (!remote.has(p) && d && d._u) dirty.add(p); });
    lastSyncErr = '';
    if (ch) { persist(); requestRender(); }
    flushAll();
  } catch (e) { lastSyncErr = 'offline'; }
  finally { pulling = false; setSync(); }
}
async function initSync() {
  if (!window.supabase || !CFG.supabaseUrl || !CFG.supabaseKey || /PASTE/.test(CFG.supabaseUrl + CFG.supabaseKey)) { setSync(); return; }
  try {
    sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'cal16-auth' } });
    const { data } = await sb.auth.getSession(); user = data?.session?.user || null;
    sb.auth.onAuthStateChange((ev, session) => {
      const was = user; user = session?.user || null; setSync();
      if (user && (!was || was.id !== user.id)) { pull(); }
      if (V.tab === 'settings') requestRender();
    });
  } catch (e) { sb = null; }
  setSync();
  if (user) pull();
  setInterval(() => { if (user) { pull(); } }, 60000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && user) pull(); });
  window.addEventListener('online', () => { if (user) pull(); });
}
async function signIn(mode) {
  const email = ($('#au-email')?.value || '').trim(), pw = $('#au-pw')?.value || '';
  if (!sb) { toast('Online backup isn’t set up yet'); return; }
  if (!email || pw.length < 6) { toast('Enter your email and a password of 6+ characters'); return; }
  const r = mode === 'up' ? await sb.auth.signUp({ email, password: pw }) : await sb.auth.signInWithPassword({ email, password: pw });
  if (r.error) { toast(r.error.message); return; }
  if (mode === 'up' && !r.data.session) { toast('Account created — confirm the email Supabase sent you, then sign in'); return; }
  toast('Signed in — backing up your logs'); render();
}
async function signOut() { if (sb) await sb.auth.signOut(); user = null; setSync(); render(); }

let pendingRender = false;
function requestRender() {
  const a = document.activeElement;
  if (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName) && $('#main').contains(a)) { pendingRender = true; return; }
  render();
}
document.addEventListener('focusout', () => { if (pendingRender) setTimeout(() => { const a = document.activeElement; if (!(a && /INPUT|TEXTAREA|SELECT/.test(a.tagName))) { pendingRender = false; render(); } }, 50); });

/* ---------- SESSION HELPERS ---------- */
function peekSess(w, d) { return S.sessions[sid(w, d)]; }
function sess(w, d) {
  const id = sid(w, d);
  if (!S.sessions[id]) S.sessions[id] = { week: w, day: d, ex: {}, wu: {}, cd: {}, _u: 0 };
  const s = S.sessions[id]; s.ex = s.ex || {}; s.wu = s.wu || {}; s.cd = s.cd || {};
  return s;
}
function exState(s, exId) { if (!s.ex[exId]) s.ex[exId] = { lvl: '', sets: [], rir: '', note: '' }; const e = s.ex[exId]; e.sets = e.sets || []; return e; }
function saveSess(w, d) { const s = sess(w, d); if (!s.loggedOn) s.loggedOn = todayKey(); touch('sessions/' + sid(w, d)); }
function anyLogged(s) {
  if (!s) return false;
  if (s.status === 'done') return true;
  if (s.ex && Object.values(s.ex).some(e => (e.sets || []).some(x => x && x.d))) return true;
  return false;
}
function status(w, d) {
  const s = peekSess(w, d); const isTrain = TRAIN.includes(d);
  const k = keyOf(dateOf(w, d)), t = todayKey();
  if (s && s.status === 'done') return 'done';
  if (isTrain && anyLogged(s)) return k < t ? 'partial' : 'progress';
  if (!isTrain) return s && s.yoga && Object.values(s.yoga).some(Boolean) ? 'done' : 'rest';
  if (k < t) return 'missed';
  return 'future';
}
const dayEx = d => (PROGRAM[d] ? PROGRAM[d].ex : []);

/* ---------- PROGRESSION ENGINE ---------- */
function setCount(e, pl) { return e && e.n != null ? e.n : Math.max(pl.n, (e && e.sets ? e.sets.length : 0)); }
function targetAt(pl, i) { return pl.targets[i] ?? (pl.targets.length ? pl.targets[pl.targets.length - 1] : null); }
function setsFor(ex, w) {
  const [mn, mx] = ex.sets; const main = ex.role === 'main' ? 1 : 0;
  if (w <= 4) return mn;
  if (w <= 6) return mx;
  if (w <= 8) return mx + main;
  if (w === 9) return Math.max(1, Math.ceil(mx / 2));
  if (w <= 15) return mx + main;
  return Math.max(1, Math.round((mx + main) * 0.7));
}
function history(ex, w, d) {
  let best = null; const here = ord(w, d);
  for (const s of Object.values(S.sessions)) {
    if (!s || !s.ex) continue;
    const o = ord(s.week, s.day); if (o >= here) continue;
    for (const def of dayEx(s.day)) {
      if (def.track !== ex.track) continue;
      const e = s.ex[def.id]; if (!e) continue;
      const reps = (e.sets || []).filter(x => x && x.d && num(x.r) != null).map(x => num(x.r));
      if (reps.length && (!best || o > best.o)) best = { o, week: s.week, day: s.day, reps, lvl: e.lvl || '', load: e.load || '', label: lvlLabel(e), light: s.light };
    }
  }
  return best;
}
const WEIGHTS = ['Bodyweight'].concat(Array.from({ length: 30 }, (_, i) => ((i + 1) * 2) + ' kg'));
function lvlOptions(ex) { return ex.ladder ? LADDERS[ex.ladder] : WEIGHTS; }
function lvlLabel(e) { return [e && e.lvl, e && e.load].filter(x => x && String(x).trim()).join(' · '); }
function unitWord(ex) { return ex.unit === 'reps' ? 'reps' : ex.unit === 's' ? 's' : ex.unit; }
function plan(ex, w, d, light) {
  const n = setsFor(ex, w); const h = history(ex, w, d);
  const r = { n, h, targets: [], levelUp: false, msg: '', cls: '' };
  if (ex.kind === 'free') {
    r.targets = Array(n).fill(null);
    if (ex.track === 'hs') r.msg = h ? `Best hold last time: <b>${Math.max(...h.reps)} s</b>. Log your best hold on each attempt.` : 'Log your best hold on each attempt.';
    else if (ex.track === 'lsit') r.msg = (h ? `Last time: <b>${h.reps.reduce((a, b) => a + b, 0)} s total</b>. ` : '') + 'Accumulate ~60 s in quality holds.';
    else if (ex.track === 'mu') r.msg = `<b>${phaseOf(w).name}:</b> ` + (w <= 4 ? 'false-grip hang + chest-to-bar pull-ups.' : w <= 8 ? 'high pull-ups to the navel.' : w === 9 ? 'easy practice only.' : 'negative and jump muscle-ups — only once you have 8+ strict pull-ups and 10+ dips.');
    return r;
  }
  if (!h) {
    r.targets = Array(n).fill(ex.lo);
    r.msg = `First time: pick a level where ${ex.lo}–${ex.hi} ${unitWord(ex)} are clean with ${ex.rir} in reserve.`;
    return r;
  }
  const hitTop = h.reps.length >= Math.min(ex.sets[0], 3) && h.reps.every(x => x >= ex.hi);
  if (hitTop && w !== 9 && w !== 16 && light !== 'amber') {
    r.levelUp = true; r.cls = 'up';
    r.targets = Array(n).fill(ex.lo);
    r.msg = `<b>Level up.</b> You hit ${ex.hi} on every set last time. ${ex.prog} Restart at ${ex.lo}.`;
    return r;
  }
  const hold = w === 9 || w === 16 || light === 'amber';
  const step = ex.step || 1;
  for (let i = 0; i < n; i++) {
    const base = h.reps[Math.min(i, h.reps.length - 1)];
    r.targets.push(hold ? Math.min(base, ex.hi) : Math.min(ex.hi, base + step));
  }
  if (w === 9) { r.msg = 'Deload: match last time at an easy effort (3–4 in reserve). No PR attempts.'; r.cls = 'warn'; }
  else if (w === 16) { r.msg = 'Test week: technique and clean reps only.'; }
  else if (light === 'amber') { r.msg = 'Amber day: repeat last time at ~3 in reserve — no increase.'; r.cls = 'warn'; }
  else r.msg = `Beat last time by ${step === 1 ? 'one rep' : step + ' ' + unitWord(ex)} per set where you can, keeping ${ex.rir} in reserve.`;
  return r;
}

/* ---------- RENDER: DAY ---------- */
function header() {
  const ph = phaseOf(V.w);
  let strip = '';
  const t = todayKey();
  for (let d = 0; d < 7; d++) {
    const dt = dateOf(V.w, d); const st = status(V.w, d);
    const cls = ['dd', TRAIN.includes(d) ? 'train' : 'rest', 'st-' + st, keyOf(dt) === t ? 'today' : '', d === V.d ? 'cur' : ''].join(' ');
    strip += `<button class="${cls}" data-a="goto" data-w="${V.w}" data-d="${d}" aria-label="${DAY_NAMES[d]} ${fmtDate(dt, { day: 'numeric', month: 'short' })}"><span>${DAY_NAMES[d].slice(0, 3)}</span><b class="num">${dt.getDate()}</b><i></i></button>`;
  }
  const p = posOf(new Date());
  const onToday = p.w === V.w && p.d === V.d;
  return `<div class="top">
    <div class="hbar">
      <button class="ib" data-a="wprev" ${V.w <= 1 ? 'disabled' : ''} aria-label="Previous week">‹</button>
      <div class="wk"><b class="num">Week ${V.w}</b><span>${esc(ph.name)}</span></div>
      <button class="ib" data-a="wnext" ${V.w >= 16 ? 'disabled' : ''} aria-label="Next week">›</button>
      <button class="pill ${onToday ? 'on' : ''}" data-a="today">Today</button>
      <span class="sync ${syncState}" id="syncdot" title="${syncLabel()}"></span>
    </div>
    <div class="strip">${strip}</div>
  </div>`;
}

function bwRow(dt) {
  const k = keyOf(dt); const v = S.bw.entries?.[k] ?? '';
  return `<div class="bwrow"><label for="bw-${k}">Morning weight<small>Weigh 3–4 mornings a week</small></label>
    <input id="bw-${k}" class="num" inputmode="decimal" data-f="bw" data-k="${k}" value="${esc(v)}" placeholder="kg"><span class="muted small">kg</span></div>`;
}

function renderDay() {
  const w = V.w, d = V.d, dt = dateOf(w, d), ph = phaseOf(w);
  const p = posOf(new Date());
  let h = header();
  if (p.w < 1) h += `<div class="banner info">The program starts on <b>${fmtDate(parseKey(S.settings.startDate))}</b>. You can change the start date in Settings.</div>`;
  if (p.w > 16) h += `<div class="banner good">All 16 weeks are behind you. Check Progress for the full picture.</div>`;
  if (!TRAIN.includes(d)) return h + renderRest(w, d, dt);
  const P = PROGRAM[d]; const s = peekSess(w, d) || {}; const light = s.light || '';
  const st = status(w, d);
  const stChip = st === 'done' ? '<span class="chip good">✓ Done</span>' : st === 'missed' ? '<span class="chip bad">Missed — you can still log it</span>' : st === 'partial' ? '<span class="chip warn">Partly logged</span>' : '';
  h += `<div class="dayhead">
    <div class="dt">${fmtDate(dt)}</div>
    <h1>${DAY_NAMES[d]}</h1>
    <h2>${esc(P.title)}${P.withMichelle ? ' · with Michelle' : ''}</h2>
    <div class="chips"><span class="chip acc">${esc(ph.name)}</span><span class="chip">${esc(ph.rir)}</span>${stChip}</div>
    <p class="intro">${esc(P.intro)}</p>
  </div>`;
  if (w === 9) h += `<div class="banner warn"><b>Deload week.</b> About half the sets, same exercises, moderate effort. One easy week costs no muscle.</div>`;
  if (w >= 10 && w <= 13) h += `<div class="banner info"><b>Skill + Strength block.</b> Take the final set of each strength exercise to 0–1 in reserve.</div>`;

  h += foodBar(keyOf(dt));
  h += bwRow(dt);
  if (d === 0 && (CHECKIN_WEEKS.includes(w) || w === 9)) h += renderCheckin(w);

  // traffic light
  h += `<div class="blk"><div class="bh"><h3>How do you feel?</h3><span class="lbl">Traffic light</span></div><div class="bb">
    <div class="lights">${['green', 'amber', 'red'].map(k => `<button class="lt ${k} ${light === k ? 'on' : ''}" data-a="light" data-v="${k}" aria-pressed="${light === k}"><span class="dot"></span>${LIGHTS[k].name}</button>`).join('')}</div>
    <div class="ltinfo">${light ? `<b>${LIGHTS[light].what}</b>` : 'Tap the one that fits before you start.'}</div>
    ${light ? '' : `<div class="ltinfo small muted">Green: ${LIGHTS.green.when}. Amber: ${LIGHTS.amber.when}. Red: ${LIGHTS.red.when}.</div>`}
  </div></div>`;

  // warm-up
  const warm = P.warm.filter(x => !x.minWeek || w >= x.minWeek);
  h += checklist('Warm-up', P.warmTime, warm, s.wu || {}, 'wu', !s.status);

  // workout
  if (light === 'red' && !V.showRed) {
    h += `<div class="sec"><h3>Workout</h3></div>
      <div class="banner bad"><b>Recovery day.</b> Skip the planned session. Do the shoulder routine and gentle mobility instead, and regress whatever hurts next time. If the pain is sharp or keeps coming back, get it assessed.
      <button class="big ghost" data-a="showred">Show the workout anyway</button></div>`;
  } else {
    const exs = P.ex;
    const doneSets = exs.reduce((a, ex) => a + ((s.ex?.[ex.id]?.sets || []).filter(x => x && x.d).length), 0);
    h += `<div class="sec"><h3>Workout</h3><span class="cnt num">${doneSets} sets logged</span></div>`;
    exs.forEach(ex => { h += exCard(ex, w, d, s, light); });
  }

  h += checklist('Cool-down', P.coolTime, P.cool, s.cd || {}, 'cd', false);

  // finish
  if (s.status === 'done') {
    h += `<div class="blk"><div class="bb" style="padding-top:16px"><div class="done-card"><div class="ok">✓</div><div><b>Session done</b><div class="small muted">${s.rpe ? 'Effort ' + esc(s.rpe) + '/10' : ''}${s.hip ? ' · Left hip: ' + esc(s.hip) : ''}</div></div></div>
      ${s.notes ? `<p class="small">${esc(s.notes)}</p>` : ''}
      <button class="big ghost" data-a="reopen">Edit session</button></div></div>`;
  } else {
    h += `<div class="blk"><div class="bh"><h3>Finish</h3></div><div class="bb">
      <div class="fld"><label>How hard was the session? (1–10)</label><div class="seg">${[5, 6, 7, 8, 9, 10].map(v => `<button class="${String(s.rpe) === String(v) ? 'on' : ''}" data-a="rpe" data-v="${v}">${v}</button>`).join('')}</div></div>
      <div class="fld" style="margin-top:12px"><label>Left hip</label><div class="seg">${['OK', 'Niggle', 'Sore'].map(v => `<button class="${s.hip === v ? 'on' : ''}" data-a="hip" data-v="${v}">${v}</button>`).join('')}</div></div>
      <div class="fld" style="margin-top:12px"><label for="snotes">Notes</label><textarea id="snotes" data-f="snotes" placeholder="Anything worth remembering">${esc(s.notes || '')}</textarea></div>
      <button class="big" data-a="finish">Finish session</button>
    </div></div>`;
  }
  h += `<details class="blk"><summary><h3>Substitutions</h3><span class="chev">›</span></summary><div class="bb small">${esc(P.subs)}</div></details>`;
  return h;
}

/* ---------- DEMO LINKS (search links — never break) ---------- */
const ytUrl = q => 'https://www.google.com/search?q=' + encodeURIComponent(q + ' proper form');
const imgUrl = q => 'https://www.google.com/search?tbm=isch&q=' + encodeURIComponent(q + ' exercise form');
const GUIDES = {
  hs: { url: 'https://odin.fitness/blog/handstand-progression-90-day-plan', name: 'Odin Fitness handstand guide' },
  pistol: { url: 'https://thebarbellphysio.com/pistol-squat/', name: 'Barbell Physio pistol guide' },
  lsit: { url: 'https://antranik.org/l-sit-tutorial/', name: 'Antranik L-sit tutorial' },
  mu: { url: 'https://gmb.io/muscle-up/', name: 'GMB muscle-up guide' },
};
// default search + the keyword appended to a typed level (so "archer" → "archer push-up")
const EXQ = {
  pistol: ['single leg box squat pistol progression', 'pistol squat'], bss: ['bulgarian split squat', 'split squat', false],
  rdl: ['dumbbell romanian deadlift', 'romanian deadlift', false], slgb: ['single leg glute bridge', 'glute bridge'],
  calf: ['standing calf raise', 'calf raise', false], lsit_mon: ['tuck l-sit', 'l-sit'], lsit_fri: ['tuck l-sit', 'l-sit'],
  hlr: ['hanging knee raise', 'hanging leg raise'], hs_tue: ['chest to wall handstand', 'handstand'], hs_fri: ['chest to wall handstand', 'handstand'],
  row_tue: ['feet elevated ring row', 'row'], row_thu: ['ring row', 'row'], push_tue: ['diamond push-up', 'push-up'], push_fri: ['archer push-up', 'push-up'],
  pike_tue: ['pike push-up', 'pike push-up'], pike_fri: ['pike push-up', 'pike push-up'], sideplank: ['side plank', 'side plank'],
  pallof: ['pallof press', 'pallof press', false], carry: ['suitcase carry', 'suitcase carry', false], mu: ['false grip hang', 'muscle-up'],
  chin: ['chin-up', 'chin-up', false], facepull: ['face pull', 'face pull', false], wristcurl: ['wrist curls palms up palms down', 'wrist curl', false],
  dips: ['parallel bar dips', 'dips'], hollow: ['hollow body hold', 'hollow body'],
};
function demoQuery(ex, lvl) {
  const m = EXQ[ex.id] || [ex.name, ex.name];
  let q = m[0];
  if (ex.track === 'pullup') q = { A: 'pull-up negatives', B: 'strict pull-up', C: 'explosive high pull-up' }[S.settings.branch] || 'strict pull-up';
  if (lvl && m[2] !== false) {
    const l = String(lvl).replace(/\+?\s*\d+([.,]\d+)?\s*kg/gi, ' ').replace(/[—–()\/]/g, ' ').replace(/\s+/g, ' ').trim();
    if (l.length > 2) q = l.toLowerCase().includes(m[1].toLowerCase()) ? l : l + ' ' + m[1];
  }
  return q;
}
function exLevel(ex, w, d) { const s = peekSess(w, d); const e = s?.ex?.[ex.id]; if (e && e.lvl) return e.lvl; const h = history(ex, w, d); return h ? h.lvl : ''; }
const NO_DEMO = /easy movement|easy general|easy walk|relaxed walk|family walk|ramp-up|^mobility$|gentle mobility/i;
const ITEM_Q = {
  'Banded lateral (monster) walk': 'banded monster walk', 'Ankle knee-to-wall': 'knee to wall ankle mobility',
  'Wrist circles + gentle wrist-loading rocks': 'wrist warm up for handstand', 'Band pull-aparts / external rotations': 'band pull apart',
  'Active hang or scapular pull-ups': 'scapular pull-ups', 'Wrist circles + palms-down / palms-up rocks': 'wrist warm up for handstand',
  'Palms-down rocks': 'wrist rocks warm up', 'Palms-up rocks': 'palms up wrist rocks', 'Chest-to-wall lean': 'chest to wall handstand lean',
  'Band pull-aparts + external rotations': 'band external rotation', 'Lat / child’s-pose reach': 'child pose lat stretch',
  'Hip-stability circuit': 'glute medius hip stability exercises', 'Optional: handstand line work or L-sit tucks': 'handstand line drills',
  '1 easy pike hold': 'pike hold', 'Lat stretch': 'lat stretch', 'Front-of-shoulder stretch': 'front shoulder stretch',
};

function checklist(title, time, items, state, key, open) {
  const n = items.filter((_, i) => state[i]).length;
  return `<details class="blk" ${open ? 'open' : ''}><summary><h3>${title}</h3><span class="cnt num ${n === items.length ? 'full' : ''}">${n}/${items.length}</span><span class="lbl">${esc(time)}</span><span class="chev">›</span></summary>
    <div class="bb">${items.map((it, i) => {
      const q = it.q || (NO_DEMO.test(it.t) ? '' : (ITEM_Q[it.t] || it.t));
      return `<div class="chkrow"><button class="chk ${state[i] ? 'on' : ''}" data-a="${key}" data-i="${i}" aria-pressed="${!!state[i]}"><span class="box">✓</span><span><span class="ct">${esc(it.t)}</span>${it.d ? `<span class="cd">${esc(it.d)}</span>` : ''}</span></button>${q ? `<a class="mini" href="${ytUrl(q)}" target="_blank" rel="noopener" aria-label="Search how to do ${esc(it.t)}">↗</a>` : ''}</div>`;
    }).join('')}</div></details>`;
}

function exCard(ex, w, d, s, light) {
  const e = s.ex?.[ex.id] || { lvl: '', sets: [], rir: '', note: '' };
  const pl = plan(ex, w, d, light);
  const rows = setCount(e, pl);
  const done = (e.sets || []).filter(x => x && x.d).length;
  const skip = light === 'amber' && ex.role === 'acc';
  const roleTxt = { skill: 'Skill · first, fresh', main: 'Main lift', acc: 'Accessory', std: '' }[ex.role];
  const unit = ex.unit === 'reps / s' ? 'reps/s' : ex.unit;
  let rowsH = '';
  for (let i = 0; i < rows; i++) {
    const st = (e.sets || [])[i] || {}; const t = targetAt(pl, i) ?? '';
    rowsH += `<div class="set ${st.d ? 'done' : ''}"><span class="sn">${i + 1}</span>
      <div class="step"><button data-a="dec" data-ex="${ex.id}" data-i="${i}" aria-label="Less">−</button>
      <input class="num" id="r-${ex.id}-${i}" inputmode="decimal" data-f="rep" data-ex="${ex.id}" data-i="${i}" value="${esc(st.r ?? '')}" placeholder="${t}" aria-label="Set ${i + 1} ${unit}">
      <button data-a="inc" data-ex="${ex.id}" data-i="${i}" aria-label="More">+</button></div>
      <span class="su">${esc(unit)}</span>
      <button class="tick" data-a="tick" data-ex="${ex.id}" data-i="${i}" aria-pressed="${!!st.d}" aria-label="Set ${i + 1} done">✓</button></div>`;
  }
  const hi = pl.h;
  const last = hi ? `<div class="last">Last time (Wk ${hi.week} ${DAY_NAMES[hi.day].slice(0, 3)}): <b class="num">${hi.reps.join(' · ')}</b>${hi.label ? ' @ ' + esc(hi.label) : ''}</div>` : '';
  const opts = lvlOptions(ex); const cur = e.lvl || ''; const custom = !!cur && !opts.includes(cur); const other = custom || !!(V.other && V.other[ex.id]);
  const lvlPh = cur ? '' : (hi && hi.lvl && !pl.levelUp ? 'Last: ' + hi.lvl : (ex.ladder ? 'Choose level' : 'Choose weight'));
  const lvlH = `<div class="lvl"><label for="lvl-${ex.id}">${ex.ladder ? 'Level' : 'Weight'}</label>
      <select id="lvl-${ex.id}" data-f="lvlsel" data-ex="${ex.id}"><option value="">${esc(lvlPh)}</option>${opts.map(o => `<option value="${esc(o)}" ${o === cur ? 'selected' : ''}>${esc(o)}</option>`).join('')}<option value="__other" ${other ? 'selected' : ''}>Other…</option></select></div>
    ${other ? `<div class="lvl"><label for="lvlo-${ex.id}">Other</label><input id="lvlo-${ex.id}" data-f="lvl" data-ex="${ex.id}" value="${esc(custom ? cur : '')}" placeholder="Type the variation" autocomplete="off"></div>` : ''}
    ${ex.ladder ? `<div class="lvl"><label for="load-${ex.id}">Load</label><input id="load-${ex.id}" data-f="load" data-ex="${ex.id}" value="${esc(e.load || '')}" placeholder="${hi && hi.load && !pl.levelUp ? 'Last: ' + esc(hi.load) : 'e.g. +5 kg, green band, box 45 cm'}" autocomplete="off"></div>` : ''}`;
  const branch = ex.branch ? `<p><b>Your branch ${esc(S.settings.branch)}:</b> ${esc(BRANCHES[S.settings.branch].plan)} ${esc(BRANCHES[S.settings.branch].next)}</p>` : '';
  const total = ex.track === 'lsit' ? `<div class="total num">Total today: <b>${(e.sets || []).filter(x => x && x.d).reduce((a, x) => a + (num(x.r) || 0), 0)} s</b> of ~60 s</div>` : '';
  const fin = (w >= 10 && w <= 13 && ex.kind !== 'free') ? `<div class="fin">Final set: 0–1 in reserve</div>` : '';
  let hint = pl.msg;
  let hcls = pl.cls;
  if (skip) { hint = '<b>Amber day: skip this one.</b> ' ; hcls = 'warn'; }
  else if (light === 'amber' && ex.role === 'skill') { hint = '<b>Amber day:</b> skills at ~60% effort. ' + hint; hcls = 'warn'; }
  return `<section class="ex ${skip ? 'skip' : ''} ${done >= rows ? 'complete' : ''}" id="ex-${ex.id}">
    <div class="exh"><div class="nm">${roleTxt ? `<span class="role ${ex.role}">${roleTxt}</span>` : ''}<h3>${esc(ex.name)}</h3>${ex.sub ? `<div class="sb2">${esc(ex.sub)}</div>` : ''}</div>
      <div class="exr"><span class="cnt num ${done >= rows ? 'full' : ''}">${done}/${rows}</span>
      <a class="demo" data-a="demo" data-ex="${ex.id}" data-kind="yt" href="${ytUrl(demoQuery(ex, exLevel(ex, w, d)))}" target="_blank" rel="noopener" aria-label="Search how to do ${esc(ex.name)}">Demo ↗</a></div></div>
    <div class="meta"><span><b class="num">${rows}</b> × ${esc(ex.reps)}${rows !== pl.n ? ` <span class="muted">(plan ${pl.n})</span>` : ''}</span><span>RIR <b>${esc(ex.rir)}</b></span><span>Rest <b>${esc(ex.restTxt)}</b></span></div>
    ${hint ? `<div class="hint ${hcls}">${hint}</div>` : ''}
    ${last}
    ${lvlH}
    <div class="sets">${rowsH}</div>${fin}${total}
    <div class="exfoot"><button class="addset" data-a="addset" data-ex="${ex.id}">+ Add set</button>${rows > 1 ? `<button class="addset rm" data-a="rmset" data-ex="${ex.id}">− Remove set</button>` : ''}
      ${ex.kind === 'free' ? '' : `<div class="rir"><span>Final RIR</span>${['0', '1', '2', '3', '4+'].map(v => `<button class="${e.rir === v ? 'on' : ''}" data-a="rir" data-ex="${ex.id}" data-v="${v}">${v}</button>`).join('')}</div>`}</div>
    <details class="exmore"><summary>Cue, progression and notes</summary>
      <div class="links"><a data-a="demo" data-ex="${ex.id}" data-kind="yt" href="${ytUrl(demoQuery(ex, exLevel(ex, w, d)))}" target="_blank" rel="noopener">Google ↗</a><a data-a="demo" data-ex="${ex.id}" data-kind="img" href="${imgUrl(demoQuery(ex, exLevel(ex, w, d)))}" target="_blank" rel="noopener">Pictures</a>${GUIDES[ex.track] ? `<a href="${GUIDES[ex.track].url}" target="_blank" rel="noopener" title="${esc(GUIDES[ex.track].name)}">Guide ↗</a>` : ''}</div>
      <p><b>Cue:</b> ${esc(ex.cue)}</p><p><b>Progression:</b> ${esc(ex.prog)}</p>${branch}<p class="muted">${esc(ex.note)}</p>
      <input class="note" id="note-${ex.id}" data-f="note" data-ex="${ex.id}" value="${esc(e.note || '')}" placeholder="Note for this exercise">
    </details>
  </section>`;
}

function renderRest(w, d, dt) {
  const R = REST_DAYS[d]; const s = peekSess(w, d) || {};
  let h = `<div class="dayhead"><div class="dt">${fmtDate(dt)}</div><h1>${DAY_NAMES[d]}</h1><h2>${esc(R.title)}</h2>
    <div class="chips"><span class="chip acc">${esc(phaseOf(w).name)}</span><span class="chip">Rest day</span></div>
    <p class="intro">${esc(R.rule)}</p></div>`;
  h += foodBar(keyOf(dt));
  h += bwRow(dt);
  h += checklist('Optional today', d === 2 ? 'grease the groove' : 'easy', R.items, s.rest || {}, 'rest', false);
  const Y = YOGA[d];
  if (Y) {
    h += `<div class="sec"><h3>Yoga</h3></div>`;
    h += checklist(Y.name, Y.time, Y.items, s.yoga || {}, 'yoga', true).replace('<details class="blk"', '<details class="blk yoga"');
    h += `<div class="bwrow"><label for="yogamin">Yoga time done<small>Minutes, roughly</small></label><input id="yogamin" class="num" inputmode="numeric" data-f="yogamin" value="${esc(s.yogaMin ?? '')}" placeholder="min"><span class="muted small">min</span></div>`;
    h += `<p class="small muted">Easy stretching only — breathe and ease in, never into pain. If the left hip complains, swap lizard or figure-four for a gentle supine twist.</p>`;
  }
  if (d === 6) h += renderWeekly(w);
  return h;
}

/* ---------- CHECK-IN ---------- */
function ck(w) { const id = ckid(w); if (!S.checkins[id]) S.checkins[id] = { week: w, photos: {}, _u: 0 }; return S.checkins[id]; }
function renderCheckin(w) {
  const c = S.checkins[ckid(w)] || {}; const measureOnly = w === 9;
  const title = w === 1 ? 'Baseline check-in' : measureOnly ? 'Deload check-in' : `Week ${w} check-in`;
  const filled = TESTS.filter(t => c[t.k] != null && c[t.k] !== '').length;
  const fld = t => {
    const ph = w === 1 && PREV_BASELINE[t.k] != null ? `last: ${PREV_BASELINE[t.k]}` : (KNOWN_VALUES[w] && KNOWN_VALUES[w][t.k] != null ? `measured: ${KNOWN_VALUES[w][t.k]}` : (t.u === 'text' ? 'e.g. tuck 15 s' : ''));
    return `<div class="fld ${t.u === 'text' ? 'wide' : ''}"><label for="ck-${t.k}">${esc(t.t)}</label><div class="inrow"><input id="ck-${t.k}" class="num" ${t.u === 'text' ? '' : 'inputmode="decimal"'} data-f="ck" data-w="${w}" data-k="${t.k}" value="${esc(c[t.k] ?? '')}" placeholder="${esc(ph)}">${t.u !== 'text' ? `<span class="u">${t.u}</span>` : ''}</div></div>`;
  };
  const photos = measureOnly ? '' : `<div class="lbl" style="margin:16px 0 8px">Progress photos</div><div class="photos">${['front', 'side', 'back'].map(sl => {
    const id = c.photos?.[sl];
    return `<label class="ph">${id ? `<img data-photo="${esc(id)}" alt="${sl} photo week ${w}"><span class="pl">${sl}</span>` : `<span style="font-size:22px">+</span><span>${sl[0].toUpperCase() + sl.slice(1)}</span>`}<input type="file" accept="image/*" data-f="photo" data-w="${w}" data-k="${sl}" aria-label="${sl} photo"></label>`;
  }).join('')}</div><p class="small muted">Same spot, same light, same time of day each check-in.</p>`;
  return `<details class="blk" open><summary><h3>${title}</h3><span class="cnt num ${filled >= (measureOnly ? 5 : TESTS.length) ? 'full' : ''}">${filled}/${measureOnly ? 5 : TESTS.length}</span><span class="chev">›</span></summary><div class="bb">
    <p class="small muted" style="margin-top:0">${measureOnly ? 'Bodyweight, tape measurements and a honest look at joints and the left hip.' : 'Test rested, after the standard warm-up, before the session. Rest 3–5 min between max tests and film the skills.'}</p>
    <div class="lbl" style="margin:10px 0 8px">Body</div>
    <div class="fgrid">${TESTS.filter(t => t.group === 'body').map(fld).join('')}</div>
    ${measureOnly ? `<div class="fld wide" style="margin-top:10px"><label for="ck-joints">Joints and left hip</label><textarea id="ck-joints" data-f="ck" data-w="${w}" data-k="joints" placeholder="Anything aching? Worse, same or better than week 1?">${esc(c.joints || '')}</textarea></div>` :
      `<div class="lbl" style="margin:16px 0 8px">Benchmarks — in this order</div><div class="fgrid">${TESTS.filter(t => t.group === 'test').map(fld).join('')}</div>`}
    ${photos}
    <div class="flags" id="ck-flags">${flagsHTML(w)}</div>
  </div></details>`;
}
function flagsHTML(w) {
  const c = S.checkins[ckid(w)] || {}; const out = [];
  const pu = num(c.pu), dip = num(c.dip), fgh = num(c.fgh), hs = num(c.hs);
  if (w === 1 && pu != null) {
    const b = pu === 0 ? 'A' : pu <= 4 ? 'B' : 'C';
    out.push(`<div class="flag">${pu} strict pull-ups → pull-up branch <b>${b}</b>.${S.settings.branch !== b ? `<button data-a="setbranch" data-v="${b}">Use branch ${b}</button>` : ' Already set.'}</div>`);
  }
  if (pu >= 10 && dip >= 10 && fgh >= 20) out.push('<div class="flag"><b>Muscle-up doorway reached:</b> start genuine attempts (negatives, jump muscle-ups) on Thursdays.</div>');
  if (hs >= 60) out.push('<div class="flag"><b>60 s wall hold:</b> shift handstand time toward heel/toe pulls, kick-ups and freestanding attempts.</div>');
  if (/full/i.test(c.pistolL || '') && /full/i.test(c.pistolR || '')) out.push('<div class="flag"><b>Full pistol both legs:</b> counterbalance becomes weighted pistol (2.5 kg steps).</div>');
  const prev = CHECKIN_WEEKS.filter(x => x < w).reverse().map(x => S.checkins[ckid(x)]).find(x => x && num(x.waist) != null);
  if (prev && num(c.waist) != null && num(c.waist) - num(prev.waist) >= 2) out.push('<div class="flag">Waist is climbing fast — trim the surplus by 100–200 kcal.</div>');
  return out.join('');
}

/* ---------- WEEKLY REVIEW (Sunday) ---------- */
function wkDoc(w) { const id = ckid(w); if (!S.weeks[id]) S.weeks[id] = { week: w, _u: 0 }; return S.weeks[id]; }
function bwAvg(w) {
  const vals = []; for (let d = 0; d < 7; d++) { const v = num(S.bw.entries?.[keyOf(dateOf(w, d))]); if (v != null) vals.push(v); }
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}
function renderWeekly(w) {
  const r = S.weeks[ckid(w)] || {};
  const avg = bwAvg(w), prev = w > 1 ? bwAvg(w - 1) : null;
  const delta = avg != null && prev != null ? avg - prev : null;
  const done = TRAIN.filter(d => status(w, d) === 'done').length;
  let advice = '';
  if (delta != null) {
    if (delta > 0.5) advice = 'Gaining faster than 0.5 kg a week — trim 100–200 kcal a day.';
    else if (delta <= 0) { const p2 = w > 2 && bwAvg(w - 2) != null ? prev - bwAvg(w - 2) : null; advice = p2 != null && p2 <= 0 ? 'No gain two weeks running — add 100–200 kcal a day.' : 'No gain this week. If next week is flat too, add 100–200 kcal a day.'; }
    else advice = 'On track: 0.25–0.5 kg a week is the target.';
  }
  const prot = avg || S.checkins.w01?.bw || 56.6;
  const seg = (k, vals) => `<div class="seg">${vals.map(v => `<button class="${String(r[k]) === String(v) ? 'on' : ''}" data-a="wk" data-k="${k}" data-v="${v}">${v}</button>`).join('')}</div>`;
  return `<div class="blk"><div class="bh"><h3>Week ${w} review</h3></div><div class="bb">
    <div class="tiles" style="margin-top:0">
      <div class="tile"><div class="v num">${done}/4</div><div class="k">Sessions done</div></div>
      <div class="tile"><div class="v num">${avg != null ? avg.toFixed(1) : '–'}</div><div class="k">Avg weight, kg</div></div>
      <div class="tile"><div class="v num">${delta != null ? (delta >= 0 ? '+' : '') + delta.toFixed(2) : '–'}</div><div class="k">vs last week</div></div>
    </div>
    ${advice ? `<div class="hint">${advice}</div>` : ''}
    ${foodWeeklyHTML(w)}
    <div class="fgrid" style="margin-top:12px">
      <div class="fld"><label for="wk-sleep">Sleep avg (h)</label><input id="wk-sleep" inputmode="decimal" data-f="wk" data-w="${w}" data-k="sleep" value="${esc(r.sleep ?? '')}" placeholder="7–9"></div>
      <div class="fld"><label for="wk-protein">Protein avg (g/day)</label><input id="wk-protein" inputmode="decimal" data-f="wk" data-w="${w}" data-k="protein" value="${esc(r.protein ?? '')}" placeholder="${Math.round(prot * 1.6)}–${Math.round(prot * 2.2)}"></div>
      <div class="fld wide"><label>Energy (1–5)</label>${seg('energy', [1, 2, 3, 4, 5])}</div>
      <div class="fld wide"><label>Joint pain (0–10)</label>${seg('pain', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])}</div>
      <div class="fld wide"><label>Left hip OK?</label>${seg('hip', ['Yes', 'Niggle', 'No'])}</div>
      <div class="fld wide"><label for="wk-notes">Notes</label><textarea id="wk-notes" data-f="wk" data-w="${w}" data-k="notes">${esc(r.notes || '')}</textarea></div>
    </div>
    <p class="small muted">Joint pain climbing across weeks means deload now, not in week 9.</p>
  </div></div>`;
}

/* ---------- RENDER: PROGRAM ---------- */
function renderProgram() {
  const p = posOf(new Date()); const t = todayKey();
  let h = `<div class="dayhead"><div class="dt">Started ${fmtDate(parseKey(S.settings.startDate), { day: 'numeric', month: 'long', year: 'numeric' })}</div><h1>16 weeks</h1></div>`;
  h += `<div class="blk"><div class="bb" style="padding-top:14px"><div class="pgrid"><span></span>${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(x => `<span class="hd">${x}</span>`).join('')}`;
  PHASES.forEach(ph => {
    h += `<div class="phl"><b>${esc(ph.name)}</b><span>${ph.from === ph.to ? 'Week ' + ph.from : 'Weeks ' + ph.from + '–' + ph.to} · ${esc(ph.rir)}</span></div>`;
    for (let w = ph.from; w <= ph.to; w++) {
      h += `<span class="wl num ${p.w === w ? 'now' : ''}">W${w}</span>`;
      for (let d = 0; d < 7; d++) {
        const st = status(w, d); const k = keyOf(dateOf(w, d));
        const ckd = d === 0 && (CHECKIN_WEEKS.includes(w) || w === 9);
        const lab = TRAIN.includes(d) ? (st === 'done' ? '✓' : ckd ? '◆' : '') : '';
        h += `<button class="pc ${TRAIN.includes(d) ? '' : 'rest'} st-${st} ${k === t ? 'today' : ''}" data-a="goto" data-w="${w}" data-d="${d}" aria-label="Week ${w} ${DAY_NAMES[d]}: ${st}">${lab}</button>`;
      }
    }
  });
  h += `</div><div class="legend"><span><i style="background:var(--good)"></i>Done</span><span><i style="background:var(--warn-soft);box-shadow:inset 0 0 0 1px var(--warn)"></i>Partly logged</span><span><i style="background:var(--bad-soft)"></i>Missed</span><span>◆ Check-in day</span></div></div></div>`;
  const ph = phaseOf(Math.min(16, Math.max(1, p.w)));
  h += `<div class="blk"><div class="bh"><h3>${esc(ph.name)}</h3><span class="lbl">Current phase</span></div><div class="bb small">
    <p><b>Goal:</b> ${esc(ph.goal)}</p><p><b>Progression:</b> ${esc(ph.rule)}</p><p><b>Skill focus:</b> ${esc(ph.skill)}</p><p><b>Effort:</b> ${esc(ph.rir)}</p></div></div>`;
  h += `<details class="blk"><summary><h3>Key rules</h3><span class="chev">›</span></summary><div class="bb small">
    <p>Skills first, while fresh, never to failure.</p>
    <p>Level up when every set hits the top of the range cleanly, then restart at the bottom. Reps first, then leverage, then load.</p>
    <p>Strength sets stop at 1–2 reps in reserve. Only the final set in the Skill + Strength block goes to 0–1.</p>
    <p>Wrist prep and the shoulder / upper-back routine are non-negotiable on every training day — the routine is what unlocks the handstand. One hip move stays on Mondays as insurance.</p>
    <p>Eat maintenance + 250–500 kcal, 1.6–2.2 g/kg protein, sleep 7–9 h. Aim for 0.25–0.5 kg a week.</p>
    <p>Tendons adapt slower than muscle: no volume spikes, no grinding muscle-up attempts.</p>
    <p>Match both legs to the weaker left hip; keep the pelvis level.</p></div></details>`;
  return h;
}

/* ---------- RENDER: PROGRESS ---------- */
function bwPoints() {
  const m = {};
  Object.entries(S.bw.entries || {}).forEach(([k, v]) => { const n = num(v); if (n != null) m[k] = n; });
  CHECKIN_WEEKS.concat([9]).forEach(w => { const c = S.checkins[ckid(w)]; const n = c ? num(c.bw) : null; const k = keyOf(dateOf(w, 0)); if (n != null && m[k] == null) m[k] = n; });
  return Object.entries(m).map(([k, v]) => ({ k, dt: parseKey(k), v })).sort((a, b) => a.dt - b.dt);
}
function bwChart() {
  const pts = bwPoints();
  if (pts.length < 2) return `<p class="small muted">Log your morning weight on a few days and the trend appears here.</p>`;
  const W = 340, H = 190, L = 34, R = 10, T = 12, B = 24;
  const x0 = pts[0].dt.getTime(), last = pts[pts.length - 1].dt.getTime();
  const x1 = Math.max(last, x0 + 14 * 864e5);
  const wk = t => (t - x0) / (7 * 864e5);
  const lowT = t => pts[0].v + 0.25 * wk(t), highT = t => pts[0].v + 0.5 * wk(t);
  let ymin = Math.min(...pts.map(p => p.v), pts[0].v), ymax = Math.max(...pts.map(p => p.v), highT(x1));
  ymin = Math.floor((ymin - 0.3) * 2) / 2; ymax = Math.ceil((ymax + 0.3) * 2) / 2;
  const X = t => L + (t - x0) / (x1 - x0) * (W - L - R);
  const Y = v => T + (ymax - v) / (ymax - ymin) * (H - T - B);
  const stepY = (ymax - ymin) > 4 ? 1 : 0.5;
  let grid = '';
  for (let v = ymin; v <= ymax + 1e-9; v += stepY) grid += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)" stroke-width="1"/><text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end" font-size="10" fill="var(--ink-3)">${v % 1 ? v.toFixed(1) : v}</text>`;
  const band = `<polygon points="${X(x0)},${Y(lowT(x0))} ${X(x1)},${Y(lowT(x1))} ${X(x1)},${Y(highT(x1))} ${X(x0)},${Y(highT(x0))}" fill="var(--good)" opacity=".12"/>`;
  const line = pts.map((p, i) => (i ? 'L' : 'M') + X(p.dt.getTime()).toFixed(1) + ',' + Y(p.v).toFixed(1)).join(' ');
  const dots = pts.map(p => `<circle cx="${X(p.dt.getTime())}" cy="${Y(p.v)}" r="3.5" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"/>`).join('');
  const xl = [x0, x1].map((t, i) => `<text x="${X(t)}" y="${H - 6}" text-anchor="${i ? 'end' : 'start'}" font-size="10" fill="var(--ink-3)">${fmtDate(new Date(t), { day: 'numeric', month: 'short' })}</text>`).join('');
  window.__bw = { pts, X, Y };
  return `<div class="chart" id="bwchart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Bodyweight over time">${grid}${band}<path d="${line}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/>${dots}<line id="bwx" x1="0" x2="0" y1="${T}" y2="${H - B}" stroke="var(--ink-3)" stroke-width="1" opacity="0"/>${xl}</svg><div class="tip" id="bwtip" hidden></div></div>
  <div class="legend"><span><i style="background:var(--accent)"></i>Your weight</span><span><i style="background:var(--good);opacity:.25"></i>Target: +0.25 to +0.5 kg a week</span></div>`;
}
const LIFTS = [
  { track: 'pullup', name: 'Pull-ups' }, { track: 'dips', name: 'Dips' }, { track: 'push_tue', name: 'Push-ups (Tue)' },
  { track: 'pistol', name: 'Pistol (left leg)' }, { track: 'bss', name: 'Bulgarian split squat' }, { track: 'hs', name: 'Handstand best hold', unit: 's' }, { track: 'lsit', name: 'L-sit best hold', unit: 's' },
];
function liftRows() {
  return LIFTS.map(L => {
    const byW = {};
    Object.values(S.sessions).forEach(s => {
      if (!s || !s.ex) return;
      dayEx(s.day).forEach(def => {
        if (def.track !== L.track) return; const e = s.ex[def.id]; if (!e) return;
        (e.sets || []).forEach(x => { const n = x && x.d ? num(x.r) : null; if (n != null && (!byW[s.week] || n > byW[s.week].v)) byW[s.week] = { v: n, lvl: e.lvl || '' }; });
      });
    });
    const weeks = Object.keys(byW).map(Number).sort((a, b) => a - b);
    if (!weeks.length) return `<div class="lift"><div><div class="ln">${L.name}</div><div class="lv">Nothing logged yet</div></div><div class="lb muted">–</div></div>`;
    const lastW = weeks[weeks.length - 1], cur = byW[lastW];
    const max = Math.max(...weeks.map(w => byW[w].v));
    let bars = '', prevL = null;
    for (let w = 1; w <= 16; w++) {
      const x = (w - 1) * 10 + 1; const b = byW[w];
      if (b) {
        const h = Math.max(3, b.v / max * 26); const y = 34 - h;
        bars += `<rect x="${x}" y="${y}" width="8" height="${h}" rx="2" fill="var(--accent)"><title>Week ${w}: ${b.v}${L.unit ? ' s' : ''}${b.lvl ? ' @ ' + esc(b.lvl) : ''}</title></rect>`;
        if (prevL != null && b.lvl && b.lvl !== prevL) bars += `<circle cx="${x + 4}" cy="${y - 4}" r="2" fill="var(--ink)"><title>Level change: ${esc(b.lvl)}</title></circle>`;
        if (b.lvl) prevL = b.lvl;
      } else bars += `<rect x="${x}" y="33" width="8" height="1" fill="var(--line)"/>`;
    }
    return `<div class="lift"><div><div class="ln">${L.name}</div><div class="lv">${cur.lvl ? esc(cur.lvl) + ' · ' : ''}week ${lastW}</div></div><div class="lb num">${cur.v}${L.unit ? ' s' : ''}</div>
      <svg viewBox="0 0 160 36" role="img" aria-label="${L.name} best set by week">${bars}</svg></div>`;
  }).join('');
}
function renderProgress() {
  const p = posOf(new Date());
  const upTo = Math.min(16, Math.max(0, p.w));
  let due = 0, done = 0;
  for (let w = 1; w <= upTo; w++) TRAIN.forEach(d => { const k = keyOf(dateOf(w, d)); if (k <= todayKey()) { due++; if (status(w, d) === 'done') done++; } });
  const pts = bwPoints();
  const bwNow = pts.length ? pts[pts.length - 1].v : null, bwStart = pts.length ? pts[0].v : null;
  let h = `<div class="dayhead"><div class="dt">Week ${Math.max(1, Math.min(16, p.w))} · ${esc(phaseOf(Math.max(1, Math.min(16, p.w))).name)}</div><h1>Progress</h1></div>
  <div class="tiles">
    <div class="tile"><div class="v num">${done}/${due}</div><div class="k">Sessions done</div><div class="s">so far</div></div>
    <div class="tile"><div class="v num">${bwNow != null ? bwNow.toFixed(1) : '–'}</div><div class="k">Latest kg</div><div class="s num">${bwNow != null && pts.length > 1 ? ((bwNow - bwStart >= 0 ? '+' : '') + (bwNow - bwStart).toFixed(1) + ' since start') : ''}</div></div>
    <div class="tile"><div class="v num">${Object.values(S.checkins).filter(c => c && c._u).length}</div><div class="k">Check-ins</div><div class="s">of 5</div></div>
  </div>
  <div class="blk"><div class="bh"><h3>Bodyweight</h3></div><div class="bb">${bwChart()}</div></div>
  <div class="blk"><div class="bh"><h3>Best set by week</h3></div><div class="bb">${liftRows()}<p class="small muted">A dot above a bar marks a level change — reps drop when you move to a harder variation, which is progress.</p></div></div>`;
  h += foodProgress();
  // benchmarks
  const cols = CHECKIN_WEEKS;
  h += `<div class="blk"><div class="bh"><h3>Benchmarks</h3></div><div class="bb"><div class="tblw"><table class="bm num"><thead><tr><th>Test</th>${cols.map(w => `<th>${w === 1 ? 'Base' : 'Wk ' + w}</th>`).join('')}</tr></thead><tbody>
    ${TESTS.map(t => `<tr><td>${esc(t.t)}${t.u !== 'text' ? ` <span class="muted">(${t.u})</span>` : ''}</td>${cols.map(w => { const c = S.checkins[ckid(w)]; return `<td>${c && c[t.k] != null && c[t.k] !== '' ? esc(c[t.k]) : '<span class="muted">–</span>'}</td>`; }).join('')}</tr>`).join('')}
  </tbody></table></div><p class="small muted">Tap a ◆ Monday in the program to fill in a check-in.</p></div></div>`;
  // photos
  const withPh = cols.filter(w => { const c = S.checkins[ckid(w)]; return c && c.photos && Object.values(c.photos).some(Boolean); });
  if (withPh.length) {
    if (!withPh.includes(+V.cmpA)) V.cmpA = String(withPh[0]);
    if (!withPh.includes(+V.cmpB)) V.cmpB = String(withPh[withPh.length - 1]);
    const opt = sel => withPh.map(w => `<option value="${w}" ${String(w) === sel ? 'selected' : ''}>${w === 1 ? 'Baseline' : 'Week ' + w}</option>`).join('');
    const fig = w => { const id = S.checkins[ckid(w)]?.photos?.[V.cmpSlot]; return `<figure><div class="pimg">${id ? `<img data-photo="${esc(id)}" alt="${V.cmpSlot} week ${w}">` : 'No photo'}</div><figcaption>${w === 1 ? 'Baseline' : 'Week ' + w}</figcaption></figure>`; };
    h += `<div class="blk"><div class="bh"><h3>Photos side by side</h3></div><div class="bb">
      <div class="fgrid"><div class="fld"><label for="cmpA">Left</label><select id="cmpA" data-f="cmpA">${opt(V.cmpA)}</select></div><div class="fld"><label for="cmpB">Right</label><select id="cmpB" data-f="cmpB">${opt(V.cmpB)}</select></div></div>
      <div class="seg" style="margin-top:10px">${['front', 'side', 'back'].map(s => `<button class="${V.cmpSlot === s ? 'on' : ''}" data-a="cmpslot" data-v="${s}">${s[0].toUpperCase() + s.slice(1)}</button>`).join('')}</div>
      <div class="cmp">${fig(+V.cmpA)}${fig(+V.cmpB)}</div></div></div>`;
  }
  return h;
}

/* ---------- RENDER: SETTINGS ---------- */
function renderSettings() {
  const sd = parseKey(S.settings.startDate); const end = addDays(sd, 16 * 7 - 1);
  return `<div class="dayhead"><h1>Settings</h1></div>
  <div class="blk"><div class="bh"><h3>Program dates</h3></div><div class="bb">
    <div class="fld"><label for="startdate">Start date (week 1, Monday)</label><input type="date" id="startdate" data-f="startdate" value="${S.settings.startDate}"></div>
    <p class="small muted">Runs ${fmtDate(sd, { day: 'numeric', month: 'short' })} – ${fmtDate(end, { day: 'numeric', month: 'short', year: 'numeric' })}. Any date you pick snaps to the Monday of that week. Your logs stay attached to their program week, so moving the start date doesn’t lose anything.</p>
  </div></div>
  <div class="blk"><div class="bh"><h3>Body</h3></div><div class="bb">
    <div class="fgrid"><div class="fld"><label for="s-height">Height (cm)</label><input id="s-height" class="num" inputmode="numeric" data-f="sheight" value="${esc(S.settings.height || '')}" placeholder="172"></div>
    <div class="fld"><label for="s-age">Age</label><input id="s-age" class="num" inputmode="numeric" data-f="sage" value="${esc(S.settings.age || '')}" placeholder="years"></div></div>
    <p class="small muted">Only used for the provisional calorie target during the first two weeks of food logging.</p>
  </div></div>
  <div class="blk"><div class="bh"><h3>Pull-up branch</h3></div><div class="bb">
    <div class="seg">${['A', 'B', 'C'].map(b => `<button class="${S.settings.branch === b ? 'on' : ''}" data-a="setbranch" data-v="${b}">${b}</button>`).join('')}</div>
    <p class="small"><b>${esc(BRANCHES[S.settings.branch].label)}.</b> ${esc(BRANCHES[S.settings.branch].plan)} ${esc(BRANCHES[S.settings.branch].next)}</p>
  </div></div>
  <div class="blk"><div class="bh"><h3>Online backup</h3><span class="sync ${syncState === 'signedout' ? 'local' : syncState}"></span></div><div class="bb">
    <p class="small" id="synctext">${syncLabel()}</p>
    ${!sb ? `<p class="small muted">Online backup isn’t connected yet. Put your Supabase project URL and key in <b>config.js</b> (the setup guide shows where). Until then everything is saved on this phone.</p>`
      : !user ? `<div class="fgrid">
          <div class="fld wide"><label for="au-email">Email</label><input id="au-email" type="email" autocomplete="username" inputmode="email"></div>
          <div class="fld wide"><label for="au-pw">Password</label><input id="au-pw" type="password" autocomplete="current-password"></div></div>
          <button class="big" data-a="signin">Sign in</button>
          <button class="big ghost" data-a="signup">Create my account (first time only)</button>
          <p class="small muted">Only you can read your logs and photos — the database checks your login on every request.</p>`
      : `<p class="small">Signed in as <b>${esc(user.email || '')}</b></p>
          <button class="big ghost" data-a="syncnow">Sync now</button>
          <button class="big ghost" data-a="signout">Sign out</button>`}
  </div></div>
  <div class="blk"><div class="bh"><h3>Backup file</h3></div><div class="bb">
    <p class="small muted">A copy of everything in one file — handy before switching phones.</p>
    <button class="big ghost" data-a="backup">Save a backup file</button>
    <label class="big ghost" style="display:grid;place-items:center;cursor:pointer">Restore from a backup file<input type="file" accept="application/json,.json" data-f="restore" hidden></label>
  </div></div>
  <div class="blk"><div class="bh"><h3>Home screen</h3></div><div class="bb small">
    <p><b>iPhone:</b> open the app’s address in Safari, tap Share, then <b>Add to Home Screen</b>.</p>
    <p><b>Android:</b> open it in Chrome, tap ⋮, then <b>Install app</b>.</p>
    <p class="muted">Once installed it opens full-screen with the neon dumbbell icon and works without signal. Updates arrive by themselves the next time you open it online.</p>
  </div></div>`;
}

/* ---------- MAIN RENDER ---------- */
function tabsHTML() {
  const ic = {
    day: '<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>',
    program: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/></svg>',
    food: '<svg viewBox="0 0 24 24"><path d="M5 3v18M5 11c2 0 3-1 3-4V3M3 3v4c0 2 1 4 2 4M14 3c-1 3-1 6 0 9v9M14 12c3 0 4-3 4-6s-1-3-1-3"/></svg>',
    progress: '<svg viewBox="0 0 24 24"><path d="M4 19h16M6 15l4-4 3 3 5-6"/></svg>',
    settings: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/></svg>',
  };
  const names = { day: 'Day', program: 'Program', food: 'Food', progress: 'Progress', settings: 'Settings' };
  return `<div class="in">${Object.keys(names).map(k => `<button class="tab ${V.tab === k ? 'on' : ''}" data-a="tab" data-v="${k}" aria-current="${V.tab === k}">${ic[k]}${names[k]}</button>`).join('')}</div>`;
}
function render() {
  const m = $('#main'); let h = '';
  if (V.tab === 'day') h = renderDay();
  else if (V.tab === 'program') h = renderProgram();
  else if (V.tab === 'progress') h = renderProgress();
  else if (V.tab === 'food') h = renderFood();
  else h = renderSettings();
  const y = window.scrollY;
  m.innerHTML = h;
  $('#tabs').innerHTML = tabsHTML();
  if (V.keepScroll) window.scrollTo(0, y);
  V.keepScroll = false;
  setSync();
  if (V.tab === 'progress') wireChart();
  hydratePhotos();
}
function rerenderCard(exId) {
  const ex = PROGRAM[V.d]?.ex.find(x => x.id === exId); if (!ex) return;
  const el = $('#ex-' + exId); if (!el) return;
  const s = peekSess(V.w, V.d) || {};
  const tmp = document.createElement('div'); tmp.innerHTML = exCard(ex, V.w, V.d, s, s.light || '');
  el.replaceWith(tmp.firstElementChild);
  const c = $('.sec .cnt'); if (c) { const n = PROGRAM[V.d].ex.reduce((a, x) => a + ((s.ex?.[x.id]?.sets || []).filter(q => q && q.d).length), 0); c.textContent = n + ' sets logged'; }
  refreshStrip();
}
function refreshStrip() { const hs = $('.strip'); if (hs) { const t = document.createElement('div'); t.innerHTML = header(); hs.replaceWith(t.querySelector('.strip')); } }
function wireChart() {
  const box = $('#bwchart'); if (!box || !window.__bw) return;
  const svg = box.querySelector('svg'), tip = $('#bwtip'), xl = $('#bwx');
  const move = ev => {
    const r = svg.getBoundingClientRect(); const sx = (ev.clientX - r.left) / r.width * 340;
    const { pts, X, Y } = window.__bw; let best = pts[0], bd = 1e9;
    pts.forEach(p => { const dd = Math.abs(X(p.dt.getTime()) - sx); if (dd < bd) { bd = dd; best = p; } });
    const px = X(best.dt.getTime()); xl.setAttribute('x1', px); xl.setAttribute('x2', px); xl.setAttribute('opacity', '.6');
    tip.hidden = false; tip.textContent = fmtDate(best.dt, { weekday: 'short', day: 'numeric', month: 'short' }) + ' · ' + best.v.toFixed(1) + ' kg';
    tip.style.left = (px / 340 * r.width) + 'px'; tip.style.top = (Y(best.v) / 190 * r.height) + 'px';
  };
  svg.addEventListener('pointermove', move); svg.addEventListener('pointerdown', move);
  svg.addEventListener('pointerleave', () => { tip.hidden = true; xl.setAttribute('opacity', '0'); });
}

/* ---------- TIMER ---------- */
let T = null, audio = null, wake = null;
function ensureAudio() { try { if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === 'suspended') audio.resume(); } catch (e) { } }
function beep() {
  try { if (!audio) return; [0, 0.25, 0.5].forEach(t => { const o = audio.createOscillator(), g = audio.createGain(); o.frequency.value = 880; o.connect(g); g.connect(audio.destination); g.gain.setValueAtTime(0.0001, audio.currentTime + t); g.gain.exponentialRampToValueAtTime(0.3, audio.currentTime + t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + t + 0.18); o.start(audio.currentTime + t); o.stop(audio.currentTime + t + 0.2); }); } catch (e) { }
  try { navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch (e) { }
}
async function keepAwake() { try { if (!wake && navigator.wakeLock) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } } catch (e) { } }
function startRest(sec, label) { T = { end: Date.now() + sec * 1000, total: sec, label }; drawTimer(); }
function drawTimer() {
  const el = $('#timer');
  if (!T) { el.hidden = true; return; }
  const left = Math.ceil((T.end - Date.now()) / 1000);
  el.hidden = false;
  if (left <= 0) {
    if (!T.fired) { T.fired = true; beep(); }
    el.classList.add('over');
    el.innerHTML = `<div class="tt"><div class="tv">Go</div><div class="tl">Rest over · ${esc(T.label)}</div></div><button data-a="tclose">Close</button>`;
    if (left < -20) { T = null; el.hidden = true; }
    return;
  }
  el.classList.remove('over');
  const m = Math.floor(left / 60), s = left % 60;
  el.innerHTML = `<div class="tt"><div class="tv num">${m}:${pad(s)}</div><div class="tl">Rest · ${esc(T.label)}</div></div><button data-a="tadd">+15 s</button><button data-a="tclose">Skip</button><div class="bar" style="width:${(1 - left / T.total) * 100}%"></div>`;
}
setInterval(drawTimer, 250);

/* ---------- TOAST ---------- */
let toastT = null;
function toast(msg) { const el = $('#toast'); el.textContent = msg; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, 2600); }

/* ---------- EVENTS ---------- */
function exDef(id) { return PROGRAM[V.d]?.ex.find(x => x.id === id); }
document.addEventListener('click', e => {
  const b = e.target.closest('[data-a]'); if (!b) return;
  const a = b.dataset.a, v = b.dataset.v;
  if (a === 'demo') { // refresh the search from the level typed right now, then let the link open
    const ex = exDef(b.dataset.ex); if (ex) { const q = demoQuery(ex, exLevel(ex, V.w, V.d)); b.href = b.dataset.kind === 'img' ? imgUrl(q) : ytUrl(q); }
    return;
  }
  const w = V.w, d = V.d;
  switch (a) {
    case 'tab': if (typeof stopScan === 'function') stopScan(); V.tab = v; window.scrollTo(0, 0); render(); break;
    case 'goto': V.w = +b.dataset.w; V.d = +b.dataset.d; V.tab = 'day'; V.showRed = false; window.scrollTo(0, 0); render(); break;
    case 'wprev': if (V.w > 1) { V.w--; V.showRed = false; render(); } break;
    case 'wnext': if (V.w < 16) { V.w++; V.showRed = false; render(); } break;
    case 'today': goToday(); V.showRed = false; window.scrollTo(0, 0); render(); break;
    case 'light': { const s = sess(w, d); s.light = s.light === v ? '' : v; saveSess(w, d); ensureAudio(); keepAwake(); V.keepScroll = true; render(); break; }
    case 'showred': V.showRed = true; V.keepScroll = true; render(); break;
    case 'wu': case 'cd': case 'rest': case 'yoga': {
      const s = sess(w, d); s[a] = s[a] || {}; const i = b.dataset.i; s[a][i] = !s[a][i]; saveSess(w, d);
      b.classList.toggle('on', s[a][i]); b.setAttribute('aria-pressed', s[a][i]);
      const det = b.closest('details'); const cnt = det && det.querySelector('.cnt');
      if (cnt) { const tot = det.querySelectorAll('.chk').length, n = det.querySelectorAll('.chk.on').length; cnt.textContent = n + '/' + tot; cnt.classList.toggle('full', n === tot); }
      if (a === 'yoga') refreshStrip();
      break;
    }
    case 'tick': case 'inc': case 'dec': {
      const ex = exDef(b.dataset.ex); if (!ex) break;
      const s = sess(w, d); const e = exState(s, ex.id); const i = +b.dataset.i;
      while (e.sets.length <= i) e.sets.push({});
      const st = e.sets[i]; const pl = plan(ex, w, d, s.light || '');
      const tgt = targetAt(pl, i);
      const step = ex.unit === 's' || ex.unit === 'm' ? (ex.step || 5) : 1;
      if (a === 'inc' || a === 'dec') {
        let cur = num(st.r); if (cur == null) cur = tgt != null ? tgt : (a === 'inc' ? 0 : step);
        else cur = a === 'inc' ? cur + step : Math.max(0, cur - step);
        st.r = String(cur);
        const inp = $('#r-' + ex.id + '-' + i); if (inp) inp.value = st.r;
        saveSess(w, d); break;
      }
      ensureAudio(); keepAwake();
      if (st.d) { st.d = false; }
      else {
        if (num(st.r) == null) { if (tgt == null) { toast('Enter the ' + (ex.unit === 's' ? 'seconds' : 'reps') + ' first'); $('#r-' + ex.id + '-' + i)?.focus(); break; } st.r = String(tgt); }
        st.d = true;
        if (!e.lvl && pl.h && pl.h.lvl && !pl.levelUp) e.lvl = pl.h.lvl;
        if (!e.load && pl.h && pl.h.load && !pl.levelUp) e.load = pl.h.load;
        const doneN = e.sets.filter(x => x && x.d).length;
        startRest(ex.rest, doneN >= setCount(e, pl) ? ex.name + ' done — next exercise' : ex.name + ' · set ' + (doneN + 1));
      }
      saveSess(w, d); rerenderCard(ex.id); break;
    }
    case 'addset': case 'rmset': {
      const ex = exDef(b.dataset.ex); const s = sess(w, d); const e = exState(s, ex.id); const pl = plan(ex, w, d, s.light || '');
      const n = setCount(e, pl);
      if (a === 'addset') { e.n = n + 1; }
      else if (n > 1) { const last = e.sets[n - 1]; e.n = n - 1; e.sets = e.sets.slice(0, e.n); if (last && last.d) toast('Set ' + n + ' removed'); }
      saveSess(w, d); rerenderCard(ex.id); break;
    }
    case 'rir': { const s = sess(w, d); const e = exState(s, b.dataset.ex); e.rir = e.rir === v ? '' : v; saveSess(w, d); rerenderCard(b.dataset.ex); break; }
    case 'rpe': { const s = sess(w, d); s.rpe = s.rpe === v ? '' : v; saveSess(w, d); b.parentElement.querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.v === s.rpe)); break; }
    case 'hip': { const s = sess(w, d); s.hip = s.hip === v ? '' : v; saveSess(w, d); b.parentElement.querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.v === s.hip)); break; }
    case 'finish': { const s = sess(w, d); s.status = 'done'; s.finishedOn = todayKey(); saveSess(w, d); T = null; drawTimer(); toast('Session saved. Nice work.'); V.keepScroll = true; render(); break; }
    case 'reopen': { const s = sess(w, d); s.status = ''; saveSess(w, d); V.keepScroll = true; render(); break; }
    case 'setbranch': S.settings.branch = v; touch('meta/settings'); V.keepScroll = true; render(); toast('Pull-up branch set to ' + v); break;
    case 'wk': { const r = wkDoc(+(b.closest('[data-w]')?.dataset.w || w)); r[b.dataset.k] = String(r[b.dataset.k]) === v ? '' : v; touch('weeks/' + ckid(w)); b.parentElement.querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.v === String(r[b.dataset.k]))); break; }
    case 'cmpslot': V.cmpSlot = v; V.keepScroll = true; render(); break;
    case 'tadd': if (T) { T.end += 15000; T.total += 15; drawTimer(); } break;
    case 'tclose': T = null; drawTimer(); break;
    case 'backup': doBackup(); break;
    default: foodClick(a, b, v); break;
    case 'signin': signIn('in'); break;
    case 'signup': signIn('up'); break;
    case 'signout': signOut(); break;
    case 'syncnow': pull().then(() => toast(syncLabel())); break;
  }
});
document.addEventListener('input', e => {
  const t = e.target; const f = t.dataset.f; if (!f) return;
  const w = V.w, d = V.d;
  if (f === 'rep') { const s = sess(w, d); const ex = s && exState(s, t.dataset.ex); const i = +t.dataset.i; while (ex.sets.length <= i) ex.sets.push({}); ex.sets[i].r = t.value.trim(); saveSess(w, d); }
  else if (f === 'lvl') { const s = sess(w, d); exState(s, t.dataset.ex).lvl = t.value; saveSess(w, d); }
  else if (f === 'sheight') { S.settings.height = t.value.trim(); touch('meta/settings'); }
  else if (f === 'sage') { S.settings.age = t.value.trim(); touch('meta/settings'); }
  else if (f === 'load') { const s = sess(w, d); exState(s, t.dataset.ex).load = t.value; saveSess(w, d); }
  else if (f === 'note') { const s = sess(w, d); exState(s, t.dataset.ex).note = t.value; saveSess(w, d); }
  else if (f === 'snotes') { const s = sess(w, d); s.notes = t.value; saveSess(w, d); }
  else if (f === 'yogamin') { const s = sess(w, d); s.yogaMin = t.value.trim(); saveSess(w, d); }
  else if (f === 'bw') { S.bw.entries = S.bw.entries || {}; const v = t.value.trim(); if (v === '') delete S.bw.entries[t.dataset.k]; else S.bw.entries[t.dataset.k] = v; touch('meta/bw'); }
  else if (f === 'ck') { const c = ck(+t.dataset.w); c[t.dataset.k] = t.value.trim(); touch('checkins/' + ckid(+t.dataset.w)); const fl = $('#ck-flags'); if (fl) fl.innerHTML = flagsHTML(+t.dataset.w); }
  else if (f === 'wk') { const r = wkDoc(+t.dataset.w); r[t.dataset.k] = t.value; touch('weeks/' + ckid(+t.dataset.w)); }
  else foodInput(f, t);
});
document.addEventListener('keydown', e => { if (V.tab === 'food') foodKey(e); });
document.addEventListener('change', e => {
  const t = e.target; const f = t.dataset.f; if (!f) return;
  if (f === 'lvlsel') {
    const s = sess(V.w, V.d); const e = exState(s, t.dataset.ex); V.other = V.other || {};
    if (t.value === '__other') { V.other[t.dataset.ex] = true; e.lvl = ''; saveSess(V.w, V.d); rerenderCard(t.dataset.ex); setTimeout(() => $('#lvlo-' + t.dataset.ex)?.focus(), 30); }
    else { V.other[t.dataset.ex] = false; e.lvl = t.value; saveSess(V.w, V.d); rerenderCard(t.dataset.ex); }
    return;
  }
  if (f === 'startdate') {
    if (!t.value) return;
    const m = mondayOf(parseKey(t.value)); S.settings.startDate = keyOf(m); touch('meta/settings'); goToday(); V.keepScroll = true; render();
    toast('Week 1 now starts ' + fmtDate(m, { weekday: 'short', day: 'numeric', month: 'short' }));
  }
  else if (f === 'cmpA' || f === 'cmpB') { V[f] = t.value; V.keepScroll = true; render(); }
  else if (f === 'photo' && t.files && t.files[0]) onPhoto(t.files[0], +t.dataset.w, t.dataset.k);
  else if (f === 'restore' && t.files && t.files[0]) doRestore(t.files[0]);
});

/* ---------- PHOTOS ---------- */
async function shrink(file) {
  try {
    const url = URL.createObjectURL(file); const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    const max = 1600, sc = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * sc); c.height = Math.round(img.naturalHeight * sc);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
    return blob || file;
  } catch (e) { return file; }
}
const photoUrls = {};
async function photoUrl(path) {
  const c = photoUrls[path]; if (c && c.exp > Date.now()) return c.url;
  if (!sb || !user) return null;
  const { data, error } = await sb.storage.from('photos').createSignedUrl(path, 3600);
  if (error || !data) return null;
  photoUrls[path] = { url: data.signedUrl, exp: Date.now() + 50 * 60 * 1000 }; return data.signedUrl;
}
function hydratePhotos() {
  document.querySelectorAll('img[data-photo]').forEach(async img => {
    const u = await photoUrl(img.dataset.photo);
    if (u) img.src = u; else img.replaceWith(Object.assign(document.createElement('span'), { className: 'phoff', textContent: user ? 'Photo unavailable' : 'Sign in to see' }));
  });
}
async function onPhoto(file, w, slot) {
  if (!sb || !user) { toast('Sign in (Settings) to save photos — they’re stored in your private online storage'); return; }
  toast('Saving photo…');
  const blob = await shrink(file);
  const path = `${user.id}/w${pad(w)}-${slot}-${Date.now()}.jpg`;
  try {
    const { error } = await sb.storage.from('photos').upload(path, blob, { contentType: 'image/jpeg', upsert: false });
    if (error) throw error;
    const c = ck(w); c.photos = c.photos || {}; const old = c.photos[slot]; c.photos[slot] = path; touch('checkins/' + ckid(w));
    if (old && old.includes('/')) sb.storage.from('photos').remove([old]).catch(() => { });
    toast('Photo saved'); V.keepScroll = true; render();
  } catch (e) {
    toast(navigator.onLine === false ? 'You’re offline — add the photo again when you have signal' : 'Photo didn’t save — try again');
  }
}

/* ---------- BACKUP ---------- */
async function doBackup() {
  const name = `calisthenics-backup-${todayKey()}.json`;
  const blob = new Blob([JSON.stringify({ app: 'cal16', v: 2, S }, null, 1)], { type: 'application/json' });
  try {
    const f = new File([blob], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [f] })) { await navigator.share({ files: [f], title: 'Calisthenics backup' }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); toast('Backup saved');
}
async function doRestore(file) {
  try {
    const o = JSON.parse(await file.text()); const inS = o.S || o; let n = 0;
    COLLS.forEach(c => Object.entries(inS[c] || {}).forEach(([id, doc]) => {
      if (!S[c]) S[c] = {};
      const cur = S[c][id]; if (!cur || (doc._u || 0) > (cur._u || 0)) { S[c][id] = doc; touch(c + '/' + id); n++; }
    }));
    if (inS.bw && inS.bw.entries) { S.bw.entries = Object.assign({}, inS.bw.entries, S.bw.entries); touch('meta/bw'); }
    if (inS.foodMeta && (!S.foodMeta || (inS.foodMeta._u || 0) > (S.foodMeta._u || 0))) { S.foodMeta = inS.foodMeta; touch('meta/food'); }
    persist(); render(); toast(`Restored ${n} entries`);
  } catch (e) { toast('That file isn’t a backup from this app'); }
}

/* ---------- BOOT ---------- */
render();
initSync();
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => { });
  let reloaded = false; const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (reloaded || !hadController || MT) return; reloaded = true; location.reload(); });
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && wake === null && T) keepAwake(); });
