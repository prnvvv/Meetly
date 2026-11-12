# Deployment Guide

Frontend on **Vercel**, API on **Render** (Docker), database and avatar storage on **Supabase**, authentication on **Clerk**. This guide covers every key you need, the environment for each place, the first Supabase setup, the one-time move from SQLite, rollback, and a post-deploy checklist.

> **Single API instance only.** Live WebSocket connections, the waiting-room lobby and rate limits live in process memory. Never set Render to more than one instance or run multiple uvicorn workers.

---

## 1. Where to get each key

Everything secret goes into `backend/.env` locally and the Render **Environment** tab in production. **Nothing from Supabase ever goes into the frontend or into a `NEXT_PUBLIC_` variable.**

| Value | Where to find it | Goes into |
| --- | --- | --- |
| `SUPABASE_URL` | Supabase Dashboard -> Project Settings -> **API** (or Data API) -> Project URL (`https://<ref>.supabase.co`). Paste the origin only. | backend |
| `DATABASE_URL` | Dashboard -> **Connect** -> **Transaction pooler** (port **6543**). Replace `[YOUR-PASSWORD]` (and remove the square brackets). | backend (runtime) |
| `DATABASE_DIRECT_URL` | Dashboard -> **Connect** -> **Session pooler** (port **5432**). Use this, not "Direct connection": direct is IPv6-only and Render is IPv4. | backend (migrations, data copy) |
| Database password | Chosen when the project was created. Forgot it? Project Settings -> **Database** -> Reset database password. URL-encode special characters (`@` -> `%40`, `#` -> `%23`) or use letters and digits only. | inside the two URLs |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings -> **API Keys** -> the **secret** key (`sb_secret_...`, or legacy `service_role`) -> Reveal. It bypasses all database security. | backend only |
| Supabase publishable / anon key | Same page. **Not needed**: the browser never talks to Supabase. | nowhere |
| `CLERK_PUBLISHABLE_KEY` / `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk Dashboard -> **API keys** -> Publishable key (`pk_...`). Public. | backend and frontend |
| `CLERK_SECRET_KEY` | Clerk Dashboard -> **API keys** -> Secret key (`sk_...`). Rotate it if it ever appears in logs or chat. | backend (optional) and Vercel |
| `CLERK_AUTHORIZED_PARTIES` | Your exact frontend origins, e.g. `https://meetly.vercel.app` (no trailing slash). **Required in production.** | backend |
| `FIELD_ENCRYPTION_KEYS` | **You generate it**: `python backend/scripts/generate_encryption_key.py 1` prints two lines to paste. Use a *different* key from local development and back it up in a password manager; losing it makes encrypted values unrecoverable. | backend |

---

## 2. Environment by place

### Backend (Render -> Environment)

| Variable | Production value |
| --- | --- |
| `APP_ENV` | `production` (the app **refuses to start** on unsafe settings and prints which) |
| `AUTH_MODE` | `clerk` |
| `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CLERK_AUTHORIZED_PARTIES` | from section 1 |
| `FRONTEND_URL` | exact Vercel origin(s), `https://...`, comma separated |
| `DATABASE_URL` | transaction pooler string |
| `DATABASE_DIRECT_URL` | session pooler string |
| `DATABASE_USE_POOLER` | `true` |
| `DATABASE_SSL_MODE` | `require` |
| `DATABASE_POOL_SIZE`, `DATABASE_MAX_OVERFLOW` | `5`, `5` (the pooler multiplexes; raise only if you see waits) |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_AVATAR_BUCKET` | from section 1; bucket `avatars` |
| `FIELD_ENCRYPTION_KEYS`, `FIELD_ENCRYPTION_KEY_VERSION` | generated key, version `1` |
| `DATABASE_RLS_ENFORCE` | `false` first; see section 6 |
| `STUN_SERVER` | `stun:stun.l.google.com:19302` (or your own) |

Local development: `backend/.env` with `APP_ENV=local`. Tests: `APP_ENV=test` is set by the test-suite and the database is forced to a temporary SQLite file. Staging: same as production with its own Supabase project, Clerk instance and `FRONTEND_URL`.

### Frontend (Vercel -> Environment Variables)

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_API_URL` | `https://<your-api>.onrender.com` (the browser derives `wss://` from it) |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | Clerk keys |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` etc. | as in `frontend/.env.local.example` |
| `NEXT_PUBLIC_STUN_SERVER` | optional |

In the Clerk dashboard add the Vercel domain to the allowed origins/redirects for the instance you use.

---

## 3. First-time Supabase setup

Do this from `backend/` with `.env` filled in. It touches only the database named in `DATABASE_DIRECT_URL`.

```bash
python -m alembic upgrade head            # creates every table, indexes, RLS policies and the meetly_app role
python -m alembic check                   # must print "No new upgrade operations detected."
python scripts/setup_supabase_storage.py  # creates the PRIVATE avatars bucket (2 MB, png/jpeg/webp)
```

Then in the Supabase dashboard confirm: Database -> Tables shows 13 Meetly tables with RLS enabled; Storage -> `avatars` is **not** public; Database -> Backups shows what your plan includes (free projects usually have none, see `BACKUP_AND_RECOVERY.md`).

---

## 4. Moving production from SQLite to Supabase (cutover)

**This is a production change. Do not start it without an explicit go-ahead and a maintenance window.** Today `render.yaml` runs on SQLite on a persistent disk and keeps doing so until you finish this section.

### Before the window
1. Run through the checklist in section 7 against a **staging** deployment (own Supabase project) if you can.
2. Take and verify a backup of the production SQLite file (Render shell): `python scripts/backup_db.py backup`, then download it. Record its size and SHA-256. Check it: `sqlite3 <file> "PRAGMA integrity_check"` prints `ok`.
3. Rehearse the copy on your machine against a **scratch schema** (never the real one):
   `python scripts/migrate_sqlite_to_postgres.py --source <backup.db> --schema rehearsal --create-schema --drop-schema`
   It must end with `VALIDATION PASSED`. (This was done with the development database; the production file has not been seen.)
4. Make the Supabase target **empty**. If you used it for development, its rows (accounts you signed in with, test friends) are throw-away: confirm that, take a `pg_dump` if in doubt, then clear them (approval required). The copy script refuses a non-empty target on purpose.

### During the window
1. Put the API in maintenance: suspend the Render service (or scale it to zero).
2. Take the **final** SQLite backup again (same steps as above).
3. From your machine: `python scripts/migrate_sqlite_to_postgres.py --source <final-backup.db>` (target is `public`, via `DATABASE_DIRECT_URL`). Require `VALIDATION PASSED`: row counts, every row's content, foreign keys and participant counts are compared, and the whole copy is one transaction (any failure rolls everything back).
4. In Render set the production variables from section 2. Add to the service (or `render.yaml`): `preDeployCommand: python -m alembic upgrade head` (a no-op once the schema is at head). Keep the persistent disk and the SQLite file untouched.
5. Resume / deploy. Watch the logs: the API must start (if `APP_ENV=production` rejects a setting it says which one).
6. Run the smoke tests in section 7.

### Rollback
If anything is wrong: set `DATABASE_URL` back to `sqlite:////var/data/meetly.db`, remove the Supabase-only variables if you like, redeploy. The SQLite file was never modified. Rows written to Supabase during the failed attempt are not copied back; for a short window that is usually acceptable, otherwise export them first.

