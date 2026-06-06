# AdMatrix.ai — Handoff / What's Left to Build

> Status as of 2026-06-06. This doc describes what is **done**, what is **stubbed**, and
> what a teammate needs to do to take it to a real working product. Read this before you
> start so you don't redo finished work.

---

## TL;DR

- **Frontend** = polished standalone **demo** (Tailwind, clean light SaaS). It runs with
  `npm run dev`, no backend. The pipeline you see is **simulated in the browser** — it does
  **not** call the API.
- **Backend** = real FastAPI app, real DB models, real Celery pipeline wiring, real state
  machine. Imports cleanly, 6/6 unit tests pass, 14 endpoints serve. **But** every actual
  AI step (LLM transcreation, TTS, video, lip-sync, compliance vision) is a **deterministic
  placeholder** — no real Qwen/Wan2.7/HappyHorse calls happen yet.
- Nobody has booted the **full stack** (Postgres + Redis + Celery + API together) end-to-end.

So: the **skeleton and plumbing are done**; the **AI brains and the frontend↔backend
connection are not**.

---

## ✅ What is actually done & verified

| Area | State |
|---|---|
| Frontend UI | ✅ Tailwind clean light SaaS, animated pipeline, storyboard approval, 9:16 player, locale toggle |
| Frontend build | ✅ `npm run build` passes, `/dashboard` serves HTTP 200 |
| Backend imports | ✅ `app.main` loads, 19 routes |
| Backend unit tests | ✅ 6/6 pass (`pytest`) — covers state machine + URL signing only |
| API surface | ✅ 14 endpoints documented in `/openapi.json` |
| Demo-mode ingest | ✅ `POST /api/v1/ingest` returns 200 without a DB |
| DB models | ✅ SQLAlchemy 2.0: CompanyProduct, Campaign, VideoStoryboard, VideoRenderTask + telemetry |
| State machine | ✅ Typed transitions with 409 on invalid transition |
| Celery pipeline wiring | ✅ audio → video → lip-sync → stitch chain exists and runs (with placeholder media) |
| Docker images | ✅ Backend Dockerfile (python:3.12-slim + **ffmpeg**), frontend Dockerfile, compose file |
| ffmpeg media generation | ✅ Produces real `.mp4`/`.wav` files — but they are **slates/silence**, not AI output |

---

## ❌ What is missing / stubbed (the real work)

### 1. Frontend is NOT connected to the backend  🔴 *high priority*
The current `frontend/src/app/dashboard/page.tsx` is a **self-contained simulation**
(`frontend/src/lib/demo.ts`). It was built this way so it always demos cleanly.
An earlier version had real `fetch()` calls to the API — that wiring was replaced.

**To do:** add a "live" mode that calls the real endpoints:
`POST /api/v1/ingest` → `POST /api/v1/campaigns` → `POST /campaigns/{id}/script`
→ poll `GET /campaigns/{id}` + `/storyboard` → `POST /approve` → `POST /render`
→ poll `/render` → `GET /video-url`. Gate it behind `NEXT_PUBLIC_DEMO_MODE`.

### 2. Real AI integrations (all placeholders today)  🔴 *high priority*
| Step | File | Current behavior | Needs |
|---|---|---|---|
| Brand-book extraction | `backend/app/services/scraper.py` | Real Qwen call path exists, but **falls back to heuristics** with no key (`_fallback_brand_book`) | Verify the Qwen JSON-extraction path with a real key |
| Transcreation | `backend/app/agents/script_workflow.py:103` | `[locale] narration` + naive `.replace()` — **not real translation** | Wire real Qwen dual-pass translation/idiom adaptation |
| TTS audio | `backend/app/tasks/video_pipeline.py:53` | Generates **silent WAV** via ffmpeg | Wire Qwen/CosyVoice TTS; keep duration-locking logic |
| I2V video | `backend/app/tasks/video_pipeline.py:116` | Solid-color slate with "Scene N" text | Wire Wan2.7 / HappyHorse I2V with the character-token continuity |
| Lip-sync | `backend/app/tasks/video_pipeline.py:140` | ffmpeg passthrough | Wire HappyHorse audio-visual sync |
| Compliance | `backend/app/middleware/compliance.py:141` | Hash-based **mock** score | Wire real Qwen vision/safety scoring |

### 3. Full-stack run never verified end-to-end  🟠
- Requires **PostgreSQL + Redis** up. `init_db()` connects to Postgres on startup.
- **Docker Desktop daemon was not running** on the dev machine, so `docker compose up`
  was never executed. First teammate with Docker should run it and confirm the chain.

### 4. Scraper can't render JS-heavy pages  🟠
- Uses `httpx` + BeautifulSoup, **not Playwright** (despite the original spec). SPA / JS-rendered
  product pages (lots of modern e-commerce) won't scrape. Add Playwright if needed.

### 5. Alembic migrations unverified  🟡
- `backend/alembic/` exists, but the app uses `Base.metadata.create_all()` at startup.
- Generate + test a real initial migration (`alembic revision --autogenerate`) before prod.

### 6. Thin test coverage  🟡
- Only `test_signing.py` + `test_state_machine.py`. No router, workflow, scraper, or
  pipeline tests, and no integration test against a live DB.

### 7. Auth / security hardening  🟡
- `API_KEY` is optional; if unset, all endpoints are public. Video URL signing depends on
  `VIDEO_SIGNING_SECRET`/`API_KEY`. Set these for any non-local deployment.

---

## ⚠️ Environment gotchas (read before you `pip install`)

- **Do NOT use Python 3.14.** The pinned deps have no 3.14 wheels and the dev machine's
  Application Control policy blocks compiling from source. **Use Python 3.12** (or Docker,
  which uses 3.12-slim). A working 3.12 venv lives at `backend/.venv` (gitignored).
- DB is **Postgres-only** (models use JSONB). No SQLite fallback driver is installed.
- The video pipeline shells out to **ffmpeg**; it's in the Docker image but you need it on
  PATH for local (non-Docker) worker runs.

---

## How to run today

**Standalone frontend demo (no backend):**
```bash
cd frontend && npm install && npm run dev   # http://localhost:3000
```

**Backend (Python 3.12):**
```bash
cd backend
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --only-binary=:all: -r requirements.txt
.\.venv\Scripts\python.exe -m pytest          # 6/6 pass
```

**Full stack (needs Docker Desktop running):**
```bash
cp .env.example .env     # add QWEN_API_KEY for real generation
docker compose up --build
# API docs: http://localhost:8000/docs
```

---

## Suggested order of work for the next person

1. `docker compose up --build` — confirm the whole stack boots and the placeholder pipeline
   produces an MP4 end-to-end. (Proves plumbing.)
2. Wire **real Qwen** transcreation + brand extraction (items 2a, 2b). Cheapest, highest impact.
3. Connect the **frontend live mode** to the API (item 1) so you can drive a real campaign.
4. Wire **TTS**, then **Wan2.7/HappyHorse** video + lip-sync (items 2c–2e).
5. Real **compliance** scoring (item 2f).
6. Migrations, tests, auth hardening (items 5–7).
