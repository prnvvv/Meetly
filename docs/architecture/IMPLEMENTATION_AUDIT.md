# Meetly Implementation Audit (Stage 0)

Status: **awaiting approval**. Nothing outside this file has been modified.
Audit date: 2026-11-12. Branch: `feat/backend-modifi` (clean at start).

Every claim below was checked against the repository unless marked **(unverified)**.
Things I could not verify from a local checkout (production Render disk, Supabase
project, Clerk dashboard) are listed in section 14 and in "Decisions and inputs needed".

Baseline test results, run before any change:

| Suite | Result |
| --- | --- |
| Backend `pytest` (Python 3.15 locally; CI uses 3.13) | 149 passed |
| Frontend `vitest` | 305 passed |
| Frontend `tsc --noEmit` | clean |
| Frontend `lint`, `next build` | not run yet (will run in Stage 7) |

---

## 1. Current architecture

- **Frontend** (`frontend/`): Next.js 16.4.5, React 19.3.1, TypeScript, Tailwind v4 plus hand-written CSS in `src/styles/*.css` driven by tokens in `globals.css`. Clerk via `@clerk/nextjs`; `proxy.ts` is the Clerk middleware that protects every route except `/`, `/sign-in`, `/sign-up`. All REST goes through `lib/api-client.ts` (attaches the Clerk session token as `Authorization: Bearer`). Deployed on Vercel.
- **Backend** (`backend/app/`): FastAPI 0.162, Pydantic 2.14, SQLAlchemy 2.1.6 (sync `Session`), PyJWT. Layering is already router -> service -> model, with `schemas/`, `utils/`, `websocket/`. Single process (`uvicorn`), deployed on Render via Docker (`render.yaml`, one instance, 1 GB persistent disk at `/var/data`).
- **Realtime**: one WebSocket endpoint `WS /ws/meetings/{meeting_id}` (`websocket/handler.py`, 825 lines). Signaling only (offer/answer/ICE, media state, reactions, host mute/remove/end). Media is browser-to-browser WebRTC with a public Google STUN server and **no TURN**. Live connections live in an in-process `ConnectionManager` dict.
- **Auth**: Clerk. `app/auth.py` verifies the RS256 session token against Clerk's JWKS, checks `exp`/`sub`/issuer, optionally `azp`, then maps `sub` to `users.clerk_id`, auto-creating a user row on first request.
- **CI**: `.github/workflows/ci.yml` (backend pytest on SQLite, frontend typecheck/lint/test/build).

## 2. Database schema (SQLite, `backend/data/zoom_clone.db`)

| Table | Key columns / constraints | Notes |
| --- | --- | --- |
| `users` | `id` PK, `name`, `email` UNIQUE, `created_at`, `clerk_id` (unique index, added by migration), `last_login_at`, `preferences` TEXT (JSON) | User `1` is a seeded "Demo User" (`demo@example.com`, no `clerk_id`). |
| `meetings` | `id` PK, `meeting_id` UNIQUE (9-digit public id), `host_id` FK users **RESTRICT**, `title`, `description`, `start_time`, `end_time`, `duration`, `status` (VARCHAR + CHECK: scheduled/active/ended/cancelled), `meeting_link` UNIQUE, `password_hash` (bcrypt), `settings` TEXT (JSON), `created_at` | CHECKs on duration and time order. Index `(status, start_time)`. |
| `participants` | `id` PK, `user_id` FK users SET NULL, `meeting_id` FK meetings CASCADE, `display_name`, `is_host`, `is_muted`, `is_video_on`, `screen_share`, `joined_at`, `left_at` | **No unique `(meeting_id, user_id)`.** `joined_at` is never set by current code (all NULL in data). |
| `meeting_history` | `id` PK, `meeting_id` FK meetings RESTRICT UNIQUE, `started_at`, `ended_at`, `duration`, `participants_count` | One row per meeting. |
| `invitations` | `id` PK, `meeting_id` FK CASCADE, `inviter_id` FK, `invitee_ref` VARCHAR, `status`, `created_at`; unique `(meeting_id, invitee_ref)` | **Defined but unused**: no router or service references it. 0 rows. |
| `activity_events` | `id`, `meeting_id` FK CASCADE, `actor_id` FK SET NULL, `kind`, `detail`, `created_at` | **Defined but unused.** 0 rows. |

