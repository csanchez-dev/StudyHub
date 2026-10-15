const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { Pool } = require('pg');

const { DATABASE_URL, APP_PASSWORD, JWT_SECRET, FRONTEND_URL = '', PORT = 3000 } = process.env;
if (!DATABASE_URL || !APP_PASSWORD || !JWT_SECRET) {
  console.error('Set DATABASE_URL, APP_PASSWORD and JWT_SECRET');
  process.exit(1);
}

const local = /@(localhost|127\.0\.0\.1)/.test(DATABASE_URL);
const pool = new Pool({ connectionString: DATABASE_URL, ssl: local ? false : { rejectUnauthorized: false } });
const q = (text, params) => pool.query(text, params).then(r => r.rows);

const app = express();
app.set('trust proxy', 1);
const origins = FRONTEND_URL.split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean);
app.use(cors({
  origin: origins.length ? origins : false,
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json({ limit: '12mb' }));

// ---------- helpers ----------
const h = fn => (req, res, next) => fn(req, res).catch(next);
const bad = m => Object.assign(new Error(m), { status: 400 });
const str = (v, max, name) => {
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw bad(`Invalid ${name}`);
  return v.trim();
};
const num = (v, name) => { if (!Number.isFinite(v)) throw bad(`Invalid ${name}`); return v; };
const nid = v => (/^[\w-]{1,64}$/.test(v || '') ? v : crypto.randomUUID());
const notes = v => (typeof v === 'string' ? v.slice(0, 20000) : null);
const isUrl = u => /^https?:\/\//i.test(u || '');

// ---------- public ----------
app.get('/health', (_req, res) => res.json({ ok: true }));

const sha = s => crypto.createHash('sha256').update(String(s)).digest();
const tries = new Map();
app.post('/api/login', (req, res) => {
  const ip = req.ip, now = Date.now();
  const t = (tries.get(ip) || []).filter(x => now - x < 15 * 60 * 1000);
  if (t.length >= 10) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  if (!crypto.timingSafeEqual(sha(req.body.password), sha(APP_PASSWORD))) {
    t.push(now); tries.set(ip, t);
    return res.status(401).json({ error: 'Wrong password' });
  }
  res.json({ token: jwt.sign({ u: 'owner' }, JWT_SECRET, { expiresIn: '30d' }) });
});

// ---------- auth wall ----------
app.use('/api', (req, res, next) => {
  try { jwt.verify((req.headers.authorization || '').replace(/^Bearer /, ''), JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Unauthorized' }); }
});

// ---------- subjects ----------
app.get('/api/subjects', h(async (_req, res) => {
  const [s, v, i, c] = await Promise.all(
    ['subjects', 'videos', 'images', 'cards'].map(t => q(`select * from ${t} order by created_at, id`))
  );
  const by = (rows, f) => rows.reduce((m, r) => ((m[r.subject_id] ??= []).push(f(r)), m), {});
  const V = by(v, r => ({ id: r.id, t: r.title, u: r.url }));
  const I = by(i, r => ({ id: r.id, u: r.data }));
  const C = by(c, r => ({ id: r.id, t: r.term, d: r.definition, due: r.due, iv: r.iv, ease: r.ease }));
  res.json(s.map(r => ({
    id: r.id, emoji: r.emoji, name: r.name, notes: r.notes,
    videos: V[r.id] || [], images: I[r.id] || [], cards: C[r.id] || [],
  })));
}));

app.post('/api/subjects', h(async (req, res) => {
  const b = req.body;
  const r = await q(
    'insert into subjects(id,emoji,name,notes) values($1,$2,$3,$4) returning id',
    [nid(b.id), str(b.emoji || '📘', 16, 'emoji'), str(b.name, 80, 'name'), notes(b.notes) ?? '']
  );
  res.status(201).json(r[0]);
}));

app.patch('/api/subjects/:id', h(async (req, res) => {
  const b = req.body;
  await q(
    'update subjects set emoji=coalesce($2,emoji), name=coalesce($3,name), notes=coalesce($4,notes) where id=$1',
    [req.params.id, b.emoji ? str(b.emoji, 16, 'emoji') : null, b.name ? str(b.name, 80, 'name') : null, notes(b.notes)]
  );
  res.json({ ok: true });
}));

app.delete('/api/subjects/:id', h(async (req, res) => {
  await q('delete from subjects where id=$1', [req.params.id]);
  res.json({ ok: true });
}));

// ---------- videos / images / cards (insert...select returns 404 if subject is missing) ----------
const created = (res, rows) => rows.length ? res.status(201).json(rows[0]) : res.status(404).json({ error: 'Subject not found' });

app.post('/api/subjects/:sid/videos', h(async (req, res) => {
  const b = req.body;
  if (!isUrl(b.url)) throw bad('Invalid url');
  created(res, await q(
    'insert into videos(id,subject_id,title,url) select $1,id,$3,$4 from subjects where id=$2 returning id',
    [nid(b.id), req.params.sid, str(b.title, 200, 'title'), str(b.url, 2000, 'url')]
  ));
}));

app.post('/api/subjects/:sid/images', h(async (req, res) => {
  const b = req.body;
  if (typeof b.data !== 'string' || !/^data:image\//.test(b.data)) throw bad('Invalid image');
  created(res, await q(
    'insert into images(id,subject_id,data) select $1,id,$3 from subjects where id=$2 returning id',
    [nid(b.id), req.params.sid, b.data]
  ));
}));

app.post('/api/subjects/:sid/cards', h(async (req, res) => {
  const b = req.body;
  created(res, await q(
    'insert into cards(id,subject_id,term,definition) select $1,id,$3,$4 from subjects where id=$2 returning id',
    [nid(b.id), req.params.sid, str(b.term, 200, 'term'), str(b.definition, 2000, 'definition')]
  ));
}));

app.patch('/api/cards/:id', h(async (req, res) => {
  const b = req.body;
  await q('update cards set due=$2, iv=$3, ease=$4 where id=$1',
    [req.params.id, num(b.due, 'due'), num(b.iv, 'iv'), num(b.ease, 'ease')]);
  res.json({ ok: true });
}));

for (const t of ['videos', 'images', 'cards']) {
  app.delete(`/api/${t}/:id`, h(async (req, res) => {
    await q(`delete from ${t} where id=$1`, [req.params.id]);
    res.json({ ok: true });
  }));
}

// ---------- import (accepts the old local-backup shape too) ----------
app.post('/api/import', h(async (req, res) => {
  const subs = Array.isArray(req.body.subjects) ? req.body.subjects.slice(0, 200) : [];
  const c = await pool.connect();
  let n = 0;
  try {
    await c.query('begin');
    for (const s of subs) {
      const sid = crypto.randomUUID();
      await c.query('insert into subjects(id,emoji,name,notes) values($1,$2,$3,$4)',
        [sid, str(s.emoji || '📘', 16, 'emoji'), str(s.name, 80, 'name'), String(s.notes || '').slice(0, 20000)]);
      for (const v of s.videos || []) {
        if (isUrl(v.u)) await c.query('insert into videos(id,subject_id,title,url) values($1,$2,$3,$4)',
          [crypto.randomUUID(), sid, String(v.t || v.u).slice(0, 200), String(v.u).slice(0, 2000)]);
      }
      for (const im of s.images || []) {
        const d = typeof im === 'string' ? im : im && im.u;
        if (typeof d === 'string' && /^data:image\//.test(d))
          await c.query('insert into images(id,subject_id,data) values($1,$2,$3)', [crypto.randomUUID(), sid, d]);
      }
      for (const k of s.cards || []) {
        if (k.t && k.d) await c.query(
          'insert into cards(id,subject_id,term,definition,due,iv,ease) values($1,$2,$3,$4,$5,$6,$7)',
          [crypto.randomUUID(), sid, String(k.t).slice(0, 200), String(k.d).slice(0, 2000), +k.due || 0, +k.iv || 0, +k.ease || 2.5]);
      }
      n++;
    }
    await c.query('commit');
  } catch (e) { await c.query('rollback'); throw e; }
  finally { c.release(); }
  res.json({ imported: n });
}));

// ---------- errors ----------
app.use((e, _req, res, _next) => {
  const s = e.status || 500;
  if (s >= 500) console.error(e);
  res.status(s).json({ error: s >= 500 ? 'Server error' : e.message });
});

// ---------- schema + start ----------
const schema = `
create table if not exists subjects(
  id text primary key, emoji text not null default '📘', name text not null,
  notes text not null default '', created_at timestamptz not null default clock_timestamp());
create table if not exists videos(
  id text primary key, subject_id text not null references subjects(id) on delete cascade,
  title text not null, url text not null, created_at timestamptz not null default clock_timestamp());
create table if not exists images(
  id text primary key, subject_id text not null references subjects(id) on delete cascade,
  data text not null, created_at timestamptz not null default clock_timestamp());
create table if not exists cards(
  id text primary key, subject_id text not null references subjects(id) on delete cascade,
  term text not null, definition text not null,
  due double precision not null default 0, iv double precision not null default 0, ease double precision not null default 2.5,
  created_at timestamptz not null default clock_timestamp());
create index if not exists videos_subject on videos(subject_id);
create index if not exists images_subject on images(subject_id);
create index if not exists cards_subject on cards(subject_id);
`;
pool.query(schema)
  .then(() => app.listen(PORT, () => console.log('API listening on ' + PORT)))
  .catch(e => { console.error(e); process.exit(1); });
