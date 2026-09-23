/* ---------- MIND: journal + mind-power exercises with a timer that logs what you did and when ---------- */
const MIND_EX = [
  { id: 'box', name: 'Box breathing', min: 5, how: 'Breathe in for 4, hold 4, out 4, hold 4. Shoulders soft, jaw loose.', breath: [['Breathe in', 4], ['Hold', 4], ['Breathe out', 4], ['Hold', 4]] },
  { id: 'slow', name: 'Slow breathing', min: 3, how: 'In through the nose for 4, out slowly for 6. The long out-breath settles you down.', breath: [['Breathe in', 4], ['Breathe out', 6]] },
  { id: 'visual', name: 'Visualisation', min: 7, how: 'Eyes closed. Picture one goal as already real — where you are, what you see, hear and feel. Stay in the scene and let it get vivid.', goals: true },
  { id: 'rehearse', name: 'Skill rehearsal', min: 5, how: 'Picture yourself doing one skill perfectly, in real time, from the inside: the grip, the tension, the exact path of the movement. Pick one skill per session.', skills: true },
  { id: 'script', name: 'Scripting', min: 0, how: 'Write about a goal as if it has already happened — present tense, real detail, real feeling. The timer counts up; tap Finish when you’re done.', goals: true, write: true },
  { id: 'affirm', name: 'Affirmations out loud', min: 2, how: 'Say each affirmation slowly and out loud, three times.', affirm: true },
  { id: 'scan', name: 'Body scan', min: 10, how: 'Lie down. Move your attention slowly from toes to head. Notice, don’t fix. Breathe into tight spots.' },
  { id: 'gaze', name: 'Focus gazing', min: 5, how: 'Rest your eyes on one point — a candle flame or a dot on the wall. When your mind wanders, come back. Each return is a rep.' },
];
const MIND_SKILLS = ['Freestanding handstand', 'Pistol squat', 'Full L-sit', 'Muscle-up'];
const MT_KEY = 'cal16-mind-timer';

function mindMeta() {
  if (!S.mindMeta) S.mindMeta = {
    affirm: ['I show up and do the work, one set at a time.', 'My body gets stronger every week.', 'I am calm, focused and in control of my day.'],
    goals: [], custom: [], _u: 0,
  };
  const m = S.mindMeta; m.affirm = m.affirm || []; m.goals = m.goals || []; m.custom = m.custom || [];
  return m;
}
function allMindEx() { return MIND_EX.concat(mindMeta().custom.map(c => ({ id: c.id, name: c.name, min: +c.min || 0, how: c.how || '', custom: true }))); }
function mexById(id) { return allMindEx().find(x => x.id === id); }
function mday(k) {
  if (!S.mind[k]) S.mind[k] = { date: k, grat: ['', '', ''], sessions: [], _u: 0 };
  const d = S.mind[k]; d.grat = d.grat || ['', '', '']; d.sessions = d.sessions || []; return d;
}
function peekMday(k) { return S.mind[k]; }
function mindActive(d) { return !!d && ((d.sessions || []).length || (d.intention || '').trim() || (d.grat || []).some(g => (g || '').trim()) || (d.wins || '').trim()); }
function mindStreak() {
  let n = 0; let dt = new Date();
  if (!mindActive(peekMday(keyOf(dt)))) dt = addDays(dt, -1);
  while (mindActive(peekMday(keyOf(dt)))) { n++; dt = addDays(dt, -1); }
  return n;
}
function affirmOfDay(k) {
  const list = mindMeta().affirm.filter(a => a.trim()); if (!list.length) return '';
  const idx = Math.floor(parseKey(k).getTime() / 864e5) % list.length; return list[(idx + list.length) % list.length];
}
const fmtClock = sec => { sec = Math.max(0, Math.round(sec)); return Math.floor(sec / 60) + ':' + pad(sec % 60); };
const fmtMin = sec => sec >= 60 ? Math.round(sec / 60) + ' min' : sec + ' s';

