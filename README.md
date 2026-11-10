# Greenlight

**Pre-publication brand governance.** Greenlight checks a draft against a company's approved brand rules and facts *before* it goes out, shows exactly why each phrase was flagged, and leaves the final decision to a person.

> "India's #1 fastest delivery, guaranteed." → **High · Unsupported claim.** Guideline G-4.2: no approved fact supports "#1". Suggested wording from approved fact F-12: *Fast delivery is available in select cities.*

Team Phoenix: Harshit Verma (frontend, lead) and Ruchir Bharadwaj (backend). The plan lives in [`PROJECT.md`](PROJECT.md) and the API contract in [`docs/API.md`](docs/API.md).

---

## What it does

1. A **creator** submits a draft.
2. Greenlight flags risky phrases. Every flag carries an exact quote, the approved source behind it, a reason, and a confidence level.
3. The creator **edits** the wording or **disputes** the flag with a written reason.
4. A **reviewer** approves the draft or sends it back with a note.

Principles that are enforced in code, not just promised:

- **No source, no finding.** Anything the verifier cannot tie to the draft text and to an approved source is dropped.
- **Unsupported is not false.** A claim with no evidence is flagged as unsupported, never declared untrue.
- **Only people approve.** The software cannot approve or publish.
- **AI use is disclosed.** Each review has a record of what was and was not sent to an AI service.

## Roles

| Role | Can do |
|---|---|
| Creator | Submit drafts, edit or dispute findings on their own reviews |
| Reviewer | Approve or request changes on reviews that reached `in_review` |
| Brand admin | Add Brand Kit sources, see guideline-gap insights |
| Manager | Read-only view of the whole workspace and insights |

## Architecture

```
 Browser  ──►  frontend (Next.js)  ──►  backend (FastAPI)  ──►  PostgreSQL + pgvector
                    │                         │
                    │                         └──►  Claude (optional judge step)
                    └── mock backend (sample data, no server needed)
```

Detection pipeline: `draft → split → rules → retrieve → judge → verify → score → findings`

- **rules**: deterministic checks (claims, terminology, tone, accessibility).
- **retrieve**: finds the most relevant approved sources using embeddings.
- **judge**: Claude assesses the subtler cases. Optional: without an API key the pipeline runs in *rules-only mode* and says so.
- **verify**: drops any finding whose quote is not at the stated position, whose source is not in the review's Brand Kit version, or whose suggestion invents a claim.

The frontend reads and writes only through `frontend/src/lib/api.ts`, which switches between the mock and the live API with one setting.

## Quick start

You need **Node.js 20+** and **Python 3.11+**.

### A. Frontend only (sample data, no backend)

```bash
cd frontend
npm install
npm run dev          # http://localhost:3000
```

Click **Start the guided demo** on the login screen, or pick a role. Data is stored in your browser, and a checklist walks you through every feature.

### B. Full stack on your machine (no database install needed)

Terminal 1, the backend:

```bash
cd backend
python -m venv .venv
source .venv/bin/activate            # Windows PowerShell: .venv\Scripts\Activate.ps1
pip install -r requirements.txt
python run_local.py                  # http://localhost:8000/docs
```

Terminal 2, the frontend, pointed at it. Create `frontend/.env.local`:

```
NEXT_PUBLIC_USE_MOCK=false
NEXT_PUBLIC_API_URL=http://localhost:8000
```

```bash
cd frontend
npm install
npm run dev
```

Sign in with a demo account (password `greenlight-demo`):

| Email | Role |
|---|---|
| `aarav@acme.com` | creator |
| `priya@acme.com` | reviewer |
| `ruchir@acme.com` | brand admin |
| `harshit@acme.com` | manager |

`run_local.py` uses a local SQLite file (`local_greenlight.db`) and creates the demo workspace on first run. Delete that file to start fresh. Restart the frontend after changing `.env.local`.

### C. Production stack (PostgreSQL with pgvector)

```bash
cd backend
pip install -r requirements-full.txt # adds sentence-transformers (large download)
cp .env.example .env                 # set DATABASE_URL, JWT_SECRET, ANTHROPIC_API_KEY
alembic upgrade head            # applies every migration in backend/alembic/versions
python -m app.seed
uvicorn app.main:app --port 8000
```

## Configuration

