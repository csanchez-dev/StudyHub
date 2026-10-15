const API = (window.API_URL || 'http://localhost:3000').replace(/\/$/, '');
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = q => document.querySelector(q);
const val = i => ($('#' + i)?.value || '').trim();
const tk = {
  get: () => { try { return localStorage.getItem('bp.token') || ''; } catch (e) { return ''; } },
  set: v => { try { v ? localStorage.setItem('bp.token', v) : localStorage.removeItem('bp.token'); } catch (e) {} },
};
let token = tk.get(), S = { subjects: [], sel: null };
const ui = { tab: 'overview', flip: false, arm: null };

/* ---------- API ---------- */
async function api(p, method = 'GET', body) {
  let r;
  try {
    r = await fetch(API + '/api' + p, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) { throw new Error('Cannot reach the server'); }
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && p !== '/login') { logout(); throw new Error('Session expired'); }
  if (!r.ok) throw new Error(j.error || 'Request failed');
  return j;
}
const push = p => p.catch(e => toast(e.message));
function toast(m) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = m;
  document.body.appendChild(t); setTimeout(() => t.remove(), 3500);
}

/* ---------- gate (login / loading) ---------- */
function gate(html) { $('#app').classList.add('gate'); $('#side').hidden = true; $('#main').innerHTML = html; }
function login(msg = '') {
  gate(`<div class="ctr"><div class="logo" style="justify-content:center;font-size:26px">⚙️ <i>BackendPath</i></div>
  <p class="muted">Enter your password to open your study hub.</p>
  <input id="pw" type="password" placeholder="Password" autofocus>
  <div class="row"><button class="btn" style="width:100%" data-a="login">Sign in</button></div>
  <p class="err">${esc(msg)}</p></div>`);
}
function logout() { token = ''; tk.set(''); login(); }
async function doLogin() {
  const pw = $('#pw')?.value;
  if (!pw) return;
  try { const r = await api('/login', 'POST', { password: pw }); token = r.token; tk.set(token); load(); }
  catch (e) { login(e.message); }
}
async function load() {
  gate('<div class="empty"><div class="spin"></div>Loading… the free server can take up to a minute to wake up.</div>');
  try {
    S.subjects = await api('/subjects');
    if (!S.subjects.find(s => s.id === S.sel)) S.sel = S.subjects[0]?.id || null;
    draw();
  } catch (e) {
    if (token) gate(`<div class="empty"><big>⚠️</big>${esc(e.message)}<div class="row" style="justify-content:center"><button class="btn" data-a="retry">Retry</button></div></div>`);
  }
}

/* ---------- state helpers ---------- */
const cur = () => S.subjects.find(s => s.id === S.sel) || S.subjects[0];
const due = s => s.cards.filter(c => c.due <= Date.now()).length;
const mast = s => (s.cards.length ? Math.round(100 * s.cards.filter(c => c.iv >= 7).length / s.cards.length) : 0);
const dueList = s => s.cards.filter(c => c.due <= Date.now()).sort((a, b) => a.due - b.due);

/* ---------- views ---------- */
function side() {
  const all = S.subjects, tc = all.reduce((a, s) => a + s.cards.length, 0), td = all.reduce((a, s) => a + due(s), 0);
  $('#side').innerHTML = `<div class="logo">⚙️ <i>BackendPath</i></div>
  <div class="stats"><div class="stat"><b>${all.length}</b>subjects</div><div class="stat"><b>${tc}</b>cards</div><div class="stat"><b>${td}</b>due</div></div>
  ${all.map((s, i) => `<button class="sub ${s.id === S.sel ? 'on' : ''}" style="animation-delay:${i * 50}ms" data-a="pick" data-id="${esc(s.id)}">${esc(s.emoji)} <b>${esc(s.name)}</b><small>${s.cards.length} cards · ${due(s)} due</small><div class="bar"><span style="width:${mast(s)}%"></span></div></button>`).join('')}
  <h2>＋ New subject</h2>
  <div class="row"><input id="ne" value="📘" style="width:58px;text-align:center"><input id="nn" placeholder="e.g. Docker, Redis…"></div>
  <button class="btn" style="width:100%" data-a="addsub">Add subject</button>
  <div class="row" style="margin-top:14px"><button class="btn ghost sm" data-a="exp">Export</button><button class="btn ghost sm" data-a="imp">Import</button><button class="btn ghost sm" data-a="out">Log out</button></div>
  <input type="file" id="imf" accept=".json" hidden>`;
}
function main() {
  const s = cur();
  if (!s) { $('#main').innerHTML = '<div class="empty"><big>🚀</big><b>Start your path</b><br>Create your first subject from the sidebar.</div>'; return; }
  const T = [['overview', '📝 Overview'], ['media', '🎬 Media'], ['glossary', '📖 Glossary'], ['study', '🧠 Study (' + due(s) + ')']];
  $('#main').innerHTML = `<h1>${esc(s.emoji)} ${esc(s.name)}</h1>
  <div class="tabs">${T.map(t => `<button class="tab ${ui.tab === t[0] ? 'on' : ''}" data-a="tab" data-id="${t[0]}">${t[1]}</button>`).join('')}</div>
  <div class="pane" id="pane">${{ overview, media, glossary, study }[ui.tab](s)}</div>`;
}
const draw = () => { $('#app').classList.remove('gate'); $('#side').hidden = false; side(); main(); };