### After
Keep the SQLite file and backups until the new database has been verified for a period you choose (suggestion: 30 days), then delete them deliberately. Existing users keep working because they are matched by Clerk id.

---

## 5. Deploying the code

- **API:** Render builds `backend/Dockerfile` (Python 3.13). `autoDeploy: true` redeploys on pushes to the connected branch. The container runs one uvicorn process on `$PORT` and trusts the platform proxy headers.
- **Frontend:** Vercel builds `frontend/` (`npm run build`); set the root directory to `frontend`.
- **Order for a release that adds a migration:** deploy the API first (it runs `alembic upgrade head` as the pre-deploy step), then the frontend. Every migration is additive and backwards compatible with the previous frontend.

---

## 6. Turning on Row Level Security (optional, recommended in staging first)

RLS is installed by migration 0008 but dormant. Set `DATABASE_RLS_ENFORCE=true` on a **staging** API, click through every screen with two accounts (profiles, friends, invitations, waiting room, meetings), watch the logs for permission errors, then repeat in production. To turn it off again just set it back to `false`. What it does and does not protect: `docs/architecture/SECURITY_ARCHITECTURE.md`.

---

## 7. Smoke test after any deploy

1. `GET <api>/health` returns `{"status":"ok"}`.
2. Sign in on the Vercel site; the dashboard loads.
3. Profile: open the user menu -> Profile, edit the bio, upload a photo (the picture appears, and its URL is a temporary Supabase link).
4. Second account (private window): both find each other under Friends -> Find people, send and accept a request; the bell shows the notification.
5. New Meeting with a friend selected: the friend gets the invitation and can Join.
6. Waiting room: create a meeting with the waiting room on; the guest sees the waiting screen, the host admits, the guest enters; video and audio connect.
7. Host ends the meeting; it appears in Recent.
8. Browser console: no CORS errors; the WebSocket URL starts with `wss://`.

---

## 8. Operations

- **Backups:** `BACKUP_AND_RECOVERY.md`. Supabase backups depend on your plan: verify, do not assume.
- **Rotating a leaked secret:** Clerk -> regenerate the secret key, update Vercel and Render, redeploy. Supabase -> regenerate the secret key and update Render. Database password -> reset in Supabase, update both URLs.
- **Rotating the field-encryption key:** add the new key to `FIELD_ENCRYPTION_KEYS` (`1:old,2:new`), set the version to `2`, run a re-encryption pass (`FieldCipher.rotate`), then remove `1` once nothing uses it.
- **Supabase free projects pause** after a week of inactivity; the first request after that fails until it wakes. Use a paid plan for production.
- **Limits to watch:** Supabase connection limits (keep the pool small), Render instance memory (rooms and the lobby are in memory), STUN-only WebRTC (add TURN for strict networks).

---

## 9. Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Startup error "Unsafe production configuration: ..." | A production guard fired; the message names the setting (demo auth, non-https `FRONTEND_URL`, missing `CLERK_AUTHORIZED_PARTIES`, `DATABASE_SSL_MODE=disable`). |
| `password authentication failed` | The URL still contains `[YOUR-PASSWORD]`, or the password has unescaped special characters. |
| `prepared statement ... does not exist` | `DATABASE_USE_POOLER` must be `true` with the transaction pooler (port 6543). |
| Migration hangs or "network is unreachable" | You used the direct host (IPv6). Use the Session pooler string. |
| Browser CORS error | `FRONTEND_URL` must contain the exact origin (scheme + host, no trailing slash). |
| Sign-in works but API returns 401 | `CLERK_AUTHORIZED_PARTIES` does not include the frontend origin, or the publishable key differs between frontend and backend. |
| Avatar upload returns 503 | `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` missing or wrong; run `scripts/setup_supabase_storage.py`. |
| "Refusing to downgrade ..." | Intentional guard; downgrades drop tables. Use a throwaway database. |
