# Rollback guide

Principle: **roll the code back freely, roll the database forward or restore it.** Schema downgrades are refused on staging and production (`app/database/target_guard.py`): they drop tables and data.

## Frontend (Vercel)

1. Vercel -> project -> **Deployments**, find the last good deployment -> **...** -> **Promote to Production** (or **Instant Rollback**). Takes effect immediately.
2. If the cause was an environment variable, fix it under Settings -> Environment Variables and **redeploy** (a variable change needs a new build).

## API (Render)

1. Render -> service -> **Events/Deploys** -> the last good deploy -> **Rollback**. Because migrations are additive, the previous code runs on the newer schema.
2. If the cause was an environment variable, correct it (Environment tab); the service restarts. To switch Row Level Security off instantly: set `DATABASE_RLS_ENFORCE=false`.
3. Active meetings drop and clients reconnect; rows left by the restart are reconciled by the sweeper after the grace period.

## Database

| Situation | Action |
| --- | --- |
| A new migration misbehaves | Ship a **corrective forward migration**. Do not downgrade. |
| Data was damaged | Restore the pre-migration backup into a **new** database (`docs/database/BACKUP_AND_RECOVERY.md`), verify it, then switch `DATABASE_URL`, `DATABASE_DIRECT_URL`, `DATABASE_EXPECTED_REF` and `SUPABASE_*` to the restored project. |
| Wrong environment variables pointed at the wrong project | The reference-ID guard stops the API from starting; correct the variables. No data is touched. |

## SQLite cutover (once it has happened)

Before the 30-day safety period ends: set `DATABASE_URL` back to the SQLite file and redeploy the legacy blueprint (`docs/deployment/legacy/render.sqlite.yaml`) with `ALLOW_SQLITE_IN_PRODUCTION=1`. The SQLite file and backups were never modified. Rows created in Supabase after the cutover are **not** copied back; export them first if that matters.

## Clerk

Switching Clerk instance changes every user's id. To undo a Clerk change, restore the previous keys in Vercel and Render (keep the old keys until the new setup is verified). Do not delete a Clerk instance that real users signed up on.

## Do not

- Run `alembic downgrade`, drop or truncate to "undo".
- Delete the old SQLite file or backups before the safety period ends.
- Revoke the previous credentials before the replacement has been verified (except when rotating a leaked secret, where you rotate first on purpose).