/* timer state survives app switches and reloads */
let MT = null;
try { MT = JSON.parse(localStorage.getItem(MT_KEY) || 'null'); } catch (e) { MT = null; }
function saveMT() { try { MT ? localStorage.setItem(MT_KEY, JSON.stringify(MT)) : localStorage.removeItem(MT_KEY); } catch (e) { } }
function mtElapsed() { if (!MT) return 0; return (MT.acc || 0) + (MT.paused ? 0 : (Date.now() - MT.start) / 1000); }
function mtStart(id) {
  const ex = mexById(id); if (!ex) return;
  if (MT) { toast('Finish or cancel the running exercise first'); return; }
  MT = { id, name: ex.name, planned: ex.min * 60, start: Date.now(), acc: 0, paused: false, date: V.md, at: new Date().toTimeString().slice(0, 5), text: '' };
  saveMT(); ensureAudio(); keepAwake(); V.keepScroll = false; render(); window.scrollTo(0, 0);
}
function mtFinish(auto) {
  if (!MT) return;
  const sec = Math.round(MT.planned && auto ? MT.planned : mtElapsed());
  if (sec < 10 && !auto) { MT = null; saveMT(); render(); toast('Under 10 seconds — not logged'); return; }
  const d = mday(MT.date);
  const entry = { ex: MT.id, name: MT.name, sec, at: MT.at };
  if (MT.text && MT.text.trim()) entry.text = MT.text.trim();
  d.sessions.push(entry); touch('mind/' + MT.date);
  toast(`${MT.name} logged · ${fmtMin(sec)}`);
  MT = null; saveMT(); render();
}
function drawMindTimer() {
  if (!MT) return;
  const el = $('#mt-time'); const left = MT.planned ? MT.planned - mtElapsed() : null;
  if (MT.planned && left <= 0 && !MT.paused) { beep(); mtFinish(true); return; }
  if (!el) return;
  el.textContent = MT.planned ? fmtClock(left) : fmtClock(mtElapsed());
  const bar = $('#mt-bar'); if (bar && MT.planned) bar.style.width = Math.min(100, mtElapsed() / MT.planned * 100) + '%';
  const ex = mexById(MT.id); const ph = $('#mt-phase');
  if (ph && ex && ex.breath) {
    const cyc = ex.breath.reduce((a, b) => a + b[1], 0); let t = Math.floor(mtElapsed()) % cyc; let cur = ex.breath[0], rem = 0;
    for (const b of ex.breath) { if (t < b[1]) { cur = b; rem = b[1] - t; break; } t -= b[1]; }
    ph.textContent = cur[0] + ' · ' + rem;
    ph.dataset.phase = /in/i.test(cur[0]) ? 'in' : /out/i.test(cur[0]) ? 'out' : 'hold';
  }
}
setInterval(drawMindTimer, 250);

