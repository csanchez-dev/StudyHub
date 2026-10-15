# BackendPath — Netlify (frontend) + Render (API + Postgres)

```
frontend/   static site (HTML/CSS/JS)  → Netlify
backend/    Express API + Postgres     → Render
render.yaml Render Blueprint (web service + database)
netlify.toml Netlify build config
```

## Deploy

Push this folder to a GitHub repo, then:

**1. Render (backend first)**
1. Render dashboard → New → Blueprint → select the repo (it reads `render.yaml`).
2. When prompted, set `APP_PASSWORD` (your login password) and `FRONTEND_URL` (any placeholder, e.g. `https://example.netlify.app`). `JWT_SECRET` and `DATABASE_URL` are filled in automatically.
3. After deploy, copy the API URL, e.g. `https://backendpath-api.onrender.com`. Check `<url>/health` returns `{"ok":true}`.

**2. Netlify (frontend)**
1. Add new site → Import from Git → select the repo (settings are read from `netlify.toml`).
2. Site settings → Environment variables → add `API_URL` = your Render URL (no trailing slash), then deploy.
3. Copy your Netlify URL, e.g. `https://your-site.netlify.app`.

**3. Close the loop**
Back in Render → backendpath-api → Environment → set `FRONTEND_URL` to your Netlify URL (no trailing slash; comma-separate several) and let it redeploy. This enables CORS for your site.

Open the Netlify site and sign in with `APP_PASSWORD`.

## Run locally
```bash
# backend (Node 20+, local Postgres)
cd backend && cp .env.example .env   # edit values
npm install && npm run dev           # http://localhost:3000

# frontend (config.js already points to localhost:3000)
cd frontend && python3 -m http.server 8080
```

## API (all under /api, JWT required except login)
`POST /login` · `GET|POST /subjects` · `PATCH|DELETE /subjects/:id` · `POST /subjects/:id/{videos,images,cards}` · `PATCH /cards/:id` · `DELETE /{videos,images,cards}/:id` · `POST /import`

## Notes
- Free Render services sleep when idle, so the first request after a pause can take about a minute (the app shows a loading message).
- Free Render Postgres has limits (it has historically expired after a period); check Render's current free-tier terms and upgrade or point `DATABASE_URL` at another Postgres (Neon, Supabase) if you want long-term storage.
- Images are stored in Postgres as resized JPEG data URLs and returned with the subject list: fine for personal use, but move them to object storage if you add many.
- Moving data from the earlier browser-only version: Export there, then use Import here.