function overview(s) {
  const m = s.cards.filter(c => c.iv >= 7).length;
  return `<div class="row"><span class="chip">${s.cards.length} terms</span><span class="chip">${s.videos.length} videos</span><span class="chip">${s.images.length} images</span><span class="chip">${m} mastered</span></div>
  <h2>Study plan & notes</h2><textarea id="notes" placeholder="Write goals, resources, roadmap…">${esc(s.notes)}</textarea>
  <div class="row"><button class="btn ghost sm" data-a="del">${ui.arm === s.id ? 'Click again to confirm' : 'Delete subject'}</button></div>`;
}
function media(s) {
  const host = u => { try { return new URL(u).hostname.replace('www.', ''); } catch (e) { return u; } };
  return `<h2>Videos</h2><div class="row"><input id="vt" placeholder="Title"><input id="vu" placeholder="https://youtube.com/…"><button class="btn" data-a="addvid">Add</button></div>
  <div class="grid">${s.videos.map((v, i) => `<div class="card" style="animation-delay:${i * 60}ms"><a class="vid" href="${esc(v.u)}" target="_blank" rel="noopener noreferrer"><div class="play">▶</div><b>${esc(v.t)}</b><div class="muted">${esc(host(v.u))}</div></a><button class="x" data-a="delvid" data-id="${esc(v.id)}">✕</button></div>`).join('') || '<div class="muted">No videos yet.</div>'}</div>
  <h2>Images & diagrams</h2><div class="row"><input type="file" id="img" accept="image/*" multiple></div>
  <div class="grid">${s.images.map((im, i) => `<div class="card" style="animation-delay:${i * 60}ms"><img src="${esc(im.u)}" alt="Subject image"><button class="x" data-a="delimg" data-id="${esc(im.id)}">✕</button></div>`).join('') || '<div class="muted">No images yet.</div>'}</div>`;
}
function glossary(s) {
  return `<div class="row"><input id="gt" placeholder="Term"><input id="gd" placeholder="Definition"><button class="btn" data-a="addcard">Add</button></div>
  <input id="gs" placeholder="🔎 Search glossary…" style="margin:6px 0 14px">
  <div id="gl">${s.cards.map((c, i) => `<div class="term" data-q="${esc((c.t + ' ' + c.d).toLowerCase())}" style="animation-delay:${i * 40}ms"><div><b>${esc(c.t)}</b><div>${esc(c.d)}</div></div><button class="x" data-a="delcard" data-id="${esc(c.id)}">✕</button></div>`).join('') || '<div class="empty"><big>📖</big>Add your first concept above.</div>'}</div>`;
}
function study(s) {
  if (!s.cards.length) return '<div class="empty"><big>🃏</big>Add terms in the Glossary to generate flashcards.</div>';
  const q = dueList(s);
  if (!q.length) return '<div class="empty"><big>🎉</big><b>All caught up!</b><br>Come back later — your next cards are scheduled.</div>';
  const c = q[0]; ui.flip = false;
  return `<div class="ctr muted">${q.length} due · click the card or press Space · keys 1–4 to rate</div>
  <div class="scene"><div class="fc" id="fc" data-a="flip"><div class="face"><small>Term</small>${esc(c.t)}</div><div class="face back"><small>Definition</small>${esc(c.d)}</div></div></div>
  <div class="rate" id="rate"><button style="background:#e17055" data-a="rate" data-id="0">Again</button><button style="background:#e1a100" data-a="rate" data-id="1">Hard</button><button style="background:#00b894" data-a="rate" data-id="2">Good</button><button style="background:#0984e3" data-a="rate" data-id="3">Easy</button></div>`;
}

