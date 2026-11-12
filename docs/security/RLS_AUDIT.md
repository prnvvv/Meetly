# Row Level Security audit

Scope: every table in the Supabase `public` schema. Verified by `python backend/scripts/audit_rls.py` (read-only, run against the development project) and by `backend/tests/test_rls_postgres.py` (real PostgreSQL, real `meetly_app` role). RLS is **installed but only enforced when `DATABASE_RLS_ENFORCE=true`**; today the API connects as the table owner, which bypasses RLS, so authorization is enforced in the API first and in the database second once you switch it on.

Two layers, kept separate on purpose:
1. **Backend authorization** (always on): every endpoint checks the verified user, ownership, friendship, block, membership and host rights.
2. **Database RLS** (opt-in): the same rules expressed as policies, evaluated as the low-privilege role with the user id set from the verified token. Browser roles `anon` and `authenticated` have **no** privileges on any Meetly table, and the browser never receives a database credential (the service-role key is only in the backend environment).

## Matrix (who may do what, at database level, when enforcement is on)
`me` = the verified user. "friend" and "blocked" come from `friendships` / `user_blocks`.

| Table | Owner of a row | SELECT | INSERT | UPDATE | DELETE |
| --- | --- | --- | --- | --- | --- |
| `users` | the user | own row only | none (accounts are created before the identity is known, as the owner) | own row | none |
| `user_profiles` | the user | own; others unless private (friends excepted) and not if they blocked me; people I blocked stay visible to me | own | own | none |
| `friend_requests` | sender / receiver | sender or receiver | as sender | sender or receiver | none |
| `friendships` | the pair | either member | if I am in the pair | none | either member |
| `user_blocks` | blocker | blocker or blocked (the app must hide the blocker) | blocker | none | blocker |
| `notifications` | recipient | recipient, or the person who caused it | any signed-in user (limitation below) | recipient | recipient, or the person who caused it |
| `meetings` | host | any signed-in user (needed to join by link; the API redacts details for non-members) | as host | host, or while scheduled/active (limitation below) | none |
| `participants` | the person | own row, or anyone in the same meeting, or the host | own row, or the host | own row, or the host | none |
| `meeting_history` | the meeting | people in the meeting (host or participant) | any signed-in user (system record) | any signed-in user (system record) | none |
| `meeting_invitations` | inviter / invitee | inviter, invitee, or the meeting host | as inviter | inviter, invitee or host | none |
| `waiting_room_entries` | the guest | the guest, or the meeting host | own entry | the guest or the meeting host | none |
| `rate_limit_counters`, `activity_events`, `invitations` (legacy) | n/a | **closed to the app role** (owner only) | - | - | - |
| `alembic_version` | n/a | internal, owner only | - | - | - |

The role holds **only the privileges a policy exists for** (migration 0011): for example no DELETE on `users`, `meetings` or `participants`, and nothing at all on the closed tables. `scripts/audit_rls.py` fails if any table lacks RLS, if a browser role holds any privilege, if the app role holds a privilege without a policy, or if a table has no recorded decision (a unit test enforces the same for new tables).

## Host, participant and guest rights (database level)
- **Host**: sees participants and waiting-room entries and invitations of their own meetings (helper `app_is_host`), may decide waiting-room entries and update their meetings.
- **Participant**: sees the roster of meetings they are in (`app_in_meeting`), and only their own waiting-room entry and invitations.
- **Waiting guest**: has no participant row yet, so sees nothing about the room; only their own waiting-room entry.
- **Stranger**: sees public profiles and meeting titles by id (as the product requires) and nothing else of another user.

## Deliberate gaps (the database cannot tell these from legitimate app writes)
- Notification inserts for another user, and meeting-history writes, are allowed to any signed-in user (the backend decides).
- A scheduled/active meeting row can be updated by any signed-in user (lazy activation on first join and timeout end); ended/cancelled meetings are frozen for non-hosts.
- A waiting guest can update their own entry row at the SQL level; admission is a host decision enforced by the API.
- A compromised backend can set any user id: RLS limits mistakes and injection, not a hostile server.

## Verification performed
| Check | Result |
| --- | --- |
| `audit_rls.py` on the development project | **PASSED**: RLS on for all 14 tables, 33 policies, no browser-role grants, grants equal policies |
| Real-role tests (`test_rls_postgres.py`) | cross-user reads, forged inserts, cross-user updates/deletes all refused; the role is not superuser/BYPASSRLS; no identity means no rows; 17 tests |
| Real application services under enforcement (profiles, friends, blocking, notifications, invitations, meetings, waiting room) | pass as the low-privilege role |
| Two independent **browser** sessions with real Clerk accounts | **not done yet** (needs the Clerk test accounts described in `docs/testing/E2E_PLAN.md`) |
| Staging project with `DATABASE_RLS_ENFORCE=true` exercised through the UI | **not done yet** (no staging project exists) |
