# Database Architecture

Status: **implemented through migration 0008.** Production still runs SQLite until the cutover in `docs/deployment/DEPLOYMENT_GUIDE.md`.

## 1. Layers

| Layer | Location | Responsibility |
| --- | --- | --- |
| Configuration | `app/config/settings.py` | Reads env (`APP_ENV`, `DATABASE_*`, `SUPABASE_*`, `FIELD_ENCRYPTION_*`). Blank = default. `validate_for_production()` blocks unsafe boots. |
| Engine / session | `app/database/database.py`, `session.py` | `normalize_database_url` (bare `postgresql://` -> `postgresql+psycopg://`), per-backend engine options, `get_db` dependency. |
| Models | `app/models/` | SQLAlchemy 2.x declarative models (unchanged for existing tables). |
| Services | `app/services/` | Business rules. New social/waiting-room code adds `app/repositories/` for non-trivial queries. |
| Schema versioning | `backend/alembic/` | Sole owner of the PostgreSQL schema. |

`init_db()` keeps the historical create-all + additive migrator for **SQLite only** (local dev and the existing test-suite). On PostgreSQL it only checks connectivity; the schema comes from `alembic upgrade head`.

## 2. Connections (Supabase + Render)

| Purpose | Variable | Endpoint | Notes |
| --- | --- | --- | --- |
| Running API | `DATABASE_URL` | Transaction pooler, port 6543 | `DATABASE_USE_POOLER=true` disables server-side prepared statements (PgBouncer transaction mode). Small pool (`DATABASE_POOL_SIZE`, default 5) because the pooler already multiplexes. |
| Alembic, data migration | `DATABASE_DIRECT_URL` | Session pooler (5432) or direct | DDL and long transactions must not use the transaction pooler. Supabase's direct host is IPv6-only unless the IPv4 add-on is on; Render egress is IPv4, so the session pooler is the expected choice. |
| Tests / local | blank | SQLite file | unchanged |

TLS: `DATABASE_SSL_MODE=require` by default; `verify-full` is recommended once the Supabase CA certificate is mounted. Production refuses `disable`.

The WebSocket route used to hold one pooled connection per live socket (audit V-04). It now returns the connection after every message, so idle sockets pin nothing; rooms of many sockets are safe under the pooler.

## 3. Types and conventions

- Timestamps: `UTCDateTime` is `TIMESTAMPTZ` on PostgreSQL and naive-UTC on SQLite; application code always sees aware UTC.
- Enums stay VARCHAR + CHECK (portable, easy to extend via migration).
- `settings` / `preferences` remain JSON text for now; converting to JSONB is a data-migrating revision done together with the data copy, not a silent change.
- Integer `users.id` is kept as the internal key; `clerk_id` is unique and is the only link to Clerk.
- New columns/tables only through reviewed Alembic revisions; never from user input.

## 4. Alembic

- `alembic/versions/0001_baseline_schema.py` reproduces the **current** schema (verified: upgrade, `alembic check` reports no drift, downgrade to base; PostgreSQL DDL rendered offline with `--sql`).
- Existing SQLite databases already have these tables: run `alembic stamp 0001` once instead of upgrading.
- Fresh PostgreSQL: `alembic upgrade head`.
- Commands (from `backend/`): `python -m alembic upgrade head`, `... revision --autogenerate -m "msg"`, `... downgrade -1`, `... check`.
- Not yet verified against a live PostgreSQL server (none available locally). That happens in Stage 2 against your Supabase project and in a Postgres CI job.

## 5. Schema (migrations 0001-0008)

| Revision | Content |
| --- | --- |
| 0001 | users, meetings, participants, meeting_history, invitations (legacy, unused), activity_events (unused) |
| 0002 | revoke Supabase `anon`/`authenticated` access |
| 0003 | `user_profiles` (1:1 with users; unique lowercase username; visibility; backfilled) |
| 0004 | `friend_requests` (partial unique index: one pending per pair), `friendships` (canonical pair), `user_blocks`, `notifications` (unique `dedupe_key`, expiry) |
| 0005 | `meeting_invitations` (unique per meeting+invitee) |
| 0006 | `meetings.waiting_room_enabled` (default false), `meetings.admission_mode`, `waiting_room_entries` (unique per meeting+user, state CHECK) |
| 0007 | partial unique index: one participant row per user per meeting |
| 0008 | role `meetly_app`, SECURITY DEFINER helpers, 33 RLS policies |

Conventions: integer `users.id` is the internal key; `clerk_id` is the only link to Clerk; timestamps are `TIMESTAMPTZ`; enumerations are VARCHAR + CHECK so new values need only a migration; flexible data (`social_links`, notification `payload`) is JSONB while relational facts stay relational. Identity does not depend on friendship, relationships do not depend on meetings, and notifications carry a type string plus an entity reference, so new features add rows and revisions rather than reshape these tables. The legacy `invitations` and `activity_events` tables are unused and untouched.

Row Level Security: see `SECURITY_ARCHITECTURE.md` (policies, how the user id reaches the database, tests, deliberate gaps).

## 6. Backup and recovery

See `docs/database/BACKUP_AND_RECOVERY.md` and `MIGRATION_GUIDE.md`. Until cutover, `backend/scripts/backup_db.py` remains the SQLite backup tool.
