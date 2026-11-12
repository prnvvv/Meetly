# SQLite -> Supabase migration guide

Status: the Supabase schema is at revision `0008` (13 Meetly tables, empty of production data). The data rehearsal **passed** on the development database; the production cutover has **not** been done and needs explicit approval. The full, ordered procedure with environment variables, rollback and smoke tests is in [`docs/deployment/DEPLOYMENT_GUIDE.md`](../deployment/DEPLOYMENT_GUIDE.md) (section 4).

## What exists
| Piece | Command / file |
| --- | --- |
| Schema | `cd backend && python -m alembic upgrade head` (uses `DATABASE_DIRECT_URL`) |
| Backup | `python scripts/backup_db.py backup` (online backup API, consistent while the app runs) |
| Data copy + validation | `python scripts/migrate_sqlite_to_postgres.py --source <backup.db>` |
| Rehearsal | add `--schema rehearsal --create-schema --drop-schema` (throwaway schema; `public` untouched) |

The copy script opens SQLite read-only, refuses a non-empty target, preserves primary keys, advances sequences, runs in one transaction, and rolls back if validation (row content, FK orphans, per-meeting participant counts) differs.

## Rehearsal result (2026-11-12, dev database copy)
Backup `zoom_clone-20261112-153850.db`, 94,208 bytes, `integrity_check` ok. users 2, meetings 4, meeting_history 2, participants 2, activity_events 0, invitations 0: all tables content-identical, 0 orphaned FKs. Rehearsal schema dropped; `public` has 0 rows.

## Things that matter for the production cutover
- **The target must be empty.** The copy script refuses a non-empty `public` schema. If Supabase was used for development, its rows must be cleared first (with approval and, if in doubt, a `pg_dump`).
- **The production file has not been seen.** Rehearse with a fresh backup downloaded from Render before the window, against a scratch schema (`--schema rehearsal --create-schema --drop-schema`).
- **Newer tables start empty.** Profiles, friendships, notifications, invitations and waiting-room entries do not exist in SQLite. Existing users get a generated profile (`user<id>`) when the migration revisions run, and from then on on first sign-in. Existing meetings get `waiting_room_enabled = false`.
- **Old accounts keep working** because users are matched by Clerk id; internal ids are preserved by the copy, and the identity sequences are advanced afterwards.
- **Adopting a SQLite database in place** (not needed for Supabase): `python -m alembic stamp 0001` then `python -m alembic upgrade head`. Verified on a copy of the development database: all rows preserved, integrity check ok.
- **Rollback** is pointing `DATABASE_URL` back at the untouched SQLite file.
- **Never run `alembic downgrade` against the configured database**; the tool now refuses unless `ALEMBIC_ALLOW_DOWNGRADE=1`.
