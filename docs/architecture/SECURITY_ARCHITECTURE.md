# Security Architecture

Status: **Stage 1 design.** Items marked *(done)* exist in code; the rest are designed and scheduled.

## 1. Identity: Clerk stays the only authentication system

1. Browser gets a Clerk session token and sends it as `Authorization: Bearer` (REST) or in the first WebSocket message.
2. Backend verifies RS256 signature (Clerk JWKS), `exp`, `sub`, issuer, and `azp` *(done; azp is now mandatory in production via `validate_for_production`)*.
3. `sub` -> `users.clerk_id` -> internal `users.id`. The frontend never supplies a user id that is trusted.
4. Supabase Auth is not used. There is no second user table.

## 2. Authorization and RLS (decision D-1: Mode A)

Authorization is enforced **in the backend first**. PostgreSQL RLS is a second wall, not a replacement.

- The API connects as `meetly_app`: a dedicated login role that is **not** superuser, **not** `BYPASSRLS`, owns nothing. Migrations run as the owner role.
- Per request, inside the same transaction as the work: `SELECT set_config('app.user_id', '<verified internal id>', true)` (transaction-local, so safe through the transaction pooler). The value comes only from the verified token.
- Policy sketch (written and tested per table in Stages 3-6):

| Table | SELECT | INSERT/UPDATE/DELETE |
| --- | --- | --- |
| `user_profiles` | owner; or visibility `public`; or `friends` and caller is a friend; never if either side blocked | owner only |
| `friend_requests` | sender or receiver | sender inserts as self; receiver updates status; sender cancels |
| `friendships` | either member | via service function only (member deletes own) |
| `user_blocks` | blocker only | blocker only |
| `notifications` | recipient only | recipient updates `read_at`; inserts via service role path only |
| `meeting_invitations` | inviter, invitee, meeting host | inviter creates (host/participant rules in service) ; invitee responds |
| `waiting_room_entries` | the entry's user; meeting host | host decides; user creates/leaves own entry |

- The Supabase `anon` / `authenticated` roles get **no** grants on Meetly tables (the browser never queries Supabase directly), and PostgREST exposure is disabled for these schemas. The service-role key is used only for Storage.
- RLS tests run as `meetly_app` with two distinct user ids and assert cross-user denial; they are never run as owner or service role.

Honest limit: because the backend sets the user id, RLS protects against backend bugs (missing filter, IDOR in a query), not against a compromised backend.

## 3. Layered encryption

| Layer | Status | Detail |
| --- | --- | --- |
| 1 HTTPS/TLS | deploy-level | Vercel and Render terminate TLS. Production rejects non-https `FRONTEND_URL` origins *(done)*. |
| 2 WSS | client-level | `toWebSocketUrl` maps `https` -> `wss`; production API URL must be https. |
| 3 Encryption at rest | provider | Supabase encrypts database storage and backups (AES-256, provider-managed keys). **To verify against your project plan in Stage 2**; Meetly does not manage or hold those keys. Free-tier backup/PITR limits apply. |
| 4 Field encryption | module *(done)*, usage Stage 3+ | `app/security/crypto.py`: AES-256-GCM, random 96-bit nonce per call, AAD binds value to `table.column:row_id`, versioned envelope `enc:v1:<key_version>:<payload>`, multi-key rotation (`rotate()`), generic failure errors, keys only from env. 14 unit tests incl. tamper, wrong-AAD, rotation. |

What gets field-encrypted (justified, small by design): `users.email` (never needed for lookup after Clerk id mapping, and never shown to others) and any future private free-text the user marks private. Not encrypted: ids, usernames, display names, meeting titles, anything searched or indexed.

**This is not end-to-end encryption.** The server can decrypt field-level data and sees WebSocket signaling. WebRTC media is DTLS-SRTP between browsers (TURN-less, STUN only). Do not describe Meetly as E2EE.

## 4. API hardening (scheduled)

- Rate limiting (per user and per IP) on search, friend requests, join, password attempts, invitations; in-process limiter first (single instance), interface ready for a shared store.
- Request-size limit middleware; avatar upload: size cap, extension allow-list, MIME sniffed from magic bytes, re-encode through Pillow to strip metadata, ownership-scoped storage path.
- CORS: explicit origins, restricted methods/headers in production; WebSocket `Origin` allow-list.
- Mass assignment: Pydantic `extra="forbid"` request models for all new endpoints.
- Logging: never log tokens, authorization headers, keys, connection strings, or profile bodies.
- `AUTH_MODE=demo` refused when `APP_ENV=production` *(done)*.