**Backend** (`backend/.env`)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | `postgresql://user:password@host:5432/greenlight` |
| `JWT_SECRET` | Long random string (32+ characters). Required to be changed when `APP_ENV=production`. |
| `ANTHROPIC_API_KEY` | Optional. Without it, rules-only mode. |
| `ALLOWED_ORIGIN` | The frontend's address, for example `https://your-app.vercel.app` |
| `APP_ENV` | `production` makes the server refuse the default secret |

**Frontend** (`frontend/.env.local`, or Vercel environment variables)

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_USE_MOCK` | `true` = demo only (sample data). `false` with an API URL = the login page offers **both** a real sign-in and the demo |
| `NEXT_PUBLIC_API_URL` | Backend address, without `/api/v1`. Must be `https://` in production. |

These are baked in at build time. On Vercel, change them and redeploy.

## Tests

```bash
cd backend
pip install -r requirements-dev.txt
pytest                                                    # SQLite, no setup
TEST_DATABASE_URL=postgresql://user:pw@localhost/greenlight_test pytest   # real PostgreSQL
```

75 tests cover the contract, permissions, state transitions, the pipeline and the verifier.

## Project layout

```
backend/
  app/routers/      HTTP endpoints (auth, reviews, findings, approvals, brand_kit, insights)
  app/pipeline/     split, rules, retrieve, judge, verify, score
  app/services/     workflow, activity (history, comments, versions), Brand Kit, insights, AI disclosure
  tests/
frontend/
  src/lib/          api.ts (mock/live switch), mockData.ts, session.ts
  src/features/     reviews, brand-kit, approvals, dashboard, insights, auth
  CONNECT_BACKEND.md
docs/API.md         the contract both sides build to
PROJECT.md          plan, roles, version roadmap
```

## Deploying

- **Frontend → Vercel.** Import the repo and set **Root Directory** to `frontend`. Works as-is in sample-data mode.
- **Backend → Vercel** (a second project from the same repo, Root Directory `backend`). Add a Postgres database from Vercel's Storage tab (Neon supports pgvector), set `JWT_SECRET` and `ALLOWED_ORIGIN`, deploy. On first start the app creates its tables and the demo workspace by itself. Details below.
- **Backend alternatives:** Render, Railway or Fly also work, with any PostgreSQL that supports pgvector.

### Backend on Vercel

1. New Project → import this repo → set **Root Directory** to `backend`. Vercel detects FastAPI from `requirements.txt` and `index.py`.
2. Storage tab → create a Postgres database (Neon) and connect it to this project. This adds `DATABASE_URL` (or `POSTGRES_URL`) automatically.
3. Environment variables: `JWT_SECRET` (random, 32+ characters; the app refuses to start without it) and `ALLOWED_ORIGIN` (your frontend's production URL, no trailing slash). `ANTHROPIC_API_KEY` is optional.
4. Deploy, then open `<backend-url>/health` and `<backend-url>/docs`.
5. In the frontend's Vercel project set `NEXT_PUBLIC_USE_MOCK=false` and `NEXT_PUBLIC_API_URL=<backend-url>`, then redeploy it.

Without a database attached, the backend falls back to a temporary SQLite file that resets, which is fine for a quick look but not for sharing. Embeddings use the built-in fallback on Vercel because `sentence-transformers` is too large for a serverless bundle.

## Status and known limits

Working: authentication and roles, the versioned Brand Kit, the full detection pipeline, the review workflow, a complete activity history with comments and draft version comparison, insights, per-review AI disclosure, and a frontend verified end to end against both the mock and the real backend.

Not yet done:

- Verified on PostgreSQL 16 with pgvector locally, but not yet on a live hosted Vercel/Neon deployment or against a live Claude key.
- No labelled test set, so detection precision is unmeasured.
- No endpoints to edit a draft directly, to delete a Brand Kit source, or to assign and escalate a review (planned).
- No signup or password reset. Users come from the seed script.
- No login rate limiting or error monitoring.
- Text only. Image and PDF checks are not built.

## Embeddings note

`sentence-transformers` (self-hosted, 384 dimensions) is used when installed. Otherwise a built-in hashing embedder keeps the service running at lower retrieval quality. Install it for real use. Similarity is computed in Python, which is fine for a Brand Kit of hundreds of sources.

## Don't commit

`.venv/`, `node_modules/`, `.next/`, `.env` and `.env.local` files, and `*.db` files. The provided `.gitignore` already covers them.
