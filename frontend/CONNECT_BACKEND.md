# Connecting the frontend to the backend

The frontend is finished against the API contract (`../docs/API.md`, `src/types/contract.ts`).
Every screen reads and writes through `src/lib/api.ts`. That file switches between the built-in
mock backend and the live API, so connecting is configuration, not code.

## Connect in three steps

1. Start the backend (`../backend`): Postgres with pgvector, `alembic upgrade head`, `python -m app.seed`, `uvicorn app.main:app`.
2. In `frontend/.env.local` set:
   ```
   NEXT_PUBLIC_USE_MOCK=false
   NEXT_PUBLIC_API_URL=http://localhost:8000
   ```
3. On the backend set `ALLOWED_ORIGIN` to the frontend URL (for example `http://localhost:3000`), then `npm run dev`.

With these two settings the login page shows a real sign-in for registered users **and** a "Start the guided demo" option. The demo uses built-in sample data in the visitor's browser; the live sign-in uses your backend. They never share data. The top bar shows **Demo** or **Live** so nobody mistakes one for the other. In the demo a role menu lets visitors switch between Creator, Reviewer, Brand admin and Manager, and a guided checklist walks them through the whole workflow.

## Already verified

The same end-to-end script passes against the mock backend and the real backend:
log in as a creator, submit a draft, resolve every finding, then as a reviewer approve it,
then as a brand admin add a term and read insights. It also checks that a creator cannot approve
and that requesting changes without a note is rejected.

## Where things live

| Concern | File |
| --- | --- |
| Endpoint calls, 401 handling, mock/live switch | `src/lib/api.ts` |
| Mock backend (same rules as the server) | `src/lib/mockData.ts` |
| Sign-in, role permissions | `src/lib/session.ts` |
| Contract <-> screen models | `src/features/reviews/lib/adapters.ts` |
| Reviews data layer | `src/features/reviews/lib/store.ts` |
| Brand Kit data layer | `src/features/brand-kit/store.ts` |

## Known gaps that need a backend endpoint

- `PATCH /reviews/{id}/content`, a reopen action and `DELETE /brand-kit/sources/{id}` are not in the contract, so those controls are not shown.
- Assign and escalate (planned, v6.2) and image or structured inputs (planned, v8) are not in the contract yet.

History, comments and draft versions are read from the server (`/reviews/{id}/activity`, `/comments`, `/versions`, and `/activity` for the workspace-wide trail).