function renderMind() {
  if (!V.md) V.md = todayKey();
  const k = V.md, isToday = k === todayKey(), d = peekMday(k) || { grat: ['', '', ''], sessions: [] };
  const mins = Math.round((d.sessions || []).reduce((a, s) => a + (s.sec || 0), 0) / 60);
  const streak = mindStreak();
  let h = `<div class="dayhead"><div class="hbar mind-nav"><button class="ib" data-a="mday" data-v="-1" aria-label="Previous day">‹</button>
    <div class="dt" style="flex:1;text-align:center">${fmtDate(parseKey(k))}</div>
    <button class="ib" data-a="mday" data-v="1" ${isToday ? 'disabled' : ''} aria-label="Next day">›</button>${isToday ? '' : '<button class="pill" data-a="mday" data-v="0">Today</button>'}</div>
    <h1>Mind</h1>
    <div class="chips"><span class="chip acc">${streak} day streak</span><span class="chip">${mins} min today</span><span class="chip">${(d.sessions || []).length} sessions</span></div></div>`;

  // running timer
  if (MT) {
    const ex = mexById(MT.id) || { how: '' };
    const goals = mindMeta().goals.filter(g => g.trim());
    h += `<div class="blk mt"><div class="bb" style="padding-top:18px">
      <div class="lbl">Now</div><h3 class="mt-name">${esc(MT.name)}</h3>
      <div class="mt-time num" id="mt-time">${MT.planned ? fmtClock(MT.planned - mtElapsed()) : fmtClock(mtElapsed())}</div>
      ${ex.breath ? `<div class="mt-phase" id="mt-phase" data-phase="in">…</div>` : ''}
      ${MT.planned ? `<div class="mt-track"><div class="mt-bar" id="mt-bar"></div></div>` : `<div class="small muted" style="text-align:center">Counting up</div>`}
      <p class="small">${esc(ex.how)}</p>
      ${ex.goals && goals.length ? `<div class="mt-list"><div class="lbl">Your goals</div>${goals.map(g => `<p>${esc(g)}</p>`).join('')}</div>` : ''}
      ${ex.goals && !goals.length ? `<p class="small muted">Tip: add your goals in the Goals board below and they’ll show here.</p>` : ''}
      ${ex.skills ? `<div class="mt-list"><div class="lbl">Pick one</div>${MIND_SKILLS.map(g => `<p>${esc(g)}</p>`).join('')}</div>` : ''}
      ${ex.affirm ? `<div class="mt-list">${mindMeta().affirm.filter(a => a.trim()).map(a => `<p class="aff">${esc(a)}</p>`).join('')}</div>` : ''}
      ${ex.write ? `<div class="fld"><label for="mt-text">Write here</label><textarea id="mt-text" data-f="mtext" style="height:160px" placeholder="It’s … and I …">${esc(MT.text || '')}</textarea></div>` : ''}
      <div class="mt-btns"><button class="big ghost" data-a="mpause">${MT.paused ? 'Resume' : 'Pause'}</button><button class="big" data-a="mfinish">Finish &amp; log</button></div>
      <button class="addset rm" data-a="mcancel" style="margin-top:6px">Cancel without logging</button>
    </div></div>`;
  }

  // morning
  h += `<div class="blk"><div class="bh"><h3>Morning</h3><span class="lbl">2–3 min</span></div><div class="bb">
    <div class="fld"><label for="mi-intention">Today’s intention</label><input id="mi-intention" data-f="mi" data-k="intention" value="${esc(d.intention || '')}" placeholder="One line — how do you want to show up today?"></div>
    <div class="fld" style="margin-top:10px"><label>Three things I’m grateful for</label>
      ${[0, 1, 2].map(i => `<input id="mi-g${i}" data-f="mi" data-k="g${i}" value="${esc((d.grat || [])[i] || '')}" placeholder="${i + 1}." style="margin-top:${i ? 6 : 0}px">`).join('')}</div>
    ${affirmOfDay(k) ? `<div class="aff-day"><div class="lbl">Affirmation of the day</div><p>${esc(affirmOfDay(k))}</p></div>` : ''}
  </div></div>`;

  // exercises
  h += `<div class="sec"><h3>Mind-power</h3><span class="cnt">tap to start</span></div><div class="mgrid">`;
  allMindEx().forEach(ex => {
    const n = (d.sessions || []).filter(s => s.ex === ex.id).length;
    h += `<button class="mex ${n ? 'did' : ''}" data-a="mstart" data-v="${esc(ex.id)}"><span class="mn">${esc(ex.name)}</span><span class="mm">${ex.min ? ex.min + ' min' : 'open-ended'}${n ? ' · done ×' + n : ''}</span></button>`;
  });
  h += `</div>`;

  // log
  h += `<div class="blk"><div class="bh"><h3>Log</h3><span class="cnt num">${mins} min</span></div><div class="bb">${(d.sessions || []).length ? (d.sessions || []).map((s, i) => `<div class="mlog"><span class="num mt-at">${esc(s.at || '')}</span><span class="ml-n">${esc(s.name)}${s.text ? `<small>${esc(s.text.slice(0, 120))}${s.text.length > 120 ? '…' : ''}</small>` : ''}</span><span class="num">${fmtMin(s.sec || 0)}</span><button class="mdel" data-a="mdel" data-v="${i}" aria-label="Remove ${esc(s.name)} entry">×</button></div>`).join('') : '<p class="small muted" style="margin:0">Nothing yet. Start an exercise above — it logs itself when the timer ends.</p>'}</div></div>`;

  // evening
  h += `<div class="blk"><div class="bh"><h3>Evening</h3><span class="lbl">2 min</span></div><div class="bb">
    <div class="fld"><label for="mi-wins">Today’s wins</label><textarea id="mi-wins" data-f="mi" data-k="wins" placeholder="Big or small">${esc(d.wins || '')}</textarea></div>
    <div class="fld" style="margin-top:10px"><label for="mi-lesson">One lesson</label><input id="mi-lesson" data-f="mi" data-k="lesson" value="${esc(d.lesson || '')}"></div>
    <div class="fld" style="margin-top:10px"><label for="mi-tomorrow">Tomorrow’s one thing</label><input id="mi-tomorrow" data-f="mi" data-k="tomorrow" value="${esc(d.tomorrow || '')}"></div>
    <div class="fld" style="margin-top:10px"><label>Mood</label><div class="seg">${[1, 2, 3, 4, 5].map(v => `<button class="${String(d.mood) === String(v) ? 'on' : ''}" data-a="mmood" data-v="${v}">${v}</button>`).join('')}</div></div>
  </div></div>`;

  // goals + affirmations + custom exercises
  const M = mindMeta();
  h += `<details class="blk"><summary><h3>Goals board</h3><span class="cnt num">${M.goals.filter(g => g.trim()).length}</span><span class="chev">›</span></summary><div class="bb">
    <p class="small muted" style="margin-top:0">Write each goal in the present tense, as if it’s already true. They show up during Visualisation and Scripting.</p>
    ${M.goals.map((g, i) => `<div class="erow"><input id="goal-${i}" data-f="goal" data-i="${i}" value="${esc(g)}" placeholder="I …"><button class="mdel" data-a="goaldel" data-v="${i}" aria-label="Remove goal">×</button></div>`).join('')}
    <button class="addset" data-a="goaladd">+ Add goal</button></div></details>`;
  h += `<details class="blk"><summary><h3>Affirmations</h3><span class="cnt num">${M.affirm.filter(a => a.trim()).length}</span><span class="chev">›</span></summary><div class="bb">
    <p class="small muted" style="margin-top:0">One shows each morning, in rotation. Make them yours.</p>
    ${M.affirm.map((a, i) => `<div class="erow"><input id="aff-${i}" data-f="aff" data-i="${i}" value="${esc(a)}"><button class="mdel" data-a="affdel" data-v="${i}" aria-label="Remove affirmation">×</button></div>`).join('')}
    <button class="addset" data-a="affadd">+ Add affirmation</button></div></details>`;
  h += `<details class="blk"><summary><h3>Your own exercises</h3><span class="cnt num">${M.custom.length}</span><span class="chev">›</span></summary><div class="bb">
    ${M.custom.map((c, i) => `<div class="erow"><span style="flex:1"><b>${esc(c.name)}</b> <span class="muted small">${c.min ? esc(c.min) + ' min' : 'open-ended'}</span></span><button class="mdel" data-a="custdel" data-v="${i}" aria-label="Remove ${esc(c.name)}">×</button></div>`).join('')}
    <div class="fgrid" style="margin-top:8px"><div class="fld wide"><label for="cx-name">Name</label><input id="cx-name" placeholder="e.g. Cold shower focus"></div>
      <div class="fld"><label for="cx-min">Minutes (0 = open-ended)</label><input id="cx-min" inputmode="numeric" placeholder="5"></div>
      <div class="fld wide"><label for="cx-how">How to do it</label><input id="cx-how" placeholder="Short instructions"></div></div>
    <button class="big ghost" data-a="custadd">Add exercise</button></div></details>`;
  return h;
}