/* ---------- study logic ---------- */
function flip() {
  const f = $('#fc'); if (!f) return;
  ui.flip = !ui.flip; f.classList.toggle('flip', ui.flip); $('#rate').classList.toggle('show', ui.flip);
}
function rate(g) {
  const c = dueList(cur())[0]; if (!c) return;
  const D = 864e5;
  if (g === 0) { c.iv = 0; c.ease = Math.max(1.3, c.ease - .2); c.due = Date.now() + 6e4; }
  else {
    if (g === 1) { c.iv = Math.max(1, c.iv * 1.2); c.ease = Math.max(1.3, c.ease - .15); }
    if (g === 2) c.iv = c.iv ? c.iv * c.ease : 1;
    if (g === 3) { c.iv = c.iv ? c.iv * c.ease * 1.3 : 3; c.ease += .15; }
    c.due = Date.now() + c.iv * D;
  }
  push(api('/cards/' + c.id, 'PATCH', { due: c.due, iv: c.iv, ease: c.ease }));
  draw();
}
function shrink(file) {
  return new Promise(r => {
    const fr = new FileReader();
    fr.onload = () => {
      const im = new Image();
      im.onload = () => {
        const k = Math.min(1, 800 / im.width), cv = document.createElement('canvas');
        cv.width = im.width * k; cv.height = im.height * k;
        cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
        r(cv.toDataURL('image/jpeg', .72));
      };
      im.onerror = () => r(null); im.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}

/* ---------- events ---------- */
let noteTimer;
document.addEventListener('click', e => {
  const b = e.target.closest('[data-a]'); if (!b) return;
  const a = b.dataset.a, d = b.dataset.id, s = cur();
  if (a === 'login') doLogin();
  else if (a === 'retry') load();
  else if (a === 'out') logout();
  else if (a === 'pick') { S.sel = d; ui.arm = null; draw(); }
  else if (a === 'tab') { ui.tab = d; main(); }
  else if (a === 'addsub') {
    const n = val('nn'); if (!n) return;
    const x = { id: uid(), emoji: val('ne') || '📘', name: n, notes: '', videos: [], images: [], cards: [] };
    S.subjects.push(x); S.sel = x.id; ui.tab = 'overview';
    push(api('/subjects', 'POST', { id: x.id, emoji: x.emoji, name: x.name })); draw();
  }
  else if (a === 'del') {
    if (ui.arm !== s.id) { ui.arm = s.id; main(); return; }
    S.subjects = S.subjects.filter(x => x.id !== s.id); S.sel = S.subjects[0]?.id || null; ui.arm = null;
    push(api('/subjects/' + s.id, 'DELETE')); draw();
  }
  else if (a === 'addvid') {
    const t = val('vt'), u = val('vu'); if (!t || !/^https?:\/\//i.test(u)) return;
    const v = { id: uid(), t, u }; s.videos.push(v);
    push(api(`/subjects/${s.id}/videos`, 'POST', { id: v.id, title: t, url: u })); main();
  }
  else if (a === 'delvid') { s.videos = s.videos.filter(v => v.id !== d); push(api('/videos/' + d, 'DELETE')); main(); }
  else if (a === 'delimg') { s.images = s.images.filter(v => v.id !== d); push(api('/images/' + d, 'DELETE')); main(); }
  else if (a === 'addcard') {
    const t = val('gt'), df = val('gd'); if (!t || !df) return;
    const c = { id: uid(), t, d: df, due: 0, iv: 0, ease: 2.5 }; s.cards.push(c);
    push(api(`/subjects/${s.id}/cards`, 'POST', { id: c.id, term: t, definition: df })); draw();
  }
  else if (a === 'delcard') { s.cards = s.cards.filter(c => c.id !== d); push(api('/cards/' + d, 'DELETE')); draw(); }
  else if (a === 'flip') flip();
  else if (a === 'rate') rate(+d);
  else if (a === 'exp') {
    const l = document.createElement('a');
    l.href = URL.createObjectURL(new Blob([JSON.stringify({ subjects: S.subjects })], { type: 'application/json' }));
    l.download = 'backendpath-backup.json'; l.click();
  }
  else if (a === 'imp') $('#imf').click();
});
document.addEventListener('input', e => {
  if (e.target.id === 'notes') {
    const s = cur(), v = e.target.value; s.notes = v;
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => push(api('/subjects/' + s.id, 'PATCH', { notes: v })), 600);
  }
  if (e.target.id === 'gs') {
    const q = e.target.value.toLowerCase();
    document.querySelectorAll('#gl .term').forEach(t => t.style.display = t.dataset.q.includes(q) ? '' : 'none');
  }
});
document.addEventListener('change', async e => {
  if (e.target.id === 'img') {
    const s = cur();
    for (const f of e.target.files) {
      const u = await shrink(f); if (!u) continue;
      const im = { id: uid(), u }; s.images.push(im);
      push(api(`/subjects/${s.id}/images`, 'POST', { id: im.id, data: u }));
    }
    main();
  }
  if (e.target.id === 'imf') {
    const f = e.target.files[0]; if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      const r = await api('/import', 'POST', { subjects: j.subjects || j });
      toast(`Imported ${r.imported} subject(s)`); await load();
    } catch (x) { toast(x.message); }
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.id === 'pw') return doLogin();
  if (ui.tab !== 'study' || !$('#fc') || /INPUT|TEXTAREA/.test(e.target.tagName)) return;
  if (e.code === 'Space') { e.preventDefault(); flip(); }
  if (ui.flip && '1234'.includes(e.key)) rate(+e.key - 1);
});

token ? load() : login();
