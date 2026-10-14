/* ---------- FOOD: macro tracker. Weigh it, log it, let the target adjust itself. ---------- */
const MACROS = [['kcal', 'Calories', 'kcal'], ['p', 'Protein', 'g'], ['c', 'Carbs', 'g'], ['f', 'Fat', 'g'], ['fib', 'Fibre', 'g'], ['sug', 'Sugar', 'g']];
const KCAL_PER_KG = 7700, SURPLUS = 350, STEP = 150;
const OFF = 'https://nl.openfoodfacts.org';

function foodMeta() {
  if (!S.foodMeta) S.foodMeta = { favs: {}, recipes: {}, plan: {}, _u: 0 };
  const m = S.foodMeta; m.favs = m.favs || {}; m.recipes = m.recipes || {}; m.plan = m.plan || {}; return m;
}
function fday(k) { if (!S.food[k]) S.food[k] = { date: k, entries: [], _u: 0 }; const d = S.food[k]; d.entries = d.entries || []; return d; }
function peekFday(k) { return S.food[k]; }
function r1(x) { return Math.round(x * 10) / 10; }
function entryMacros(en) { const g = num(en.g) || 0; const out = {}; MACROS.forEach(([k]) => { out[k] = (num(en.per?.[k]) || 0) * g / 100; }); return out; }
function dayTotals(d) { const t = { kcal: 0, p: 0, c: 0, f: 0, fib: 0, sug: 0 }; (d?.entries || []).forEach(en => { const m = entryMacros(en); MACROS.forEach(([k]) => { t[k] += m[k]; }); }); return t; }
function loggedDays() { return Object.values(S.food || {}).filter(d => d && d.entries && d.entries.length).map(d => d.date).sort(); }
function latestWeight() {
  const pts = bwPoints(); if (pts.length) return pts[pts.length - 1].v;
  return num(S.checkins?.w01?.bw) || PREV_BASELINE.bw;
}
function bwAvgBetween(k0, k1) { const v = []; Object.entries(S.bw.entries || {}).forEach(([k, x]) => { const n = num(x); if (n != null && k >= k0 && k <= k1) v.push(n); }); return v.length ? { avg: v.reduce((a, b) => a + b, 0) / v.length, n: v.length } : null; }
function avgIntake(k0, k1) { let s = 0, n = 0; Object.values(S.food || {}).forEach(d => { if (d && d.entries && d.entries.length && d.date >= k0 && d.date <= k1) { s += dayTotals(d).kcal; n++; } }); return n ? { avg: s / n, n } : null; }