## 5. Secrets handling

- Secrets live in `backend/.env` (gitignored) locally and Render env vars in production; `.env.example` has placeholders only.
- Service-role and database credentials are never `NEXT_PUBLIC_*`. The frontend needs no Supabase key.
- `.gitignore` now also covers `.env.production`, `.env.staging`, `*.pem`, `*.key`, `*.crt`, dumps, and database exports *(done)*.
- If a secret was ever committed it must be rotated; ignoring does not remove it from history. Audit found none tracked.

---

## Implementation status (Stage 7)

### Hardening now in code
| Area | What is enforced |
| --- | --- |
| Transport / CORS | Explicit origins only (no wildcard), **no credentialed requests** (Bearer tokens, not cookies), only the methods and headers the app uses. `Strict-Transport-Security` in production. Production refuses to boot on non-https origins. |
| Response headers | `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store` on `/api`. |
| Request size | 1 MB for JSON bodies, 2 MB + slack for avatars, enforced by header and while streaming (413). |
| WebSocket | Browser `Origin` must be an allowed frontend origin (both sockets). Tokens travel in the first message, never the URL. The meeting socket authenticates **before** it looks at the meeting password. |
| Brute force | Password guesses (REST and WebSocket) are limited to 10 wrong attempts per account and meeting per 10 minutes; REST join 30/min; WebSocket joins 60/min; meeting lookups 120/min; search, friend requests, blocks, invitations, avatar uploads and profile edits all have limits. In-process limiter (single instance). |
| Information exposure | `GET /api/meetings/{id}` returns title/status to any signed-in user (needed to join by link) but hides description and settings from people who are not part of the meeting. Password hashes are never serialised. 500 responses are generic. Tokens, headers and keys are not logged (tested). |
| Tokens | RS256 only; `alg=none`, HS256 key confusion, tampered payloads, missing `exp`/`sub`, foreign issuer and (when configured) foreign `azp` are all rejected (tested). |
| Integrity | One participant row per person per meeting (partial unique index, migration 0007) plus a race-safe join path. |
| Input | Pydantic models forbid unknown fields on all new write endpoints; meeting/participant creation ignore client-supplied owner, host or status. |
| Dependencies | `npm audit --omit=dev`: 0 vulnerabilities. A Python audit could not be run on this Windows machine (a pinned wheel does not build here); run `pip-audit` in CI/Linux. |

### Row Level Security (migration 0008)
Implemented as designed in section 2 (Mode A): role `meetly_app` (NOLOGIN, not superuser, no BYPASSRLS), 33 policies, SECURITY DEFINER helper functions to avoid policy recursion. Switched on per request with `DATABASE_RLS_ENFORCE=true`; **off by default**, so nothing changes for the running app until you enable it. With it on, each request transaction begins with `set_config('app.user_id', <verified id>, true)` and `SET LOCAL ROLE meetly_app`.

Tested on a real PostgreSQL as the real role (`tests/test_rls_postgres.py`, 15 tests, throwaway schema): the role is not privileged; with no identity every table is empty; a user sees only their own `users` row; profile visibility (public / friends-only / private / blocked) matches the app; friend requests, friendships, blocks, notifications, invitations, waiting-room entries and participants are scoped to the right people; forged inserts and cross-user updates are refused; `activity_events` and the legacy `invitations` table are denied. A second test runs the **real application services** (profiles, friends, blocking, notifications, invitations, meetings, waiting room) under enforcement to prove the policies do not break legitimate flows.

Deliberate gaps (the database cannot tell these apart from legitimate app behaviour; the API enforces them):
- Any signed-in user may *insert* a notification for someone else, and may write meeting history rows.
- Any signed-in user may update a scheduled/active meeting row (lazy activation on first join, timeout end). Ended/cancelled meetings are frozen for non-hosts.
- A waiting guest can update their own waiting-room row at the SQL level (admission is a host decision enforced by the API).
- A compromised backend can set any user id. RLS limits mistakes and injection, not a hostile server.

### Not done / for you to decide
- `DATABASE_RLS_ENFORCE` should be switched on in staging first, with the full UI exercised, before production.
- Field encryption (AES-256-GCM) is implemented and tested but no column uses it yet; see the audit note on `users.email`.
- Rate limits are in memory (single Render instance).
