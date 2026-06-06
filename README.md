# AdMatrix.ai

Drop a link to launch a global campaign. AdMatrix.ai is a multi-agent Showrunner that
automates localized video ads with Qwen3.6 (script + transcreation + compliance),
Wan2.7 actor continuity, and HappyHorse multi-lingual lip-sync.

## Quick start — standalone demo (no backend needed)

The frontend ships with a fully self-contained demo that simulates the entire
async pipeline client-side. You only need Node 18+.

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:3000 — it redirects to the dashboard. Paste any URL (or click a
sample chip), pick target locales, and hit **Generate ad** to watch the pipeline run:

`Ingest → Transcreate → Storyboard → (your approval) → Audio → Render → Lip-sync → Compliance → 9:16 ad`

The rendered ad preview plays scene-by-scene with a live language toggle.

## Full stack (FastAPI + Celery + Postgres + Redis)

```bash
cp .env.example .env        # add QWEN_API_KEY for real generation
docker compose up --build
```

- Frontend: http://localhost:3000
- API + docs: http://localhost:8000/docs

### Architecture

- **backend/** — FastAPI gateway, SQLAlchemy 2.0 async models, a typed state machine,
  Playwright/BeautifulSoup scraper, a LangGraph creative workflow (scripting →
  dual-pass transcreation → storyboard → human-in-the-loop approval), Celery
  audio-first video pipeline, token/budget telemetry middleware, and a
  compliance checker.
- **frontend/** — Next.js 14 App Router + TypeScript + Tailwind CSS.

MIT licensed.