/* The calorie plan: provisional from a formula, calibrated from 14 days of logs + weigh-ins, then adjusted weekly. */
function foodPlan() {
  const M = foodMeta(); const P = M.plan; const w = latestWeight(); const today = todayKey();
  const h = num(S.settings.height) || 172, age = num(S.settings.age) || 30;
  const bmr = 10 * w + 6.25 * h - 5 * age + 5; const provisional = Math.round((bmr * 1.55 + SURPLUS) / 10) * 10;
  let changed = false;
  // calibration
  if (!P.calibratedOn) {
    const days = loggedDays();
    if (days.length) {
      const k0 = days[0]; const span = Math.round((parseKey(today) - parseKey(k0)) / 864e5);
      P.calDay = Math.min(14, span + 1);
      if (span >= 13 && days.length >= 10) {
        const k1 = keyOf(addDays(parseKey(k0), span));
        const w0 = bwAvgBetween(k0, keyOf(addDays(parseKey(k0), 6))), w1 = bwAvgBetween(keyOf(addDays(parseKey(k1), -6)), k1);
        const inT = avgIntake(k0, k1);
        if (w0 && w1 && w0.n >= 2 && w1.n >= 2 && inT) {
          const maint = inT.avg - (w1.avg - w0.avg) * KCAL_PER_KG / span;
          P.maintenance = Math.round(maint / 10) * 10; P.target = Math.round((maint + SURPLUS) / 10) * 10; P.calibratedOn = today;
          P.log = [{ date: today, to: P.target, why: `Calibrated: you ate ~${Math.round(inT.avg)} kcal/day over ${inT.n} logged days and your weight moved ${(w1.avg - w0.avg) >= 0 ? '+' : ''}${(w1.avg - w0.avg).toFixed(1)} kg in ${span} days → maintenance ≈ ${P.maintenance} kcal.` }];
          P.lastAdjustWeek = weekKeyOf(today); changed = true;
        } else P.calNote = 'Need at least 2 weigh-ins in the first week and 2 in the last week to calibrate — keep weighing in the mornings.';
      }
    }
  }
  // weekly adjustment (runs once per calendar week, on/after Monday)
  if (P.calibratedOn) {
    const wk = weekKeyOf(today);
    if (P.lastAdjustWeek && wk > P.lastAdjustWeek) {
      const mon = mondayOf(new Date()); const lastMon = addDays(mon, -7), prevMon = addDays(mon, -14);
      const a = bwAvgBetween(keyOf(prevMon), keyOf(addDays(prevMon, 6))), b = bwAvgBetween(keyOf(lastMon), keyOf(addDays(lastMon, 6)));
      const inT = avgIntake(keyOf(lastMon), keyOf(addDays(lastMon, 6)));
      let delta = 0, why = '';
      if (!a || !b || a.n < 3 || b.n < 3) why = 'Not enough weigh-ins last week (need 3+) — target unchanged.';
      else if (!inT || inT.n < 4) why = 'Fewer than 4 days logged last week — target unchanged.';
      else { const rate = b.avg - a.avg; if (rate > 0.5) { delta = -STEP; why = `Gained ${rate.toFixed(2)} kg last week (above 0.5) → −${STEP} kcal.`; } else if (rate < 0.25) { delta = STEP; why = `Gained ${rate.toFixed(2)} kg last week (below 0.25) → +${STEP} kcal.`; } else why = `Gained ${rate.toFixed(2)} kg last week — on track, target unchanged.`; }
      P.target = Math.max(1500, (P.target || provisional) + delta); P.lastAdjustWeek = wk;
      P.log = (P.log || []).concat([{ date: today, to: P.target, why }]).slice(-12); changed = true;
    }
  }
  if (changed) touch('meta/food');
  const kcal = P.calibratedOn ? P.target : provisional;
  const p = Math.round(1.8 * w), f = Math.round(0.8 * w), c = Math.max(0, Math.round((kcal - 4 * p - 9 * f) / 4));
  return { kcal, p, c, f, fib: 30, w, provisional: !P.calibratedOn, calDay: P.calDay || 0, note: P.calNote || '', log: P.log || [] };
}
function weekKeyOf(k) { const m = mondayOf(parseKey(k)); return keyOf(m); }