No Alembic. Schema is created by `Base.metadata.create_all` plus a hand-written additive migrator (`database/migrations.py`) that issues SQLite-flavoured `ALTER TABLE ... ADD COLUMN ... DATETIME`. `backend/migrations/` is an empty placeholder.

Local database contents (read from a **copy** of the file; the original was not opened for writing): 2 users, 4 meetings (2 active, 2 cancelled), 2 history rows, 2 participants, 0 invitations, 0 activity events. `PRAGMA integrity_check` = ok, `foreign_key_check` = no violations. This is the **development** database. The production database is on Render's disk and has not been seen.

## 3. Authentication architecture

Flow: browser obtains a Clerk session token -> sends `Authorization: Bearer` (REST) or inside the WS `join` message (not in the URL, which is good) -> backend verifies signature/expiry/issuer -> `users.clerk_id` lookup, auto-create on first call (race handled via `IntegrityError` retry).

Solid already: RS256 only (no `alg` confusion), `exp` and `sub` required, issuer enforced when derivable, fail-closed when no JWKS is configured, host identity taken from the token and `meetings.host_id` (never from the client), `participant.user_id` bound from the token in clerk mode, host-only checks on end/remove/mute, 401 messages are generic.

## 4. Persistence architecture

| Data | Where | Survives restart? |
| --- | --- | --- |
| Users, meetings, schedules, history, participants (rows) | SQLite on Render disk | Yes, **only** if the disk is attached. `render.yaml` mounts one; the plan must be a paid instance. |
| Live sockets, who is currently connected, screen-share owner | In-memory `ConnectionManager` | No. Clients must reconnect; the participant row is revived by `(meeting, user_id)`. |
| Waiting room | Does not exist | n/a |
| Friends, profiles, notifications | Do not exist (friends are hard-coded mock data in the frontend) | n/a |

Data-loss risks:
1. Single SQLite file on a single disk: no automatic off-site backup, no PITR. `scripts/backup_db.py` exists and is consistent (online backup API) but is manual.
2. `Dockerfile` does `COPY data ./data`; `.dockerignore` excludes `*.db`, so images do not bake in local data. Good.
3. Scale-out is impossible (in-memory realtime state + SQLite single writer). `render.yaml` already documents "single instance".
4. Meeting deletion is protected (`RESTRICT` on history/host), so history is preserved by design.

## 5. Existing functionality (working, covered by tests)

Instant and scheduled meetings, join validation with optional bcrypt password, host-only end/cancel, calendar range queries, history rows on start/end, participants list, WebSocket signaling with host controls and a working `lockMeeting` setting, per-user device preferences, Clerk sign-in/up, dashboard (hero, tiles, join form, upcoming/recent, calendar workspace), schedule page, settings page, meeting room with WebRTC grid.

## 6. Missing functionality

User profiles (username, bio, avatar, privacy), people search, friend requests/friendships/blocks, notifications, working friend invitations, waiting room, Alembic, rate limiting, PostgreSQL support, field encryption, storage for avatars, backups for Postgres.

Frontend-specific:
- **Friends are mock data.** `lib/friends.ts` returns 10 hard-coded names; `useFriends` feeds `FriendsDialog` in both `NewMeetingPage` and `ScheduleForm`. This violates the "no mock data" rule and must be replaced by the real API (the dialog UI itself is reusable as is).
- **No profile page.** The "profile icon" is Clerk's `<UserButton>` in `TopNav`. A Notifications button once existed and was removed because it did nothing (`docs/design-system.md`); I will not bring back dead controls.
- `waitingRoom` is a toggle in `MeetingSettingsList` (default off) and is saved in `meetings.settings`, **but the backend does not enforce it** (see V-03).

## 7. Security vulnerabilities

Severity is for the code as it would run in production with `AUTH_MODE=clerk` unless noted.

