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