function mindClick(a, b, v) {
  const M = () => mindMeta();
  switch (a) {
    case 'mday': V.md = v === '0' ? todayKey() : keyOf(addDays(parseKey(V.md || todayKey()), +v)); if (V.md > todayKey()) V.md = todayKey(); window.scrollTo(0, 0); render(); return true;
    case 'mstart': mtStart(v); return true;
    case 'mpause': if (MT) { if (MT.paused) { MT.paused = false; MT.start = Date.now(); } else { MT.acc = mtElapsed(); MT.paused = true; } saveMT(); V.keepScroll = true; render(); } return true;
    case 'mfinish': mtFinish(false); return true;
    case 'mcancel': MT = null; saveMT(); V.keepScroll = true; render(); return true;
    case 'mdel': { const d = mday(V.md); d.sessions.splice(+v, 1); touch('mind/' + V.md); V.keepScroll = true; render(); return true; }
    case 'mmood': { const d = mday(V.md); d.mood = String(d.mood) === v ? '' : v; touch('mind/' + V.md); b.parentElement.querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.v === String(d.mood))); return true; }
    case 'goaladd': M().goals.push(''); touch('meta/mind'); V.keepScroll = true; render(); setTimeout(() => $('#goal-' + (M().goals.length - 1))?.focus(), 30); return true;
    case 'goaldel': M().goals.splice(+v, 1); touch('meta/mind'); V.keepScroll = true; render(); return true;
    case 'affadd': M().affirm.push(''); touch('meta/mind'); V.keepScroll = true; render(); setTimeout(() => $('#aff-' + (M().affirm.length - 1))?.focus(), 30); return true;
    case 'affdel': M().affirm.splice(+v, 1); touch('meta/mind'); V.keepScroll = true; render(); return true;
    case 'custadd': {
      const name = ($('#cx-name')?.value || '').trim(); if (!name) { toast('Give the exercise a name'); return true; }
      M().custom.push({ id: 'c' + Date.now(), name, min: String(parseInt($('#cx-min')?.value, 10) || 0), how: ($('#cx-how')?.value || '').trim() });
      touch('meta/mind'); V.keepScroll = true; render(); toast(name + ' added'); return true;
    }
    case 'custdel': M().custom.splice(+v, 1); touch('meta/mind'); V.keepScroll = true; render(); return true;
  }
  return false;
}
function mindInput(f, t) {
  if (f === 'mi') {
    const d = mday(V.md); const k = t.dataset.k;
    if (/^g\d$/.test(k)) d.grat[+k[1]] = t.value; else d[k] = t.value;
    touch('mind/' + V.md); return true;
  }
  if (f === 'mtext') { if (MT) { MT.text = t.value; saveMT(); } return true; }
  if (f === 'goal') { mindMeta().goals[+t.dataset.i] = t.value; touch('meta/mind'); return true; }
  if (f === 'aff') { mindMeta().affirm[+t.dataset.i] = t.value; touch('meta/mind'); return true; }
  return false;
}

