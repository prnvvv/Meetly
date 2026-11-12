# Database migration: fresh schema, validation and the SQLite cutover

Everything here is **additive** and guarded. Nothing in this repository runs a downgrade, a reset or a truncate against a shared database, and nothing has been run against a production database.

## A. Fresh schema on a new Supabase project (staging, then production)

Prerequisites: the project exists (`SUPABASE_SETUP.md`), `backend/.env.<env>` is filled in, you are in `backend/`.

```bash
export MEETLY_ENV_FILE=.env.staging            # or .env.production
export MEETLY_CONFIRM_DB=<that project's Reference ID>

# 1. See what will run (no changes):
python -m alembic upgrade head --sql | less
# 2. Apply. The command prints "Target: ..." first; stop if that is not the project you mean.
python -m alembic upgrade head
# 3. Validate:
python -m alembic current                      # 0011 (head)
python -m alembic check                        # "No new upgrade operations detected."
PYTHONPATH=. python scripts/audit_rls.py       # RESULT: PASSED
python scripts/setup_supabase_storage.py       # private avatars bucket
curl https://<api>/health/ready                # "schema": true
```

What the revisions create (all in `backend/alembic/versions/`): 0001 baseline tables, 0002 locks `anon`/`authenticated` out, 0003 profiles, 0004 friends/blocks/notifications, 0005 meeting invitations, 0006 waiting room, 0007 one participant row per user and meeting, 0008 Row Level Security and the `meetly_app` role, 0009 email-encryption columns, 0010 rate-limit counters, 0011 least-privilege grants. No extension beyond what Supabase provides is required.

The CI job *Backend on PostgreSQL* applies the whole chain to an empty PostgreSQL 17 (`upgrade head`, `check`, then a reversibility test on a **throwaway** CI database only) and runs the RLS tests against the real `meetly_app` role. That is the automated validation procedure; the commands above are the manual one for your projects.

Rules: apply staging before production; never edit an applied revision; removal of anything is a two-step change with explicit approval; a lint test fails any `DROP`/`DELETE`/`TRUNCATE` in an upgrade.

## B. SQLite to Supabase cutover (production data)

**Status: NOT STARTED. The fresh production SQLite backup has not been provided, so nothing below has been run against real data, and no production record has been seen or invented.**

When you provide the backup (a copy of `/var/data/meetly.db` taken with `python scripts/backup_db.py backup` on Render, plus its SHA-256), the sequence is:

1. **Inspect**: schema (`sqlite3 <file> ".schema"`), row counts, `PRAGMA integrity_check` (must print `ok`), `PRAGMA foreign_key_check`. Compare with `docs/database/SQLITE_TO_POSTGRES_MAPPING.md` (table and column map, type conversions: SQLite text datetimes to `timestamptz` in UTC, integers 0/1 to booleans, enums to their string values).
2. **Report incompatibilities**: duplicate emails or Clerk ids, orphaned foreign keys, impossible dates, participants violating the one-row-per-user rule (0007), values over column lengths. The copy script reports each and refuses to continue on an unresolvable one; it never silently drops a row.
3. **Rehearse on a disposable database** (never on the real target):
   ```bash
   python scripts/migrate_sqlite_to_postgres.py --source <backup.db> --schema rehearsal --create-schema --drop-schema
   ```
   `--drop-schema` removes only the scratch schema `rehearsal` it just created. Required ending: `VALIDATION PASSED` (row counts per table, content comparison of every row, foreign keys, participant counts; one transaction, all or nothing).
4. **Migration report**: counts per table (source/target), the incompatibilities found and how each was handled, validation output, time taken. Saved under `docs/database/` for you to read.
5. **Your approval** is required before step 6. Nothing proceeds without it.
6. **Cutover** (maintenance window): suspend the Render service, take the final backup, run the copy into the **empty** production schema (`DATABASE_DIRECT_URL`, `MEETLY_CONFIRM_DB=<prod ref>`; the script refuses a non-empty target), require `VALIDATION PASSED`, deploy the new blueprint, run `DEPLOYMENT_VERIFICATION.md`. Keep the SQLite file untouched for at least 30 days.

The production Supabase project stays **empty** until step 6 is approved.

## C. Existing Clerk users after the cutover

Rows are matched by Clerk id (`users.clerk_id`), so each person's existing account is picked up at their next sign-in. Users created in Clerk but never present in SQLite get a new row on first sign-in.

## Do not

- Run `alembic downgrade`, `DROP`, `TRUNCATE` or a "reset" on staging or production.
- Run the copy against a non-empty database, or against production before the rehearsal report is approved.
- Skip the backup, or the `MEETLY_CONFIRM_DB` confirmation.