| ID | Sev | Finding | Evidence |
| --- | --- | --- | --- |
| V-01 | HIGH | **`AUTH_MODE=demo` disables all authentication and WS participant claims become spoofable.** It is a single env var, defaults to `clerk`, and `render.yaml` sets `clerk`, but nothing refuses `demo` in production. In demo mode the WS handler trusts a client-supplied `participant_id` and `is_host` falls back to "first joiner". | `auth.py:user_from_token`, `handler.py:_resolve_participant` |
| V-02 | HIGH | **No rate limiting anywhere** (REST, WS join, password attempts). The 9-digit meeting id space is enumerable and password-protected meetings accept unlimited guesses over both REST `join` and WS `join`. | no limiter in `main.py` or routers |
| V-03 | HIGH | **Waiting room is a stored but unenforced setting.** The UI tells hosts "Approve people before they join" and saves `waitingRoom: true`; the server ignores it, so anyone with the link/password enters directly. Today this is a false sense of security. | `schemas/meeting.py` (`ENFORCED_SETTINGS = {lockMeeting}`) |
| V-04 | HIGH (for Supabase) | **A DB session is held open for the whole WebSocket lifetime** (`Depends(get_db)` on the socket route, yield-style). With SQLite this is harmless; with a pooled Postgres it pins one pooled connection per live socket and exhausts the pool (Supabase poolers have small client limits). Must be restructured to short per-operation sessions. | `handler.py:meeting_socket` |
| V-05 | MEDIUM | Any authenticated user can `GET /api/meetings/{id}` for any 9-digit id (returns title, description, host id, link, settings). Combined with V-02 this is an information leak for meetings without a password. | `routers/meetings.py:get_meeting` |
| V-06 | MEDIUM | `participants` has no unique `(meeting_id, user_id)`; the join path is check-then-insert, so two simultaneous WS joins can create duplicate rows. | `participant_service`, `models/participant.py` |
| V-07 | MEDIUM | `CLERK_AUTHORIZED_PARTIES` is optional and unset by default, so a valid token minted for a *different* app on the same Clerk instance would be accepted. | `auth.py:verify_token` |
| V-08 | MEDIUM | CORS is `allow_methods=["*"]`, `allow_headers=["*"]` with credentials, and the default origin list includes a LAN IP (`http://192.168.1.10:3000`) and plain `http`. Origins are explicit (no wildcard), so not exploitable as-is, but the defaults must not reach production. | `main.py`, `settings.py` |
| V-09 | MEDIUM | WebSocket endpoint does not check the `Origin` header. Mitigated because the token is in the first message, not a cookie, so cross-site hijacking cannot authenticate. Add an origin allow-list as defense in depth. | `handler.py` |
| V-10 | MEDIUM | `users.email` and `users.name` are fetched from Clerk and stored in plaintext; email is never needed by other users. Not a leak today, but profiles/search must never serialise it. | `auth.py:_profile_from_clerk` |
| V-11 | LOW | Placeholder emails `<clerk_id>@users.meetly.invalid` are stored when `CLERK_SECRET_KEY` is missing. | `auth.py` |
| V-12 | LOW | Request-size limits are not configured (uvicorn default only); no upload endpoint exists yet. | n/a |
| V-13 | LOW | `psycopg2-binary` is pinned but the app has never run on Postgres; `migrations.py` emits SQLite-only DDL (`DATETIME`) that would fail on Postgres. | `database/migrations.py` |
| V-14 | INFO | A real Clerk **test** secret key (`sk_test_...`) sits in the untracked, gitignored root `.env.local`. I verified it is not tracked and was never committed (`git log` on that path is empty). It was displayed in my tool output during this audit, so treat it as exposed to this session's logs and **rotate it in the Clerk dashboard** if that transcript is stored anywhere shared. | `.env.local` |

No SQL injection found: all queries use the SQLAlchemy expression API; the only raw SQL is in `migrations.py` with hard-coded identifiers. No IDOR found on host-only endpoints. `DELETE /api/participants/{id}` is correctly limited to the participant or the host. No secrets are tracked in git.

## 8. Existing bugs / debt

