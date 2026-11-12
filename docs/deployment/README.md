# Meetly deployment

Vercel (frontend) + Render (API) + Supabase (PostgreSQL) + Clerk (authentication). WebRTC media goes browser to browser; the API only carries signalling.

**Status legend used across these documents**

| Label | Meaning |
| --- | --- |
| READY | implemented and verified in this repository |
| READY AFTER MANUAL CONFIGURATION | the code is prepared; a dashboard step or a secret from you is still needed |
| BLOCKED | needs a decision or something that does not exist yet |
| NOT IMPLEMENTED | still incomplete |

## Architecture in one picture

```
Browser (Vercel, Next.js)  --HTTPS REST + WSS-->  Render: ONE FastAPI process  --pooler-->  Supabase PostgreSQL
   |  Clerk JS (sign-in, session token)               |  verifies the Clerk token (JWKS) on every request
   |                                                  |  sets app.user_id + SET LOCAL ROLE meetly_app (RLS)
   +-------- WebRTC media, peer to peer (STUN, optional TURN) --------+
```

- The browser **never** talks to Supabase. `anon` and `authenticated` hold no privilege on any Meetly table.
- One API instance only (live rooms are in process memory). See `docs/architecture/MULTI_INSTANCE_REALTIME.md`.

## Do the steps in this order

| # | Document | You do | Needs |
| --- | --- | --- | --- |
| 1 | [ENVIRONMENT_SETUP.md](ENVIRONMENT_SETUP.md) | decide dev / staging / production values | nothing |
| 2 | [SUPABASE_SETUP.md](SUPABASE_SETUP.md) | create the staging and production projects | Supabase account |
| 3 | [CLERK_SETUP.md](CLERK_SETUP.md) | production instance (or accept development limits) | Clerk account, ideally a domain |
| 4 | [SECRET_ROTATION.md](SECRET_ROTATION.md) | rotate the keys that were shown in chat | steps 2-3 dashboards |
| 5 | [DATABASE_MIGRATION.md](DATABASE_MIGRATION.md) | create the schema; later the SQLite cutover | step 2; the SQLite backup for the cutover |
| 6 | [RENDER_SETUP.md](RENDER_SETUP.md) | create the API service | steps 2-5 |
| 7 | [VERCEL_SETUP.md](VERCEL_SETUP.md) | create the frontend project | step 6 URL |
| 8 | [WEBRTC_TURN_SETUP.md](WEBRTC_TURN_SETUP.md) | optional TURN relay | a host that accepts UDP |
| 9 | [DEPLOYMENT_VERIFICATION.md](DEPLOYMENT_VERIFICATION.md) | run the checks | everything above |
| - | [ROLLBACK_GUIDE.md](ROLLBACK_GUIDE.md) | only if something is wrong | - |

Older, still valid references: [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) (key sources, SQLite cutover narrative), [TURN_COTURN.md](TURN_COTURN.md) (coturn config), `docs/database/*` (backups, mapping, incident record), `docs/security/RLS_AUDIT.md`.

## Hard rules (also enforced in code)

1. No `alembic downgrade`, reset or truncate on staging or production. The tooling refuses.
2. A database command needs `DATABASE_EXPECTED_REF` to equal the project in the URL, and `MEETLY_CONFIRM_DB=<ref>` for staging and production.
3. Production refuses to start on unsafe settings (demo auth, SQLite, http origin, no authorised parties, several workers) and says which.
4. Secrets only live in the Render and Vercel dashboards and in git-ignored local files. Never paste them into chat, issues or commits.
