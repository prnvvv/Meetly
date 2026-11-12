# Environment setup (development, staging, production)

Three environments, each with **its own** Supabase project and Clerk keys. Nothing is shared except the code.

| | Development | Staging | Production |
| --- | --- | --- | --- |
| Backend file | `backend/.env` (git-ignored) | `backend/.env.staging` (git-ignored) or Render env | Render environment (never a file on a laptop except for an operator command) |
| Template | `backend/.env.development.example` | `backend/.env.staging.example` | `backend/.env.production.example` |
| `APP_ENV` | `local` | `staging` | `production` |
| `DATABASE_TARGET_ENV` | `development` | `staging` | `production` |
| Frontend | `frontend/.env.local` (template `frontend/.env.local.example`) | Vercel *Preview* variables | Vercel *Production* variables |
| Render blueprint | - | `render.staging.yaml` | `render.yaml` |
| Clerk | development instance (`pk_test_`) | development instance or a second one | production instance (`pk_live_`) |

Templates contain names only. Real values are typed into dashboards or git-ignored files. `.gitignore` already excludes `.env`, `.env.*` (except `*.example`) and `.env.local`.

## How production is kept away from the development database

1. `DATABASE_EXPECTED_REF` must equal the Supabase project reference found in `DATABASE_URL`. A URL for any other project is refused by the API, Alembic and every data script (`backend/app/database/target_guard.py`).
2. `DATABASE_TARGET_ENV` must agree with `APP_ENV` (`production` with `production`).
3. `MEETLY_CONFIRM_DB=<ref>` is required on staging and production for any schema or data command, typed for that command only.
4. Production refuses to start if `DATABASE_URL` is empty or SQLite (a missing value would otherwise fall back to an ephemeral file). The legacy SQLite deployment needs the explicit `ALLOW_SQLITE_IN_PRODUCTION=1`.
5. The frontend build fails on Vercel when `NEXT_PUBLIC_API_URL` is missing, `http://` or `localhost`, when the Clerk keys are missing, or when a *production* deployment carries a `pk_test_` key (override: `MEETLY_ALLOW_CLERK_DEV_KEY=1`, see `VERCEL_SETUP.md`).

## Backend variables

| Variable | Required in production | Value / source |
| --- | --- | --- |
| `APP_ENV` | yes | `production` |
| `AUTH_MODE` | yes | `clerk` (`demo` is refused in production) |
| `DATABASE_TARGET_ENV` | yes | `production` |
| `DATABASE_EXPECTED_REF` | yes | Supabase -> Project Settings -> General -> **Reference ID** |
| `DATABASE_URL` | yes | Supabase -> Connect -> **Transaction pooler** (port 6543) |
| `DATABASE_DIRECT_URL` | for operators | Supabase -> Connect -> **Session pooler** (port 5432). Not "Direct connection" (IPv6 only; Render is IPv4) |
| `DATABASE_USE_POOLER` | yes | `true` with the transaction pooler |
| `DATABASE_SSL_MODE` | yes | `require` (never `disable`) |
| `DATABASE_RLS_ENFORCE` | recommended | `true` once verified on staging (see `SUPABASE_SETUP.md`) |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | yes (avatars) | Supabase -> Project Settings -> API. The secret key never leaves the backend |
| `CLERK_PUBLISHABLE_KEY` | yes | Clerk -> API keys. The API derives issuer and JWKS URL from it |
| `CLERK_SECRET_KEY` | optional | lets the API read a new user's name and email |
| `CLERK_AUTHORIZED_PARTIES` | yes | exact frontend origin(s), `https://...`, no trailing slash |
| `FRONTEND_URL` | yes | the same origin(s); the CORS allow-list. `https://` only in production |
| `FIELD_ENCRYPTION_KEYS` (+ `_KEY_VERSION`) | yes | generated: `python backend/scripts/generate_encryption_key.py 1`. Back it up; losing it loses encrypted values |
| `STUN_SERVER` | no | default `stun:stun.l.google.com:19302` |
| `TURN_URLS`, `TURN_SHARED_SECRET` or `TURN_USERNAME` + `TURN_CREDENTIAL` | no | see `WEBRTC_TURN_SETUP.md` |
| `EMPTY_MEETING_GRACE_MINUTES`, `EMPTY_MEETING_SWEEP_SECONDS` | no | defaults 10 and 60 (0 disables the sweeper) |
| `RATE_LIMIT_BACKEND` | no | `memory` (one instance) |
| `WEB_CONCURRENCY` | no | must stay `1` |

## Frontend variables

| Variable | Scope | Value |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | public, build time | `https://<api>.onrender.com` (REST) and `wss://` for the socket are derived from it |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | public, build time | Clerk publishable key |
| `CLERK_SECRET_KEY` | **server only** (no `NEXT_PUBLIC_`) | Clerk secret key; used by the Next middleware |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` etc. | public | as in `frontend/.env.local.example` |
| `NEXT_PUBLIC_STUN_SERVER` | public | optional |

`NEXT_PUBLIC_*` values are compiled into the browser bundle: they must never hold anything secret. Changing one requires a **new build**.

## Startup validation

- API: `validate_for_production()` and the encryption check run at start; the process exits with a message naming each unsafe setting. `/health/ready` also reports `database` and `schema` (the Alembic revision equals the code's head).
- Frontend: `frontend/next.config.ts` fails `next build` for the problems above; `frontend/src/proxy.ts` logs when the Clerk secret key is missing or truncated.

## Verify

```bash
cd backend && python scripts/check_clerk_key.py        # ACTIVE / REJECTED, never prints the key
cd backend && PYTHONPATH=. python scripts/audit_rls.py # read-only database check
curl https://<api>/health/ready                        # {"status":"ok","checks":{"database":true,"schema":true,...}}
```

Do not: copy `.env` between environments, reuse a Clerk or Supabase key across environments, or put any of these values in a screenshot, ticket or chat.
