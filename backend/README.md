# Meetly — Backend

FastAPI + SQLAlchemy 2.x backend for Meetly (PostgreSQL on Supabase in production, SQLite locally): REST for meetings, schedules, profiles, friends, invitations, notifications and the waiting room, plus WebSockets for room signaling and notification hints. See the [root README](../README.md) for setup and the [deployment guide](../docs/deployment/DEPLOYMENT_GUIDE.md) for going live.

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

With SQLite (no `DATABASE_URL`) the schema and the demo user are created automatically
on startup. PostgreSQL schemas are **never** created implicitly: run
`python -m alembic upgrade head` first (see below). The database file lives at
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

Copy `backend/.env.example` to `backend/.env` (gitignored). It is loaded
automatically at start-up; real environment variables take precedence. See the root
README for the full table. Nothing in `.env` may ever be committed or sent to the
browser.

## Database and migrations

Alembic owns the schema (`alembic/`, `alembic.ini`; the URL comes from
`DATABASE_DIRECT_URL`, falling back to `DATABASE_URL`).

```bash
python -m alembic upgrade head     # apply all revisions
python -m alembic current
python -m alembic check            # models and database agree
python -m alembic revision --autogenerate -m "describe change"
```

- Every change is a reviewed, additive revision. Do not hand-edit applied revisions.
- On SQLite an existing pre-Alembic database is adopted with `python -m alembic stamp 0001`
  (it already has the baseline tables); then `upgrade head` applies the rest.
- `alembic downgrade` is refused on non-SQLite databases (it drops tables) unless
  `ALEMBIC_ALLOW_DOWNGRADE=1` is set. Use a throwaway database for that.
- Moving data from SQLite: `scripts/migrate_sqlite_to_postgres.py` (read-only source,
  refuses a non-empty target, validates the copy). See `docs/database/MIGRATION_GUIDE.md`.
- Avatar bucket (once): `python scripts/setup_supabase_storage.py`.
- Encryption key: `python scripts/generate_encryption_key.py 1`.

## Tests

```bash
cd backend
pytest                    # whole backend suite
pytest tests/test_meetings.py -v
```

Tests use temporary SQLite databases; `tests/conftest.py` forces this even when
`backend/.env` points at Supabase, so tests never touch a configured database.
The Row Level Security tests (`tests/test_rls_postgres.py`) need a PostgreSQL and are
skipped unless `MEETLY_PG_TEST_URL` is set; they work in a throwaway schema.

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

All routes except `/health` require a Clerk token. The complete, current list is at
`/docs` and in the root README; groups: users and profiles (`/api/users/...`), people,
friends, blocks, notifications, invitations (`/api/...`), meetings, schedules,
participants, and the host-only waiting room
(`/api/meetings/{meeting_id}/waiting-room`).

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
- **Database:** PostgreSQL (Supabase) in production: transaction pooler for the app
  (`DATABASE_USE_POOLER=true`), session pooler for Alembic, TLS required. SQLite (WAL,
  10s busy timeout) is for local development and tests only. Run a single server
  process: live connections and rate limits are in memory.
- **Backups (SQLite):** `python scripts/backup_db.py backup` writes a consistent, integrity
  checked copy to `data/backups/` and never overwrites a file. Restore with
  `python scripts/backup_db.py restore <backup> <new path>`, stop the app, then
  swap the file in. Suggested: daily, keep 14, and always before a deploy that
  changes the schema. Delete a user's rows on request to honour data-removal asks.
- **Deploying:** see `docs/deployment/DEPLOYMENT_GUIDE.md` (Render, Vercel, Supabase, the
  SQLite-to-Supabase cutover and rollback). `render.yaml` stays on SQLite until you
  perform the cutover.
