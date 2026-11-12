# SQLite -> PostgreSQL mapping (production cutover reference)

Source: the pre-Alembic SQLite file created by earlier releases (shape verified against the development database; **the production file has not been seen yet**). Target: the Supabase schema at Alembic head (`0010`).

## Tables
| SQLite table | PostgreSQL table | Treatment |
| --- | --- | --- |
| `users` | `users` | Copied. Ids, `clerk_id`, `created_at`, `last_login_at`, `preferences` preserved. New columns (`email_ciphertext`, `email_key_version`, `email_blind_index`, `email_bidx_version`) are NULL unless `EMAIL_ENCRYPTION_MODE` is on, in which case the script encrypts them in the same transaction (plaintext kept). |
| `meetings` | `meetings` | Copied exactly, including `password_hash` (bcrypt, not re-hashed) and the `settings` JSON text. New `waiting_room_enabled` = false and `admission_mode` = `host_approval` for every row (existing behaviour unchanged). |
| `participants` | `participants` | Copied. Duplicate `(meeting_id, user_id)` pairs (possible because the old schema allowed them) **stop the run** and are listed; `--merge-duplicate-participants` keeps the first row of each and reports the ids it did not copy (only in the target; the source is never changed). |
| `meeting_history` | `meeting_history` | Copied. |
| `invitations`, `activity_events` | same (legacy, unused) | Copied if present (expected empty). See `LEGACY_INVITATIONS.md`. |
| *(none)* | `user_profiles` | **Created** for every user: username from the display name (lower-case, unique, `user<id>` fallback), same rule as the application; visibility `public`. |
| *(none)* | `friend_requests`, `friendships`, `user_blocks`, `notifications`, `meeting_invitations`, `waiting_room_entries`, `rate_limit_counters` | Did not exist in SQLite: start empty. |
| `alembic_version` | `alembic_version` | Not copied; the target must already be at head. |

## Type and constraint differences
| Topic | SQLite | PostgreSQL | Handling |
| --- | --- | --- | --- |
| Timestamps | naive text, always UTC | `TIMESTAMPTZ` | Read through the application type (naive -> aware UTC), so no shifting. Spot-checked by the "content identical" validation. |
| Booleans | `0`/`1` | `boolean` | Converted by the type layer. |
| JSON | text (`settings`, `preferences`) | text (profiles/notifications use JSONB) | Copied as text; validated as parseable JSON. |
| Enums | VARCHAR + CHECK | VARCHAR + CHECK | Same values (`scheduled/active/ended/cancelled`). |
| Integer ids | autoincrement | identity/serial | Ids preserved; each sequence is advanced to `max(id)` with `setval`. |
| Foreign keys | enforced only with a pragma | always | Source checked with `PRAGMA foreign_key_check` first; orphans stop the run. |
| Unique constraints | `email`, `meeting_id`, `meeting_link`, `clerk_id` | same, plus the new partial uniques | Violations surface during the dry run (rolled back) and are reported. |
| Case sensitivity | `LIKE` case-insensitive for ASCII | `ILIKE`/lower() | The application already lower-cases usernames and uses `lower()` in lookups. |

## Procedure (summary; full steps in `DEPLOYMENT_GUIDE.md`)
1. Receive a **fresh production backup**; record its SHA-256. The script copies it privately and proves the original is unchanged.
2. `python scripts/check_legacy_tables.py --sqlite <backup>`: confirm the legacy tables are empty.
3. Rehearsal in a scratch schema: `... --schema rehearsal --create-schema --drop-schema --apply`.
4. Dry run on the real target (default): everything inserted and validated, then **rolled back**.
5. After explicit approval and a backup: `... --apply --report migration-report.json` with `MEETLY_CONFIRM_DB=<ref>`.
6. Post-migration smoke tests, then keep the SQLite file and the report.

## Rehearsal evidence (development data, real PostgreSQL scratch schema)
`zoom_clone-20261112-153850.db` (2 users, 4 meetings, 2 history rows, 2 participants): **PASSED**. All row counts and contents identical, 0 orphaned foreign keys, ids and Clerk ids preserved, 2 profiles generated, 2 emails encrypted, waiting room OFF for every meeting, JSON valid, original backup SHA-256 unchanged; scratch schema dropped, `public` untouched.
