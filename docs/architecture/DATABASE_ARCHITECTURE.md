# Database Architecture

Status: **Stage 1 design (implemented foundation, no production connection yet).**

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

Known prerequisite before cutover (audit V-04): the WebSocket route currently keeps one DB session for the lifetime of each socket. Under a pooler this must become short per-operation sessions. This is scheduled before the Stage 2 cutover, not after.

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

## 5. Planned schema (additive revisions, Stages 3-6)

```
users (existing)            1──1  user_profiles(user_id PK/FK, username UNIQUE lower(), display_name,
                                   avatar_path, bio, location, designation, organization, website,
                                   social_links JSONB, visibility, created_at, updated_at)
users ──< friend_requests(id, sender_id, receiver_id, status, created_at, updated_at, responded_at)
         partial UNIQUE (least(sender,receiver), greatest(sender,receiver)) WHERE status='PENDING'
users ──< friendships(id, user_low_id, user_high_id, created_at)  CHECK low<high, UNIQUE(low,high)
users ──< user_blocks(id, blocker_id, blocked_id, created_at)     UNIQUE(blocker,blocked), CHECK blocker<>blocked
users ──< notifications(id, recipient_id, type, entity_type, entity_id, payload JSONB,
                        read_at, expires_at, dedupe_key UNIQUE, created_at)
meetings ──< meeting_invitations(id, meeting_id, inviter_id, invitee_user_id, status, expires_at, created_at)
         UNIQUE(meeting_id, invitee_user_id)   (replaces the unused `invitations` table)
meetings += waiting_room_enabled BOOLEAN NOT NULL DEFAULT false, admission_mode VARCHAR(24) NOT NULL DEFAULT 'host_approval'
meetings ──< waiting_room_entries(id, meeting_id, user_id, participant_id, state, decided_by, requested_at,
                                  decided_at, updated_at)  UNIQUE(meeting_id,user_id), CHECK state IN (...)
participants += UNIQUE(meeting_id, user_id) WHERE user_id IS NOT NULL   (fixes audit V-06)
```

Identity is independent of friendship, relationships are independent of meetings, and notifications carry a type string plus entity reference, so new features add rows and revisions rather than reshape these tables.

## 6. Backup and recovery

Documented in `docs/database/BACKUP_AND_RECOVERY.md` and `MIGRATION_GUIDE.md` during Stage 2/8. Until cutover, `backend/scripts/backup_db.py` remains the SQLite backup tool.
