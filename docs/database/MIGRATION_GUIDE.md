# SQLite -> Supabase migration guide

Status: schema applied to the Supabase project (empty, `alembic` at `0002`).
Data rehearsal **passed**; the production cutover has **not** been done and needs explicit approval.

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

## Production cutover (manual, requires approval)
1. Announce a short maintenance window. On Render, take a backup: shell into the service and run `python scripts/backup_db.py backup`, download the file. Record size + SHA-256.
2. Stop writes (scale to 0 or suspend). Take the final backup again.
3. Locally: `python scripts/migrate_sqlite_to_postgres.py --source <final-backup.db>`; require `VALIDATION PASSED`.
4. In Render set `DATABASE_URL` (transaction pooler), `DATABASE_USE_POOLER=true`, `DATABASE_DIRECT_URL`, `APP_ENV=production`, `CLERK_AUTHORIZED_PARTIES`, `FIELD_ENCRYPTION_KEYS`, `SUPABASE_*`. Deploy and check `/health`, sign in, create/join a meeting.
5. **Rollback:** set `DATABASE_URL` back to `sqlite:////var/data/meetly.db` and redeploy. The SQLite file and backups stay untouched on the disk; do not delete them until the new database is verified and a retention period is agreed.

Note: users created on the old database keep their `clerk_id`, so sign-in maps to the same rows after cutover.
