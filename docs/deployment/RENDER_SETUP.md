# Render setup (API)

One **web service**, Docker runtime, **one instance**. Staging and production are two separate services. This guide never deploys for you.

## What the repository gives you

- `backend/Dockerfile`: Python 3.13, one `uvicorn` process on `$PORT`, trusts the platform proxy headers, `--timeout-graceful-shutdown 20`.
- `render.yaml` (production) and `render.staging.yaml`: service definitions with **no secret values** (`sync: false` entries are typed in the dashboard), no persistent disk, `numInstances: 1`, `autoDeploy: false`, health check `/health/live`.
- Start-up validation: with `APP_ENV=production` the API exits with a list of unsafe settings instead of starting.
- Endpoints: `/health` and `/health/live` (process up, no database), `/health/ready` (database reachable **and** schema at the code's revision; `503` otherwise).
- Logging: JSON-ish lines with a request id; secrets, tokens, emails and connection strings are redacted (`tests/test_observability.py`).

## Before you create the service

1. Supabase project created and the schema applied (`SUPABASE_SETUP.md`, `DATABASE_MIGRATION.md`). Render does **not** run migrations: an operator does, deliberately, before the deploy.
2. Clerk keys ready (`CLERK_SETUP.md`).
3. A generated encryption key: `python backend/scripts/generate_encryption_key.py 1`.
4. **Not** switching the live SQLite service yet? Then do not apply this blueprint to it: the SQLite blueprint is kept at `docs/deployment/legacy/render.sqlite.yaml` until the cutover in `DATABASE_MIGRATION.md`.

## Create the service (manual)

1. <https://dashboard.render.com> -> **New** -> **Blueprint**.
2. Connect the GitHub repository, choose the branch to deploy (production: `main`), and the blueprint path (`render.yaml`, or `render.staging.yaml` for staging). Render shows the service it will create and the variables marked `sync: false`.
3. Fill every `sync: false` variable (table in `ENVIRONMENT_SETUP.md`). Check each twice: `DATABASE_URL` is the **transaction pooler** string (port 6543), `DATABASE_EXPECTED_REF` is the 20-letter reference of **that same project**, `CLERK_AUTHORIZED_PARTIES` and `FRONTEND_URL` are the exact frontend origin with `https://`.
4. Plan: a paid instance (the blueprint says `starter`). Free instances sleep after inactivity and drop every WebSocket and room. **This is a cost you approve; the file does not buy anything until you click create.**
5. Region: the one nearest your Supabase project (change `region:` before applying if you chose a different one).
6. Create. Render builds the Docker image and starts the service.

## Verify

```bash
curl -s https://<service>.onrender.com/health        # {"status":"ok"}
curl -s https://<service>.onrender.com/health/ready  # {"status":"ok","checks":{"database":true,"schema":true,"encryption_config":true}}
```

- `database:false`: wrong `DATABASE_URL`/password, or the project is paused.
- `schema:false`: the database is behind the code. Apply the migration (`DATABASE_MIGRATION.md`) and check again; nothing else is needed (no redeploy).
- The service refuses to start: open **Logs**; the message begins `Unsafe production configuration:` and names each setting.
- CORS: from the Vercel site the browser must not report CORS errors (`FRONTEND_URL` must equal the site origin exactly).
- WebSockets: Render supports them on every web service; the browser connects to `wss://<service>.onrender.com/ws/meetings/<id>`. The `DEPLOYMENT_VERIFICATION.md` room test proves it.

## Running exactly one instance

The live room registry, the waiting-room lobby and (by default) rate limits are in process memory. Two instances would split a room in two without any error. Therefore: `numInstances: 1`, no autoscaling, `WEB_CONCURRENCY=1` (the API refuses larger values in production). See `docs/architecture/MULTI_INSTANCE_REALTIME.md` for the Redis / Supabase Realtime plan if you ever need to scale.

## Deploys, restarts and what users see

- A deploy or restart closes every socket. The frontend reconnects automatically; the participant row is revived (not duplicated) and gets a fresh `joined_at`. Rooms exist only as long as someone reconnects: persisted meetings, participants, waiting-room entries, invitations and notifications come back from the database.
- Rows left "present" by the restart are reconciled by the sweeper after `EMPTY_MEETING_GRACE_MINUTES` (default 10); a meeting with nobody left ends after that. Tested against real persisted rows (see the testing report).
- Render sends SIGTERM and waits up to `maxShutdownDelaySeconds` (30) while uvicorn drains for 20 s.
- Deploy outside an important meeting. `autoDeploy: false` means nothing deploys until you press **Manual Deploy**.

## Releases that add a migration

1. Take a backup (`docs/database/BACKUP_AND_RECOVERY.md`).
2. Apply the migration from your computer (`DATABASE_MIGRATION.md`). Migrations are additive, so the running API keeps working.
3. `curl .../health/ready` still `ok`.
4. Manual Deploy of the API, then the frontend (Vercel).

## Do not

- Increase instances or workers.
- Add `preDeployCommand: alembic upgrade head`: migrations on production stay a deliberate, confirmed step (`MEETLY_CONFIRM_DB`).
- Put secrets in `render.yaml`, `Dockerfile` or build arguments.
- Point staging at the production database or the reverse (the reference-ID guard refuses it).