/* Mind summary on the Progress tab */
function mindProgress() {
  const today = new Date(); const mon = mondayOf(today);
  let wkSec = 0; const counts = {};
  Object.values(S.mind || {}).forEach(d => {
    (d.sessions || []).forEach(s => { counts[s.name] = (counts[s.name] || 0) + 1; });
    if (d.date >= keyOf(mon) && d.date <= keyOf(today)) wkSec += (d.sessions || []).reduce((a, s) => a + (s.sec || 0), 0);
  });
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3);
  let dots = '';
  for (let i = 27; i >= 0; i--) {
    const dt = addDays(today, -i); const d = peekMday(keyOf(dt)); const on = mindActive(d);
    const x = (27 - i) * 11 + 5;
    dots += `<circle cx="${x}" cy="8" r="4" fill="${on ? 'var(--accent)' : 'var(--line)'}"><title>${fmtDate(dt, { day: 'numeric', month: 'short' })}${on ? ' — done' : ''}</title></circle>`;
  }
  return `<div class="blk"><div class="bh"><h3>Mind</h3></div><div class="bb">
    <div class="tiles" style="margin-top:0">
      <div class="tile"><div class="v num">${mindStreak()}</div><div class="k">Day streak</div></div>
      <div class="tile"><div class="v num">${Math.round(wkSec / 60)}</div><div class="k">Min this week</div></div>
      <div class="tile"><div class="v num">${Object.values(counts).reduce((a, b) => a + b, 0)}</div><div class="k">Sessions total</div></div>
    </div>
    <div class="lbl" style="margin:14px 0 6px">Last 28 days</div>
    <svg viewBox="0 0 308 16" style="width:100%;height:auto" role="img" aria-label="Mind practice over the last 28 days">${dots}</svg>
    ${top.length ? `<p class="small" style="margin-top:10px">Most used: ${top.map(([n, c]) => `<b>${esc(n)}</b> ×${c}`).join(' · ')}</p>` : ''}
  </div></div>`;
}
