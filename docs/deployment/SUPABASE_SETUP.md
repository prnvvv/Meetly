# Supabase setup (staging and production)

Two **separate** projects: `meetly-staging` and `meetly-production`. Never point staging at production data, or the reverse.

## 1. Create each project (manual)

1. Open <https://supabase.com/dashboard> -> **New project** (choose your organisation).
2. Name: `meetly-staging` (then `meetly-production`). Region: the one closest to your Render region (`render.yaml` says `frankfurt`; change one so they match). A database in another continent adds the round-trip time to every request.
3. Set a **database password** (letters and digits are safest; special characters must be URL-encoded: `@` -> `%40`, `#` -> `%23`). Save it in a password manager. Do not paste it in chat.
4. Wait until the project is **Healthy**.
5. Plan: free projects pause after a week of inactivity and have no backups. Use a paid plan for production (your decision; nothing here subscribes you).

## 2. Collect the values (manual) and where they go

| Value | Dashboard location | Put it in |
| --- | --- | --- |
| Reference ID | Project Settings -> General -> **Reference ID** (20 letters) | `DATABASE_EXPECTED_REF` |
| Transaction pooler URL | Connect -> **Transaction pooler** (port 6543); replace `[YOUR-PASSWORD]`, remove the brackets | `DATABASE_URL` |
| Session pooler URL | Connect -> **Session pooler** (port 5432) | `DATABASE_DIRECT_URL` |
| Project URL | Project Settings -> API -> **Project URL** | `SUPABASE_URL` |
| Secret key | Project Settings -> API Keys -> **secret** key (`sb_secret_...`) | `SUPABASE_SERVICE_ROLE_KEY` (backend only) |

The publishable/anon key is **not used**: the browser never talks to Supabase.

Do **not** use the "Direct connection" string: it is IPv6-only and Render is IPv4.

## 3. Create the schema (manual, from your computer)

Create `backend/.env.staging` from `backend/.env.staging.example` and fill it in (git-ignored). Then, from `backend/`:

```bash
export MEETLY_ENV_FILE=.env.staging
export MEETLY_CONFIRM_DB=<the staging Reference ID>
python -m alembic upgrade head          # prints "Target: ..." first: check it is the project you mean
python -m alembic check                 # "No new upgrade operations detected."
python scripts/setup_supabase_storage.py   # private avatars bucket
PYTHONPATH=. python scripts/audit_rls.py   # RESULT: PASSED
```

Repeat with `.env.production` and the production Reference ID only when you are ready for production. The migrations are additive and a lint test forbids `DROP`/`DELETE`/`TRUNCATE` in them.

Verify in the dashboard: Table Editor shows the Meetly tables, each with **RLS enabled** (a lock icon); Storage -> `avatars` is **private**; Database -> Roles lists `meetly_app` (no login).

## 4. Row Level Security: how it is wired and what you turn on

Meetly's design: **the browser never reaches the database.** The API verifies the Clerk token, learns the internal user id and, when `DATABASE_RLS_ENFORCE=true`, runs each request transaction as

```sql
SELECT set_config('app.user_id', '<verified id>', true);
SET LOCAL ROLE meetly_app;       -- not superuser, not BYPASSRLS, only the grants a policy exists for
```

so every query is limited by the policies in migrations 0008 and 0011 (`docs/security/RLS_AUDIT.md` lists them per table). Two layers: API authorization always, database policies on top.

**Why the Supabase "Clerk third-party auth" integration is not used.** That integration lets a *browser* call Supabase directly with the Clerk token and RLS reads `auth.jwt()`. Meetly deliberately does not expose Supabase to browsers (the `anon`/`authenticated` roles have no privileges; waiting-room admission, friendship and block rules need server logic). Enabling it would add a second, wider path to the data and change the security model. Not enabled; nothing to configure in Supabase -> Authentication -> Third-party for Meetly.

**Turn enforcement on (after staging passes):** set `DATABASE_RLS_ENFORCE=true` in the Render environment of staging, click through every screen with two accounts (`DEPLOYMENT_VERIFICATION.md`), look for `permission denied` in the logs, then set it in production. Switch off again by setting it to `false` (instant, no data change).

The service-role key bypasses RLS. It is used only for avatar storage (`app/services/storage.py`) and never for user queries.

## 5. Backups (manual)

Production: Database -> Backups: confirm what your plan includes. Before the SQLite cutover and before any migration take an explicit backup (`docs/database/BACKUP_AND_RECOVERY.md`).

## Do not

- Run `alembic downgrade`, drop or truncate on staging or production (refused by the tooling).
- Put the secret key or database password in the frontend, in `NEXT_PUBLIC_*` variables, in git or in chat.
- Reuse the development project for staging or production.
