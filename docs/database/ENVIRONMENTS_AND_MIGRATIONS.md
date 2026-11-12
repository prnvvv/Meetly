# Environments and the migration procedure

## Three environments, three databases
| | Development | Staging | Production |
| --- | --- | --- | --- |
| Supabase project | its own (today: ref `bcdyuoqigjqmvkujobyl`) | its own | its own |
| Clerk instance | development (`pk_test_` / `sk_test_`) | a second development instance, or the same dev instance with separate test users | **production** instance (`pk_live_` / `sk_live_`) |
| Backend env file | `backend/.env` | `backend/.env.staging` | Render environment variables (or `backend/.env.production` for operator commands) |
| `APP_ENV` / `DATABASE_TARGET_ENV` | `local` / `development` | `staging` / `staging` | `production` / `production` |
| May be reset / downgraded | yes (`ALEMBIC_ALLOW_DOWNGRADE=1`, development only) | **never** | **never** |
| Holds | test accounts and throw-away data | rehearsal copies of production data and test accounts | real users |
| Frontend | local | its own Vercel preview/project pointing at the staging API | the production Vercel project |

Templates: `backend/.env.development.example`, `.env.staging.example`, `.env.production.example`. Run any command against another environment with `MEETLY_ENV_FILE=.env.staging` so you never edit `.env` to switch. The real files are gitignored.

### Setting up staging and production (your action)
1. Supabase Dashboard -> New project, twice (`meetly-staging`, `meetly-production`). Free accounts allow two active projects; production needs a paid plan for backups.
2. For each: copy the **Reference ID** (Settings -> General) into `DATABASE_EXPECTED_REF`, the pooler strings from **Connect** into `DATABASE_URL` / `DATABASE_DIRECT_URL`, the project URL and secret key into `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`.
3. Create the schema and bucket with `MEETLY_CONFIRM_DB=<ref>` (see below).
4. Clerk: keep a separate instance (or at least separate test users) for staging; production uses the production instance with its own keys.

## Why the guard exists
`DATABASE_EXPECTED_REF` ties a configuration to one project; a connection string for any other project is refused by the API, Alembic and the data-migration script. `DATABASE_TARGET_ENV` must agree with `APP_ENV`, so a local checkout cannot be pointed at production by accident. On staging and production every schema or data command also needs `MEETLY_CONFIRM_DB=<ref>` typed for that run. See `app/database/target_guard.py` and `INCIDENT_2026-11-12_SUPABASE_DEV_WIPE.md`.

## Migration procedure
**Schema migrations** (Alembic, `backend/alembic/versions/`) change structure and are additive. **Data migrations** (`backend/scripts/`) move or transform rows. They are separate on purpose: a revision never copies or rewrites production data except an explicit, named backfill, and a data script never changes the schema.

Rules for a new revision
1. Autogenerate, then read and edit it. Keep it additive (new tables, nullable or defaulted columns, new indexes).
2. `upgrade()` must not drop tables or columns, truncate, or delete rows. The lint test (`tests/test_database_safety.py`) fails otherwise; removing something is a **two-step** change: first stop using it and migrate its data, then (separate revision, explicit approval, `# destructive-approved: <reason>` line) remove it.
3. Test on SQLite (`alembic upgrade head`, `alembic check`) and on a scratch PostgreSQL schema (`tests/test_rls_postgres.py` pattern).
4. Never edit an applied revision; add a new one.

Applying (always in this order, each environment only after the previous one succeeded)
```bash
# development
python -m alembic upgrade head && python -m alembic check
# staging
MEETLY_ENV_FILE=.env.staging MEETLY_CONFIRM_DB=<staging-ref> python -m alembic upgrade head
# production (maintenance window, after a verified backup)
MEETLY_ENV_FILE=.env.production MEETLY_CONFIRM_DB=<prod-ref> python -m alembic upgrade head
```
Before any staging/production upgrade: take a backup (`BACKUP_AND_RECOVERY.md`), read `alembic upgrade head --sql` for the revisions about to run, and confirm the printed target (`Target: ...`) is the project you mean.

Rollback is **forward-fix or restore**: restore the pre-migration backup into a new database, or ship a new corrective revision. `alembic downgrade` is not a rollback tool for shared databases and is refused there.

## Data migrations
`scripts/migrate_sqlite_to_postgres.py` (read-only source, refuses a non-empty target, one transaction, validates counts/content/foreign keys, prints the target it is about to write to) is the model for any future data script. See `MIGRATION_GUIDE.md` and `DEPLOYMENT_GUIDE.md`.
