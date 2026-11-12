# Incident report: Supabase development database wiped (2026-11-12)

Status: **investigated; no recoverable user data identified; safeguards added.** Written from evidence, not from the earlier summary. Items marked *unverified* could not be checked from the repository or the database and need you.

## What happened
During hardening work, a command intended to exercise the migration chain inside a throwaway schema was run as `alembic downgrade base`. The connection string carried a `search_path` option that Supabase's pooler **ignored**, so Alembic executed against the `public` schema of the configured project. Every downgrade step ran (`0008 -> ... -> base`), which dropped all Meetly tables and their rows. The schema was then rebuilt with `alembic upgrade head` (revisions 0001 to 0008, 33 policies, RLS on every table).

## Which database
| Question | Answer | Evidence |
| --- | --- | --- |
| Which project | Supabase project ref `bcdyuoqigjqmvkujobyl` | `backend/.env` (`DATABASE_DIRECT_URL`, `SUPABASE_URL`) and the live connection both resolve to this ref |
| Development, staging or production? | **It was the only project configured, and it was used as the development database.** No staging or production project exists in the repository configuration. | `render.yaml` still sets `DATABASE_URL=sqlite:////var/data/meetly.db`; no Supabase connection string is committed |
| Was production connected? | **No evidence it was.** Production runs on Render with SQLite on its own disk. | Same `render.yaml`. *Unverified:* open Render -> your API service -> Environment and confirm `DATABASE_URL` is still the SQLite path and that no `DATABASE_URL` Supabase string was ever pasted there. |

## Tables affected
All 13 application tables (`users`, `user_profiles`, `meetings`, `participants`, `meeting_history`, `friend_requests`, `friendships`, `user_blocks`, `notifications`, `meeting_invitations`, `waiting_room_entries`, `invitations`, `activity_events`), plus `alembic_version`. Not affected: the `meetly_app` database role (cluster-level), Supabase Storage (the `avatars` bucket holds 0 objects, so no avatar was lost), and Clerk (accounts live in Clerk, not here).

## What data was lost
Supabase keeps query statistics in `pg_stat_statements` (since the server started at 09:15 UTC on 2026-11-12). They do not store values, but they do count every INSERT/UPDATE/DELETE statement. Read-only inspection shows:

| Statement | Count | Explanation |
| --- | --- | --- |
| `INSERT INTO users` | 10 | 8 are throw-away probe accounts created and deleted by my own verification scripts; 2 are your real account (created once before the wipe, once again when you signed in afterwards) |
| `INSERT INTO meetings` | 2 | both are my probe meetings |
| `INSERT INTO friend_requests` / `friendships` | 2 / 2 | my probe flows |
| `INSERT INTO meeting_invitations`, `user_blocks`, `waiting_room_entries` | 1 / 1 / 1 | my probe flows |
| `INSERT INTO notifications` | 6 | my probe flows |
| `UPDATE user_profiles SET show_meeting_stats` | 1 | **the only statement that matches an action you took in the UI** (the "show my meeting statistics" switch) |

Conclusion, with the honest limit that this is statistical evidence, not a row-level record: the rows destroyed were your auto-created account row and profile (the account is re-created on sign-in; Clerk was untouched), one privacy-switch setting, and my own test data. No meeting, friendship, invitation or notification created by a real user is indicated. If you remember creating meetings, friends or invitations in that database, tell me and I will re-check.

## Recovery options
- **Backups / point-in-time recovery:** the server reports `archive_mode = on` (WAL archiving), but whether a backup or PITR window exists depends on your Supabase plan and **I cannot see it**. *Unverified:* open Dashboard -> Database -> **Backups**. If a backup or PITR exists from before the incident, you can restore it into a **new** project (do not restore over the current one). Free projects usually have none.
- **Restoring from our own copies:** the SQLite copies in `backend/data/backups/` predate Supabase and hold the old local data (2 users, 4 meetings); they are not the Supabase data and were not copied back.
- **Given the evidence above, a restore is not needed to recover real data.** The only user-visible effect is that the account has a new internal id and default profile settings.

## Safeguards added (all with tests)
1. **Database identity guard** (`app/database/target_guard.py`): every environment is bound to one Supabase project ref (`DATABASE_EXPECTED_REF`) and one role (`DATABASE_TARGET_ENV` = development / staging / production). The API, Alembic and the data-migration script refuse a database that does not match, and refuse to mix `APP_ENV` with the wrong database.
2. **Explicit confirmation:** any Alembic or data-migration command against staging or production needs `MEETLY_CONFIRM_DB=<ref>` for that one command.
3. **Downgrades:** refused on staging and production unconditionally; on development only with `ALEMBIC_ALLOW_DOWNGRADE=1`.
4. **Production start-up guard:** the API will not start in production without the expected ref and `DATABASE_TARGET_ENV=production`.
5. **Migration lint:** a test fails the build if any revision's `upgrade()` contains DROP TABLE/COLUMN, TRUNCATE, DELETE FROM or `op.drop_*`, unless a reviewer adds a `destructive-approved:` line.
6. **Test isolation:** the PostgreSQL security tests refuse to run against a non-development Supabase database.
7. **Process rule:** destructive or "just to verify" commands are never run against the configured database; they use SQLite or an explicit per-test scratch schema, and the target is confirmed first.

What is still your decision: create separate staging and production projects (see `ENVIRONMENTS_AND_MIGRATIONS.md`). Until then the current project is the development database only and must not hold real users.
