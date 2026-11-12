# Legacy `invitations` table (and `activity_events`)

Status: **investigated; nothing removed.** Decision needed from you, after the production backup is checked.

## Findings (verified against the code, history and data)
| Question | Answer | Evidence |
| --- | --- | --- |
| Does any endpoint reference it? | **No** | No router, service, WebSocket handler or background task imports `app.models.invitation`; a test (`test_the_legacy_invitations_model_has_no_users...`) now fails if any code starts using it |
| Does the frontend use it? | **No** | The only invitation API calls go to `/api/meetings/{id}/invitations` and `/api/invitations` (the new table) |
| Was it ever written to? | **No code path has ever inserted into it** | `git log -S` finds `invitee_ref` only in the commit that created the model and in the Alembic baseline; the old invite picker was mock-only |
| Does it hold data? | **0 rows** in the development SQLite backup and in the development Supabase project. `activity_events`: 0 rows too. | `python backend/scripts/check_legacy_tables.py` |
| Production? | *Unverified.* Run the same script against the fresh production backup. Given the absence of any write path, 0 rows is expected. | `python backend/scripts/check_legacy_tables.py --sqlite <backup.db>` (read-only) |
| Overlap with the new system? | Yes: both record "who was invited to which meeting". The old one stores a free-text `invitee_ref` and a status string, with no user reference, expiry or notification. | `models/invitation.py` vs `models/meeting_invitation.py` |

The single source of truth for invitations is **`meeting_invitations`** (unique per meeting and invitee, real user ids, expiry, status machine, notifications).

## Options
1. **Leave it, deprecated (current state).** Zero risk and zero cost; the table is empty, ungranted to the `meetly_app` role, and a test prevents new code from using it.
2. **Migrate data, then drop.** Only needed if the production backup shows rows. Free-text refs cannot be mapped to users automatically, so they would be exported for review rather than converted.
3. **Drop it** (and `activity_events`) once the production backup shows 0 rows.

**Recommendation:** option 1 now; after the production backup is checked, option 3 if it is empty.

## What removal would require (not done)
1. `check_legacy_tables.py` shows 0 rows on the production backup and on every environment.
2. A new Alembic revision that drops the tables, carrying the line `# destructive-approved: <reason>` (otherwise the migration lint fails), applied development -> staging -> production with a fresh backup before each, per `ENVIRONMENTS_AND_MIGRATIONS.md`.
3. Removing `app/models/invitation.py`, `app/models/activity.py` and their exports, and the SQLite start-up migrator needs no change (it never touched them).
4. Your explicit approval. I will not drop them without it.
