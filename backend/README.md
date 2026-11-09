# Meetly — Backend

FastAPI + SQLAlchemy 2.x + SQLite backend for Meetly: REST for meetings and schedules, and a WebSocket for room signaling. See the [root README](../README.md) for setup.

## Requirements

- Python 3.10+
- Dependencies: `pip install -r requirements.txt`

`requirements.txt` is the single source of truth for backend dependencies and is
what CI installs. Do not duplicate the list in `pyproject.toml`.

## Run

```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

The SQLite schema and the demo user are created automatically on startup, so a
fresh database needs no extra step. The database file lives at
`backend/data/zoom_clone.db`; relative `DATABASE_URL` paths are resolved against
`backend/`, so the location does not depend on the working directory.

Interactive API docs: <http://localhost:8000/docs>

## Seed sample data (optional)

```bash
cd backend
python -m app.seed.seed_data
```

Idempotent: repeat runs create no duplicates. Inserts the demo user plus a small
deterministic set of meetings (one ended with attendees, one live, one scheduled).

## Environment

Copy `backend/.env.example` and export the values; see that file for the
supported variables (`DATABASE_URL`, `FRONTEND_URL`, `STUN_SERVER`, `APP_NAME`).

## Tests

```bash
cd backend
pytest                    # whole backend suite
pytest tests/test_meetings.py -v
```

Tests use their own temporary SQLite databases and never touch
`backend/data/zoom_clone.db`.

## Layout

```text
app/
├── config/        settings (Frontend Developer 2)
├── database/      engine, declarative Base, session factory
├── models/        SQLAlchemy models
├── schemas/       Pydantic request/response models
├── routers/       REST endpoints (thin: validate -> service -> HTTP)
├── services/      business logic
├── utils/         meeting-id generation, validation, timezone helpers
├── websocket/     realtime signaling (Frontend Developer 2)
├── seed/          idempotent development seed
└── main.py        application factory, CORS, startup
```

## REST API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/users/me` | current (demo) user |
| POST | `/api/meetings` | create an instant, active meeting |
| GET | `/api/meetings/{meeting_id}` | meeting details |
| POST | `/api/meetings/{meeting_id}/join` | join validation |
| DELETE | `/api/meetings/{meeting_id}` | end or cancel a meeting |
| POST | `/api/schedules` | schedule a future meeting |
| GET | `/api/schedules/upcoming` | scheduled meetings, soonest first |
| GET | `/api/schedules/recent` | finished/live meetings, newest first |
| GET | `/api/meetings/{meeting_id}/participants` | participants of a meeting |
| POST | `/api/meetings/{meeting_id}/participants` | add a participant |
| DELETE | `/api/participants/{participant_id}` | mark a participant as left |

`{meeting_id}` is always the **public** nine-digit id, never the internal
primary key.

## WebSocket

`WS /ws/meetings/{meeting_id}` for signaling and participant state. Media is
peer-to-peer via WebRTC; audio/video never passes through FastAPI.

## Authentication, persistence and deployment

- **Auth:** every REST route (except `/health`) and every WebSocket `join` needs a
  Clerk session token. The API verifies its RS256 signature against Clerk's JWKS,
  checks issuer and expiry, and maps `sub` to a `users` row (`users.clerk_id`).
  Host status is decided from `meetings.host_id`, never from the client.
  `AUTH_MODE=demo` (tests, local experiments) bypasses this and must not be used
  in production.
- **Database:** SQLite in WAL mode with a 10s busy timeout. Schema changes to an
  existing database are additive only (`app/database/migrations.py`); nothing is
  dropped or rewritten. Run a single server process.
- **Backups:** `python scripts/backup_db.py backup` writes a consistent, integrity
  checked copy to `data/backups/` and never overwrites a file. Restore with
  `python scripts/backup_db.py restore <backup> <new path>`, stop the app, then
  swap the file in. Suggested: daily, keep 14, and always before a deploy that
  changes the schema. Delete a user's rows on request to honour data-removal asks.
- **Render + Vercel:** `render.yaml` deploys the API with a persistent disk at
  `/var/data` (paid instance types only). Set `CLERK_PUBLISHABLE_KEY`,
  `FRONTEND_URL` and `CLERK_AUTHORIZED_PARTIES` in the Render dashboard. On Vercel
  set `NEXT_PUBLIC_API_URL=https://<your-api>.onrender.com`; the frontend derives
  `wss://` from it. Only the exact Vercel origin should be in `FRONTEND_URL`.