/* ---------- Open Food Facts ---------- */
function offToFood(pr) {
  const n = pr.nutriments || {}; let kcal = num(n['energy-kcal_100g']); if (kcal == null && num(n['energy_100g']) != null) kcal = num(n['energy_100g']) / 4.184;
  if (kcal == null) return null;
  const name = pr.product_name_nl || pr.product_name || pr.product_name_en || ''; if (!name) return null;
  return { name: name.trim(), brand: (pr.brands || '').split(',')[0].trim(), code: pr.code || '', qty: pr.quantity || '',
    per: { kcal: r1(kcal), p: r1(num(n.proteins_100g) || 0), c: r1(num(n.carbohydrates_100g) || 0), f: r1(num(n.fat_100g) || 0), fib: r1(num(n.fiber_100g) || 0), sug: r1(num(n.sugars_100g) || 0) } };
}
const OFF_FIELDS = 'code,product_name,product_name_nl,product_name_en,brands,nutriments,quantity';
async function offSearch(q) {
  const r = await fetch(`${OFF}/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=25&fields=${OFF_FIELDS}`);
  if (!r.ok) throw new Error('search failed'); const j = await r.json();
  return (j.products || []).map(offToFood).filter(Boolean);
}
async function offBarcode(code) {
  const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=${OFF_FIELDS}`);
  if (!r.ok) return null; const j = await r.json(); return j.status === 1 && j.product ? offToFood(j.product) : null;
}

/* ---------- favourites ---------- */
function favKey(food) { return food.code ? 'c' + food.code : 'n' + food.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60); }
function bumpFav(food, g) {
  const M = foodMeta(); const k = favKey(food); const f = M.favs[k] || { name: food.name, brand: food.brand || '', code: food.code || '', per: food.per, uses: 0 };
  f.uses = (f.uses || 0) + 1; f.last = todayKey(); if (g) f.lastG = g; f.per = food.per; M.favs[k] = f; touch('meta/food');
}
function favList() { return Object.entries(foodMeta().favs).map(([k, f]) => Object.assign({ key: k }, f)).sort((a, b) => (b.last || '').localeCompare(a.last || '') || (b.uses || 0) - (a.uses || 0)); }

/* ---------- view state ---------- */
let FS = { q: '', results: null, searching: false, err: '', pick: null, quick: false, scan: false, recipe: null, msg: '' };

function foodBar(k) {
  const d = peekFday(k); const t = dayTotals(d); const pl = foodPlan();
  const pct = x => Math.min(100, Math.round(x * 100));
  return `<button class="fbar" data-a="foodday" data-v="${k}" aria-label="Open food log">
    <span class="fb-row"><span class="fb-l">Calories</span><span class="fb-track"><span class="fb-fill" style="width:${pct(t.kcal / pl.kcal)}%"></span></span><span class="fb-v num">${Math.round(t.kcal)} <small>/ ${pl.kcal}</small></span></span>
    <span class="fb-row"><span class="fb-l">Protein</span><span class="fb-track"><span class="fb-fill p" style="width:${pct(t.p / pl.p)}%"></span></span><span class="fb-v num">${Math.round(t.p)} <small>/ ${pl.p} g</small></span></span>
  </button>`;
}

function renderFood() {
  if (!V.fd) V.fd = todayKey();
  const k = V.fd, isToday = k === todayKey(); const d = peekFday(k) || { entries: [] }; const t = dayTotals(d); const pl = foodPlan();
  let h = `<div class="dayhead"><div class="hbar mind-nav"><button class="ib" data-a="fday" data-v="-1" aria-label="Previous day">‹</button>
    <div class="dt" style="flex:1;text-align:center">${fmtDate(parseKey(k))}</div>
    <button class="ib" data-a="fday" data-v="1" ${isToday ? 'disabled' : ''} aria-label="Next day">›</button>${isToday ? '' : '<button class="pill" data-a="fday" data-v="0">Today</button>'}</div>
    <h1>Food</h1>
    <div class="chips"><span class="chip acc">${pl.provisional ? (pl.calDay ? `Calibrating · day ${pl.calDay} of 14` : 'Provisional target') : 'Calibrated target'}</span><span class="chip">${(d.entries || []).length} entries</span></div></div>`;

  // totals
  const bar = (key, label, unit, tgt, val, cls) => `<div class="mrow"><span class="ml">${label}</span><span class="fb-track"><span class="fb-fill ${cls}" style="width:${Math.min(100, Math.round(val / tgt * 100))}%"></span></span><span class="mv num">${Math.round(val)}<small> / ${tgt} ${unit}</small></span></div>`;
  h += `<div class="blk"><div class="bh"><h3>Today</h3><span class="cnt num">${Math.round(pl.kcal - t.kcal)} kcal left</span></div><div class="bb">
    ${bar('kcal', 'Calories', 'kcal', pl.kcal, t.kcal, '')}${bar('p', 'Protein', 'g', pl.p, t.p, 'p')}${bar('c', 'Carbs', 'g', pl.c, t.c, 'c')}${bar('f', 'Fat', 'g', pl.f, t.f, 'f')}${bar('fib', 'Fibre', 'g', pl.fib, t.fib, 'fib')}
    <div class="mrow"><span class="ml">Sugar</span><span></span><span class="mv num">${Math.round(t.sug)}<small> g</small></span></div>
    <details class="exmore"><summary>How the target is set</summary>
      <p class="small">${pl.provisional ? `Provisional: a standard formula for your weight (${pl.w} kg), height and age, plus a ${SURPLUS} kcal surplus. After 14 days of logging and morning weigh-ins the app replaces it with your real maintenance.` : `Calibrated from your own logs. Every Monday it checks last week: gain above 0.5 kg → −${STEP} kcal, below 0.25 kg → +${STEP} kcal.`}</p>
      ${pl.note ? `<p class="small" style="color:var(--warn)">${esc(pl.note)}</p>` : ''}
      <p class="small">Protein 1.8 g/kg, fat at least 0.8 g/kg, carbs fill the rest, fibre 30 g.</p>
      ${pl.log.length ? `<div class="plog">${pl.log.slice().reverse().map(l => `<p class="small"><b class="num">${fmtDate(parseKey(l.date), { day: 'numeric', month: 'short' })} → ${l.to} kcal.</b> ${esc(l.why)}</p>`).join('')}</div>` : ''}
    </details>
  </div></div>`;

  // add
  h += `<div class="sec"><h3>Add food</h3></div>`;
  h += `<div class="blk"><div class="bb" style="padding-top:14px">
    <div class="srow"><input id="fq" type="search" placeholder="Search a product (e.g. kwark, havermout)" value="${esc(FS.q)}" autocomplete="off" enterkeyhint="search"><button class="sbtn" data-a="fsearch" aria-label="Search">⌕</button></div>
    <div class="seg" style="margin-top:8px"><button data-a="fscan">▣ Scan barcode</button><button data-a="fquick" class="${FS.quick ? 'on' : ''}">Quick add</button><button data-a="fcopy">Copy yesterday</button></div>
    ${FS.scan ? `<div class="scan"><video id="scanvid" playsinline muted autoplay></video><div class="scanline"></div><div class="srow" style="margin-top:8px"><input id="fcode" inputmode="numeric" placeholder="…or type the barcode number"><button class="sbtn" data-a="fcode">Go</button></div><button class="addset rm" data-a="fscanstop">Stop scanning</button></div>` : ''}
    ${FS.quick ? quickForm() : ''}
    ${FS.msg ? `<p class="small" style="color:var(--warn)">${esc(FS.msg)}</p>` : ''}
    ${FS.pick ? pickPanel() : ''}
    ${FS.searching ? '<p class="small muted">Searching…</p>' : ''}
    ${FS.err ? `<p class="small" style="color:var(--bad)">${esc(FS.err)}</p>` : ''}
    ${FS.results ? (FS.results.length ? `<div class="flist">${FS.results.map((f, i) => foodRow(f, 'r', i)).join('')}</div>` : '<p class="small muted">Nothing found. Try a shorter word, the brand name, or scan the barcode.</p>') : ''}
  </div></div>`;

  // favourites + recipes
  const favs = favList();
  h += `<details class="blk" ${FS.results || FS.pick ? '' : 'open'}><summary><h3>Favourites</h3><span class="cnt num">${favs.length}</span><span class="chev">›</span></summary><div class="bb">
    ${favs.length ? `<div class="flist">${favs.slice(0, 30).map(f => foodRow(f, 'f', f.key)).join('')}</div>` : '<p class="small muted" style="margin:0">Every food you log lands here, most recent first. One tap next time.</p>'}
  </div></details>`;
  const R = Object.entries(foodMeta().recipes);
  h += `<details class="blk" ${FS.recipe ? 'open' : ''}><summary><h3>Recipes</h3><span class="cnt num">${R.length}</span><span class="chev">›</span></summary><div class="bb">
    ${R.length ? `<div class="flist">${R.map(([id, r]) => foodRow(recipeAsFood(r), 'rc', id)).join('')}</div>` : ''}
    ${FS.recipe ? recipeBuilder() : `<button class="big ghost" data-a="rcnew">New recipe</button><p class="small muted">Cook a batch, add the ingredients, weigh the finished pot — then log any portion by grams.</p>`}
  </div></details>`;

  // log
  h += `<div class="blk"><div class="bh"><h3>Log</h3><span class="cnt num">${Math.round(t.kcal)} kcal</span></div><div class="bb">${(d.entries || []).length ? (d.entries || []).map((en, i) => {
    const m = entryMacros(en);
    return `<div class="flog"><span class="num mt-at">${esc(en.at || '')}</span><span class="fl-n">${esc(en.name)}${en.brand ? ` <small>${esc(en.brand)}</small>` : ''}<small class="num">${Math.round(m.kcal)} kcal · P ${Math.round(m.p)} · C ${Math.round(m.c)} · F ${Math.round(m.f)}</small></span>
      ${en.src === 'quick' ? '<span></span>' : `<span class="fl-g"><input class="num" inputmode="decimal" data-f="fg" data-i="${i}" value="${esc(en.g)}" aria-label="grams"><small>g</small></span>`}<button class="mdel" data-a="fdel" data-v="${i}" aria-label="Remove ${esc(en.name)}">×</button></div>`;
  }).join('') : '<p class="small muted" style="margin:0">Nothing logged yet.</p>'}</div></div>`;
  return h;
}
function foodRow(f, kind, id) {
  const per = f.per || {};
  return `<button class="frow" data-a="fpick" data-kind="${kind}" data-id="${esc(String(id))}"><span class="fr-n">${esc(f.name)}${f.brand ? ` <small>${esc(f.brand)}</small>` : ''}${f.qty ? ` <small>${esc(f.qty)}</small>` : ''}</span><span class="fr-m num">${Math.round(per.kcal || 0)} kcal<small>P ${Math.round(per.p || 0)} · C ${Math.round(per.c || 0)} · F ${Math.round(per.f || 0)} /100 g</small></span></button>`;
}
function pickPanel() {
  const f = FS.pick; const g = num(FS.g) ?? (f.lastG || 100); const m = {}; MACROS.forEach(([k]) => { m[k] = (num(f.per[k]) || 0) * g / 100; });
  const toRecipe = !!FS.recipe;
  return `<div class="pick"><div class="pk-h"><b>${esc(f.name)}</b>${f.brand ? ` <span class="muted">${esc(f.brand)}</span>` : ''}</div>
    <div class="srow"><input id="fgrams" class="num" inputmode="decimal" value="${g}" data-f="fgrams" aria-label="grams"><span class="muted">g</span></div>
    <div class="pk-m num">${Math.round(m.kcal)} kcal · P ${r1(m.p)} · C ${r1(m.c)} · F ${r1(m.f)} · fibre ${r1(m.fib)} · sugar ${r1(m.sug)}</div>
    <div class="mt-btns"><button class="big ghost" data-a="fcancel">Cancel</button><button class="big" data-a="${toRecipe ? 'rcadd' : 'fadd'}">${toRecipe ? 'Add to recipe' : 'Log it'}</button></div></div>`;
}
function quickForm() {
  return `<div class="pick"><div class="fgrid">
    <div class="fld wide"><label for="qa-name">Name (optional)</label><input id="qa-name" placeholder="e.g. restaurant meal"></div>
    ${MACROS.map(([k, l, u]) => `<div class="fld"><label for="qa-${k}">${l} (${u})</label><input id="qa-${k}" class="num" inputmode="decimal" placeholder="0"></div>`).join('')}
  </div><button class="big" data-a="fquickadd">Log it</button></div>`;
}
function recipeAsFood(r) {
  const tot = { kcal: 0, p: 0, c: 0, f: 0, fib: 0, sug: 0 }; (r.items || []).forEach(it => { const m = entryMacros(it); MACROS.forEach(([k]) => { tot[k] += m[k]; }); });
  const G = num(r.totalG) || (r.items || []).reduce((a, it) => a + (num(it.g) || 0), 0) || 1;
  const per = {}; MACROS.forEach(([k]) => { per[k] = r1(tot[k] / G * 100); });
  return { name: r.name, brand: 'recipe', per, qty: `${Math.round(G)} g total`, lastG: r.lastG };
}
function recipeBuilder() {
  const r = FS.recipe; const asF = recipeAsFood(r);
  return `<div class="pick"><div class="fld"><label for="rc-name">Recipe name</label><input id="rc-name" data-f="rcname" value="${esc(r.name || '')}" placeholder="e.g. Chicken curry, whole pot"></div>
    <div class="flist" style="margin-top:8px">${(r.items || []).map((it, i) => `<div class="flog"><span></span><span class="fl-n">${esc(it.name)}<small class="num">${it.g} g</small></span><span></span><button class="mdel" data-a="rcdel" data-v="${i}" aria-label="Remove">×</button></div>`).join('')}</div>
    <p class="small muted">Pick ingredients from search or favourites above — they’ll be added here. Per 100 g so far: <b class="num">${Math.round(asF.per.kcal)} kcal · P ${asF.per.p}</b></p>
    <div class="fld" style="margin-top:8px"><label for="rc-total">Total cooked weight (g)</label><input id="rc-total" class="num" inputmode="decimal" data-f="rctotal" value="${esc(r.totalG || '')}" placeholder="weigh the finished pot"></div>
    <div class="mt-btns"><button class="big ghost" data-a="rccancel">Discard</button><button class="big" data-a="rcsave">Save recipe</button></div></div>`;
}

/* ---------- actions ---------- */
function nowHM() { return new Date().toTimeString().slice(0, 5); }
function addEntry(food, g, src) {
  const d = fday(V.fd); d.entries.push({ id: 'e' + Date.now(), at: nowHM(), name: food.name, brand: food.brand || '', g: String(g), per: food.per, src: src || 'off', code: food.code || '' });
  touch('food/' + V.fd); if (src !== 'quick') bumpFav(food, g);
}
async function doSearch() {
  const q = ($('#fq')?.value || '').trim(); FS.q = q; if (!q) return;
  FS.searching = true; FS.err = ''; FS.results = null; FS.pick = null; V.keepScroll = true; render();
  try { FS.results = await offSearch(q); } catch (e) { FS.err = navigator.onLine === false ? 'You’re offline — use favourites or quick add.' : 'Search didn’t work. Try again in a moment.'; }
  FS.searching = false; V.keepScroll = true; render();
}
let scanner = null;
async function startScan() {
  FS.scan = true; FS.msg = ''; V.keepScroll = true; render();
  const video = $('#scanvid'); if (!video) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    video.srcObject = stream; await video.play();
    if ('BarcodeDetector' in window) {
      const det = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
      scanner = { stop: () => stream.getTracks().forEach(t => t.stop()) };
      const tick = async () => { if (!FS.scan) return; try { const codes = await det.detect(video); if (codes.length) { onCode(codes[0].rawValue); return; } } catch (e) { } setTimeout(tick, 250); };
      tick();
    } else if (window.ZXing) {
      const reader = new ZXing.BrowserMultiFormatReader();
      scanner = { stop: () => { try { reader.reset(); } catch (e) { } stream.getTracks().forEach(t => t.stop()); } };
      reader.decodeFromStream(stream, video, (res) => { if (res && FS.scan) onCode(res.getText()); });
    } else { FS.msg = 'Scanning isn’t supported here — type the barcode number instead.'; render(); }
  } catch (e) { FS.msg = 'Camera not available — allow camera access, or type the barcode number.'; V.keepScroll = true; render(); }
}
function stopScan() { FS.scan = false; if (scanner) { scanner.stop(); scanner = null; } }
async function onCode(code) {
  stopScan(); FS.searching = true; V.keepScroll = true; render();
  try { const f = await offBarcode(code); if (f) { FS.pick = f; FS.g = f.lastG || 100; FS.results = null; } else FS.msg = `Barcode ${code} isn’t in the database yet — search by name or use quick add.`; }
  catch (e) { FS.msg = 'Lookup failed — check your signal.'; }
  FS.searching = false; V.keepScroll = true; render(); setTimeout(() => $('#fgrams')?.select(), 30);
}
function foodClick(a, b, v) {
  switch (a) {
    case 'foodday': V.fd = v; V.tab = 'food'; window.scrollTo(0, 0); render(); return true;
    case 'fday': V.fd = v === '0' ? todayKey() : keyOf(addDays(parseKey(V.fd || todayKey()), +v)); if (V.fd > todayKey()) V.fd = todayKey(); FS.pick = null; window.scrollTo(0, 0); render(); return true;
    case 'fsearch': doSearch(); return true;
    case 'fscan': startScan(); return true;
    case 'fscanstop': stopScan(); V.keepScroll = true; render(); return true;
    case 'fcode': { const c = ($('#fcode')?.value || '').trim(); if (c) onCode(c); return true; }
    case 'fquick': FS.quick = !FS.quick; FS.pick = null; V.keepScroll = true; render(); return true;
    case 'fquickadd': {
      const per = {}; MACROS.forEach(([k]) => { per[k] = num($('#qa-' + k)?.value) || 0; });
      if (!per.kcal && !per.p && !per.c && !per.f) { toast('Enter at least calories or a macro'); return true; }
      const name = ($('#qa-name')?.value || '').trim() || 'Quick add';
      addEntry({ name, per }, 100, 'quick'); FS.quick = false; toast('Logged'); V.keepScroll = true; render(); return true;
    }
    case 'fcopy': {
      const y = peekFday(keyOf(addDays(parseKey(V.fd), -1)));
      if (!y || !y.entries.length) { toast('Nothing logged yesterday'); return true; }
      const d = fday(V.fd); y.entries.forEach(en => d.entries.push(Object.assign({}, clone(en), { id: 'e' + Date.now() + Math.random().toString(36).slice(2, 6), at: nowHM() })));
      touch('food/' + V.fd); toast(`Copied ${y.entries.length} entries`); V.keepScroll = true; render(); return true;
    }
    case 'fpick': {
      const kind = b.dataset.kind, id = b.dataset.id; let f = null;
      if (kind === 'r') f = FS.results[+id]; else if (kind === 'f') f = foodMeta().favs[id]; else if (kind === 'rc') { f = recipeAsFood(foodMeta().recipes[id]); f.recipeId = id; }
      if (!f) return true; FS.pick = f; FS.g = f.lastG || 100; FS.quick = false; V.keepScroll = true; render(); setTimeout(() => { $('#fgrams')?.focus(); $('#fgrams')?.select(); }, 30); return true;
    }
    case 'fcancel': FS.pick = null; V.keepScroll = true; render(); return true;
    case 'fadd': {
      const f = FS.pick; const g = num($('#fgrams')?.value); if (!g || g <= 0) { toast('Enter the weight in grams'); return true; }
      if (f.recipeId) { foodMeta().recipes[f.recipeId].lastG = g; }
      addEntry(f, g, f.recipeId ? 'recipe' : 'off'); FS.pick = null; FS.results = null; FS.q = ''; toast(`Logged ${f.name}`); V.keepScroll = true; render(); return true;
    }
    case 'fdel': { const d = fday(V.fd); d.entries.splice(+v, 1); touch('food/' + V.fd); V.keepScroll = true; render(); return true; }
    case 'rcnew': FS.recipe = { name: '', items: [], totalG: '' }; V.keepScroll = true; render(); setTimeout(() => $('#rc-name')?.focus(), 30); return true;
    case 'rcadd': { const f = FS.pick; const g = num($('#fgrams')?.value); if (!g) { toast('Enter grams'); return true; } FS.recipe.items.push({ name: f.name, g: String(g), per: f.per }); FS.pick = null; FS.results = null; V.keepScroll = true; render(); return true; }
    case 'rcdel': FS.recipe.items.splice(+v, 1); V.keepScroll = true; render(); return true;
    case 'rccancel': FS.recipe = null; V.keepScroll = true; render(); return true;
    case 'rcsave': {
      const r = FS.recipe; r.name = ($('#rc-name')?.value || r.name || '').trim(); r.totalG = ($('#rc-total')?.value || r.totalG || '').trim();
      if (!r.name || !r.items.length) { toast('Give it a name and at least one ingredient'); return true; }
      foodMeta().recipes['r' + Date.now()] = r; touch('meta/food'); FS.recipe = null; toast('Recipe saved'); V.keepScroll = true; render(); return true;
    }
    case 'rcremove': { delete foodMeta().recipes[v]; touch('meta/food'); V.keepScroll = true; render(); return true; }
  }
  return false;
}
function foodInput(f, t) {
  if (f === 'fgrams') { FS.g = t.value; const el = $('.pk-m'); if (el && FS.pick) { const g = num(t.value) || 0; const m = {}; MACROS.forEach(([k]) => { m[k] = (num(FS.pick.per[k]) || 0) * g / 100; }); el.textContent = `${Math.round(m.kcal)} kcal · P ${r1(m.p)} · C ${r1(m.c)} · F ${r1(m.f)} · fibre ${r1(m.fib)} · sugar ${r1(m.sug)}`; } return true; }
  if (f === 'fg') { const d = fday(V.fd); const en = d.entries[+t.dataset.i]; if (en) { en.g = t.value.trim(); touch('food/' + V.fd); const c = $('.blk .cnt.num:last-of-type'); } return true; }
  if (f === 'rcname') { if (FS.recipe) FS.recipe.name = t.value; return true; }
  if (f === 'rctotal') { if (FS.recipe) FS.recipe.totalG = t.value; return true; }
  return false;
}
function foodKey(e) { if (e.key === 'Enter' && e.target.id === 'fq') { e.preventDefault(); doSearch(); } if (e.key === 'Enter' && e.target.id === 'fgrams') { e.preventDefault(); document.querySelector('[data-a="fadd"],[data-a="rcadd"]')?.click(); } }

/* ---------- weekly + progress ---------- */
function foodWeek(w) {
  const k0 = keyOf(dateOf(w, 0)), k1 = keyOf(dateOf(w, 6)); let kcal = 0, p = 0, n = 0;
  Object.values(S.food || {}).forEach(d => { if (d && d.entries && d.entries.length && d.date >= k0 && d.date <= k1) { const t = dayTotals(d); kcal += t.kcal; p += t.p; n++; } });
  return n ? { kcal: kcal / n, p: p / n, n } : null;
}
function foodWeeklyHTML(w) {
  const f = foodWeek(w); const pl = foodPlan();
  return `<div class="tiles" style="margin-top:12px">
    <div class="tile"><div class="v num">${f ? Math.round(f.kcal) : '–'}</div><div class="k">Avg kcal / day</div><div class="s num">target ${pl.kcal}</div></div>
    <div class="tile"><div class="v num">${f ? Math.round(f.p) : '–'}</div><div class="k">Avg protein g</div><div class="s num">target ${pl.p}</div></div>
    <div class="tile"><div class="v num">${f ? f.n : 0}/7</div><div class="k">Days logged</div></div>
  </div>`;
}
function foodProgress() {
  const p = posOf(new Date()); const cur = Math.max(1, Math.min(16, p.w)); const rows = [];
  for (let w = Math.max(1, cur - 7); w <= cur; w++) { const f = foodWeek(w); const a = bwAvg(w), b = w > 1 ? bwAvg(w - 1) : null; rows.push({ w, f, d: a != null && b != null ? a - b : null }); }
  const pl = foodPlan(); const max = Math.max(pl.kcal, ...rows.map(r => r.f ? r.f.kcal : 0)) * 1.1;
  const W = 340, H = 150, L = 36, R = 8, T = 10, B = 26; const bw = (W - L - R) / rows.length;
  const Y = v => T + (1 - v / max) * (H - T - B);
  let svg = `<line x1="${L}" x2="${W - R}" y1="${Y(pl.kcal)}" y2="${Y(pl.kcal)}" stroke="var(--hot)" stroke-dasharray="4 3" stroke-width="1.5"/><text x="${W - R}" y="${Y(pl.kcal) - 4}" text-anchor="end" font-size="10" fill="var(--hot)">target ${pl.kcal}</text>`;
  rows.forEach((r, i) => {
    const x = L + i * bw + 4;
    if (r.f) svg += `<rect x="${x}" y="${Y(r.f.kcal)}" width="${bw - 8}" height="${H - B - Y(r.f.kcal)}" rx="2" fill="var(--accent)" opacity=".85"><title>Week ${r.w}: ${Math.round(r.f.kcal)} kcal avg over ${r.f.n} days</title></rect>`;
    else svg += `<rect x="${x}" y="${H - B - 2}" width="${bw - 8}" height="2" fill="var(--line)"/>`;
    svg += `<text x="${x + (bw - 8) / 2}" y="${H - B + 12}" text-anchor="middle" font-size="10" fill="var(--ink-3)">W${r.w}</text>`;
    if (r.d != null) svg += `<text x="${x + (bw - 8) / 2}" y="${H - B + 23}" text-anchor="middle" font-size="9" fill="${r.d > 0.5 ? 'var(--warn)' : r.d < 0.25 ? 'var(--ink-3)' : 'var(--good)'}">${r.d >= 0 ? '+' : ''}${r.d.toFixed(1)}</text>`;
  });
  return `<div class="blk"><div class="bh"><h3>Food</h3></div><div class="bb">
    <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto" role="img" aria-label="Average daily calories per week with weight change">${svg}</svg>
    <div class="legend"><span><i style="background:var(--accent)"></i>Avg kcal per logged day</span><span><i style="background:var(--hot)"></i>Target</span><span>Numbers under the bars: kg gained that week</span></div>
  </div></div>`;
}