- `participants.joined_at` is never populated.
- `Invitation` and `ActivityEvent` models are dead code; the existing "invitation" concept has no API (the frontend's invite picker is mock-only).
- `participant_service.create_participant` docstring says `user_id` "is not persisted yet" while the code does persist it (stale comment).
- `has_host_participant`'s docstring says "the app has no authentication", now stale.
- `database/database.py` resolves the DB URL at import time and creates the engine as a module side effect; `settings.py` docstring claims it never creates an engine. Tests depend on this ordering.
- Python files compile for 3.10/3.14/3.15 in `__pycache__`, but CI pins 3.13 and the Dockerfile 3.13; local Python is 3.15. No functional impact seen.

## 9. Required modifications (summary)

Backend: settings split (local/test/prod), Postgres engine + pooling, Alembic, short-lived sessions in WS, rate limiter, production guards (refuse `demo`, require HTTPS origins, require `CLERK_AUTHORIZED_PARTIES`), encryption module, new models/services/routers (profiles, social, notifications, invitations, waiting room), WS event extensions. Frontend: friends/profile/notifications UI, waiting-room screens, remove mocks. Infra: `render.yaml`, `.env.example` files, CI (add Postgres service), docs.

## 10. Proposed database architecture

- **Engine**: SQLAlchemy 2.x sync (matches current code and `psycopg2`/`psycopg`), `postgresql+psycopg://`. SQLite stays supported **only** for tests/local dev so the existing 149 tests keep running; a Postgres CI job is added for RLS and constraint tests.
- **Layout**: keep `app/database/` for engine/session; add `app/repositories/` only for the new social/waiting-room code where queries are non-trivial (existing services stay as they are). Alembic under `backend/alembic/`, baseline revision generated from current models, then additive revisions per feature.
- **Connections** (Supabase, Render): app uses the **transaction pooler** (port 6543, `NullPool` or small pool, no server-side prepared statements); Alembic and the data migration use the **session pooler or direct** connection (port 5432). Supabase's direct host is IPv6-only unless the paid IPv4 add-on is enabled, and Render egress is IPv4, so the session pooler is the likely migration path. **(unverified against your project; I will confirm from your connection strings.)**
- **Timestamps**: keep `UTCDateTime`, but map to `TIMESTAMPTZ` on Postgres. `JSON` text columns (`settings`, `preferences`) become `JSONB` through migration; Pydantic layer is unchanged.
- **Key mapping**: keep integer `users.id` (everything references it; changing it would touch every table and the migration). Add `users.clerk_id` NOT NULL for non-demo users. Public ids stay as they are.
- **Encryption of fields (layer 4)**: AES-256-GCM, versioned envelope `v1:<key_version>:<nonce>:<ct+tag>`, key from env (`FIELD_ENCRYPTION_KEYS` as a version->key map to allow rotation), AAD = table.column.row id. Proposed encrypted fields: *private notes/bio-adjacent private contact fields if added* and `users.email` (not searched or indexed after profiles move to username). I intend to **not** encrypt: ids, usernames, display names, meeting titles (searched/listed). This is small by design; the Supabase at-rest encryption claim will be documented separately and honestly. Not E2EE.

### RLS design (needs your approval, see Decisions)

Clerk -> Supabase has two workable modes:

- **A. Backend as trusted client, RLS as a second wall (recommended).** Backend connects with a dedicated *non-superuser, non-BYPASSRLS* role (`meetly_app`). Per request, inside the transaction, it runs `SET LOCAL app.current_user_id = '<verified internal id>'` (value comes only from the verified token, never the client). RLS policies read `current_setting('app.current_user_id')`. Authorization is still enforced in Python; RLS catches bugs. Works with the transaction pooler because `SET LOCAL` is transaction-scoped.
- **B. Browser talks to Supabase directly with the Clerk JWT** (Supabase third-party Clerk integration). Needs the Clerk session token to carry the `role` claim, exposes PostgREST to the browser and duplicates business rules outside FastAPI. Not recommended for this app, since all logic (waiting-room state machine, blocks) lives in the backend.

Tables with RLS: profiles, preferences, friend_requests, friendships, user_blocks, notifications, meeting_invitations, waiting_room_entries (plus participants/meetings read policies). Policies are written per table in Stage 1 and tested under the real `meetly_app` role, never the service role.

## 11. Proposed migration strategy (SQLite -> Supabase)

1. Consistent backup with `scripts/backup_db.py` (online backup API), verify with `PRAGMA integrity_check`, record size and SHA-256.
2. Alembic baseline creates the Postgres schema from models (empty target).
3. Idempotent copy script (SQLAlchemy Core, FK order: users, meetings, participants, history, invitations, activity), preserving primary keys, then resetting sequences with `setval`. SQLite naive UTC timestamps are loaded as UTC `timestamptz`; JSON text is parsed into JSONB; `0/1` booleans cast.
4. Validate: row counts, PK sets, FK integrity, unique constraints, null counts, timestamp spot-checks, per-meeting participant counts; run the backend test-suite against the migrated database.
5. Cutover is a **documented, manual** procedure (maintenance window, final backup, re-run copy, flip `DATABASE_URL` on Render, smoke test) and is gated on your explicit approval. SQLite file and backups are retained until you agree on a retention period. Rollback = point `DATABASE_URL` back at the SQLite disk (kept untouched).
6. The production data lives on Render's disk, so I need either a backup file downloaded from there or you to run the backup script in a Render shell. I cannot reach it.

## 12. Proposed social architecture

New tables (all additive migrations; identity stays independent of friendship, relationships independent of meetings):

- `user_profiles` (1:1 with users): `user_id` PK/FK, `username` (citext-style unique via lower() unique index), `display_name`, `avatar_path`, `bio`, `location`, `designation`, `organization`, `website`, `social_links` JSONB, `visibility` (`public`/`friends`/`private`), `created_at`, `updated_at`. Existing users get a generated unique username during migration.
- `friend_requests` (`id`, `sender_id`, `receiver_id`, `status` PENDING/ACCEPTED/REJECTED/CANCELLED, timestamps; partial unique index on the unordered pair while PENDING).
- `friendships` (`user_low_id`, `user_high_id`, CHECK low < high, unique pair).
- `user_blocks` (`blocker_id`, `blocked_id`, unique pair).
- `notifications` (`recipient_id`, `type`, entity ref, `read_at`, `expires_at`, `dedupe_key` UNIQUE for retry-safe delivery, minimal JSONB payload).
- `meeting_invitations` (extends/replaces the unused `invitations` table via migration: `invitee_user_id` FK, status pending/accepted/declined/expired, `expires_at`).

Behaviour decisions I will implement unless you object: simultaneous reciprocal requests auto-accept into one friendship (single transaction + pair unique index); blocking removes any friendship and cancels pending requests between the two; a block does **not** eject someone already in a live meeting (documented policy), but prevents new invitations/requests/profile access; search excludes blocked users, private profiles, and never returns email.

## 13. Proposed waiting-room architecture

- **Meeting config**: new real columns `meetings.waiting_room_enabled BOOLEAN NOT NULL DEFAULT false` and `meetings.admission_mode` (`host_approval`; `friends_auto` reserved), added by migration so existing rows get `false`. The legacy `settings.waitingRoom` JSON key stays accepted and is mapped onto the column at create time so the existing toggle works unchanged.
- **Durable state**: `waiting_room_entries` (`meeting_id`, `user_id`, `participant_id`, `state`, `decided_by`, timestamps; unique `(meeting_id, user_id)`). States WAITING/ADMITTED/REJECTED/JOINED/LEFT/REMOVED with an explicit transition table enforced in one service function and a CHECK constraint; transitions use `UPDATE ... WHERE state = :expected` so concurrent admits are idempotent.
- **Join flow**: WS `join` for a non-host in a waiting-room meeting creates/updates the entry and answers `waiting` instead of `joined`; the connection is registered in a *lobby* group (not the media room) so no signaling or participant data is sent to them. Host sees `waiting_room_updated`; admit/reject sends a participant-targeted `admitted`/`rejected` event, and the participant then completes the normal `join`. Reconnect re-reads state from the DB, so a backend restart reconstructs it. Heartbeats are not persisted.
- **Host controls**: REST endpoints as in the spec (list, admit, reject, admit-all) plus WS events, authorised on `meetings.host_id`.
- **Frontend**: a Meetly-styled participant waiting screen and a host panel inside the existing participants panel, reusing current tokens (`dialog`, `btn`, pills), no new design language.

## 14. Risk assessment

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Data loss during SQLite -> Postgres cutover | Low | Critical | Verified backup, idempotent copy, validation report, manual gated cutover, SQLite kept. |
| Turning waiting-room enforcement on changes behaviour of old meetings | Medium | High | Column defaults `false`; see decision D-3 on legacy `waitingRoom: true` rows. |
| Pool exhaustion / pooler incompatibility on Supabase | High if not fixed | High | Fix V-04, transaction pooler + `NullPool`, load test. |
| Restructuring the 825-line WS handler breaks signaling | Medium | High | Existing 1,084-line WS test file as safety net; extend it before changing behaviour; small, separate commits. |
| RLS misconfiguration silently allowing access | Medium | High | Dedicated non-bypass role; negative tests with two real identities in Postgres CI. |
| Production data not visible to me | Certain | Medium | You supply a backup from Render. |
| Free-tier Supabase pausing / limits | Medium | Medium | Document; verify project plan. |
| TURN absent, so some WebRTC calls fail on strict NATs (pre-existing) | Existing | Medium | Out of scope; flagged only. |

## 15. Files expected to change

Backend (new): `alembic.ini`, `alembic/**`, `app/config/settings.py` (extend), `app/security/{crypto,ratelimit,context}.py`, `app/models/{profile,friend_request,friendship,user_block,notification,meeting_invitation,waiting_room}.py`, matching `schemas/`, `services/`, `repositories/`, `routers/{profiles,people,friends,blocks,notifications,invitations,waiting_room}.py`, `scripts/migrate_sqlite_to_postgres.py`, tests. Backend (edit): `database/database.py`, `database/session.py`, `database/migrations.py` (retired once Alembic is baseline), `main.py`, `auth.py`, `models/{meeting,participant,__init__}.py`, `websocket/{handler,meeting_gateway,manager}.py`, `schemas/{meeting,websocket}.py`, `requirements.txt`, `Dockerfile`, `.env.example`.
Frontend (new): profile page, friends panel, notifications menu, waiting-room components, services/hooks for each. Frontend (edit): `TopNav.tsx` (friends + notifications icons, profile entry), `lib/constants.ts`, `lib/friends.ts` + `useFriends.ts` (mock removed), `NewMeetingPage.tsx` / `ScheduleForm.tsx` / `FriendsDialog.tsx` (real data), `useMeetingRoom.ts` and the meeting page (waiting states), `types/realtime.ts`.
Project: `.gitignore` (add key/cert/export patterns), `render.yaml`, `.github/workflows/ci.yml`, `README.md`, `docs/**`.

---

## Decisions and inputs needed from you

**Decisions** (I will proceed with the bold default if you simply approve):

- **D-1 RLS mode**: **Mode A** (backend-mediated, `SET LOCAL` + non-bypass role) vs Mode B (browser-direct with Clerk JWT).
- **D-2 Python/psycopg**: keep `psycopg2-binary` or move to `psycopg` v3. **Default: switch to `psycopg[binary]` 3.x**, the actively maintained driver; SQLAlchemy 2.1 supports both.
- **D-3 Legacy `waitingRoom: true` meetings**: the toggle already exists in the UI but was never enforced. Default for *existing* rows is **not enforced** (strict backward compatibility, new column = false); new meetings honour the toggle. Alternative: honour it for existing scheduled/active meetings that explicitly saved `true`. (Local DB has none; production is unknown.)
- **D-4 Avatars**: Supabase Storage with a **public** bucket for avatars of public profiles, or private bucket with signed URLs for all (needed for friends-only/private profiles to be truly private). **Default: private bucket + short-lived signed URLs** (backend uploads with the service role, which never reaches the browser).
- **D-5 Friends icon placement**: **TopNav, left of Settings** (same `icon-button` style), opening a right-hand drawer using existing dialog/panel tokens. Notifications bell next to it. Profile reached from the Clerk user menu via a custom "Profile" item (keeps the existing profile icon).

**Inputs only you can provide** (none needed to approve this audit; needed before the stage shown):

| Needed | Stage | Where it goes |
| --- | --- | --- |
| Supabase project (URL, region) | 1 | `SUPABASE_URL` in `backend/.env` |
| Supabase DB password / pooler connection strings (transaction + session) | 1 | `DATABASE_URL`, `DATABASE_DIRECT_URL` in `backend/.env` (never committed; I will create `.env` placeholders and you paste the secrets) |
| Supabase `service_role` key (avatar uploads only) | 3 | `SUPABASE_SERVICE_ROLE_KEY` in backend `.env` and Render. **Never** frontend. |
| Supabase anon key | optional | only needed if the browser ever talks to Supabase; with Mode A it is not required |
| Clerk keys | none | existing keys are reused. Optionally set `CLERK_AUTHORIZED_PARTIES` (your Vercel + localhost origins) |
| Production SQLite backup from Render | 2 | local path I can read |
| `FIELD_ENCRYPTION_KEY` | 1 | I will generate a local dev key; production key you generate with the command I provide and set in Render |
| Rotate the Clerk test secret key (V-14) | any | Clerk dashboard |

I will not connect to any production database or change any deployed setting without your explicit go-ahead at the Stage 1 and Stage 2 gates.
