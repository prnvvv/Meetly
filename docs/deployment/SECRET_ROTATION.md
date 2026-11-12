# Secret rotation checklist

**Treat these as compromised until you have rotated them yourself:** the Clerk development secret key, the Supabase development secret key and publishable key, and the development database password, because they were shown in chat and tool logs. **Nothing has been rotated by the assistant, and no existing credential has been revoked.** Rotation is complete only when you tick every box below.

Never paste a secret value in chat, an issue or a commit. Every check below prints a fingerprint or a status, not the key.

Detailed per-key procedure and results of the earlier exposure review: `docs/security/SECRET_ROTATION.md`. This page is the order of operations for the deployment.

## What the code review found (this branch)

| Check | Result |
| --- | --- |
| Tracked files contain real keys, passwords or connection strings with a password | **None.** Matches are test fixtures only: obviously fake values in `backend/tests/test_observability.py` (to prove redaction) and a *publishable* key (public by design) in two settings tests. |
| Secrets read only from environment | Yes: every secret is read in `backend/app/config/settings.py` from the environment; templates (`*.example`) contain empty values; `render.yaml` uses `sync: false`. |
| Server secrets in the frontend bundle | `CLERK_SECRET_KEY` has no `NEXT_PUBLIC_` prefix and is read only by the Next middleware on the server; Supabase keys never exist in the frontend. Verified by searching the production build output (see the testing report). |
| Logs and error responses | Authorization headers, JWT-shaped strings, `sk_`/`sb_secret_` keys, emails and passwords inside URLs are redacted before logging; the readiness and error handlers return booleans or generic messages, never connection details (`backend/tests/test_observability.py`). |
| `.env` files | git-ignored (`.env`, `.env.*` except `*.example`, `.env.local`); none are tracked. |

## Checklist (you perform; do them in this order)

Do the rotations *after* the new environments exist, so you update each place once.

**Supabase**
- [ ] Development project -> Project Settings -> API Keys: create a new **secret** key, update `backend/.env` (`SUPABASE_SERVICE_ROLE_KEY`), run `python backend/scripts/setup_supabase_storage.py` (prints `updated avatars`), then **delete the old secret key** in the dashboard.
- [ ] Development project -> Project Settings -> Database -> **Reset database password**. Update `DATABASE_URL` and `DATABASE_DIRECT_URL` in `backend/.env`. Run `PYTHONPATH=. python backend/scripts/audit_rls.py` (must connect and print `PASSED`).
- [ ] The publishable key was shown too; it is public by design and unused by Meetly. Optionally roll it.
- [ ] Staging and production projects: **use fresh passwords and keys from the start**; never reuse a development value.

**Clerk**
- [ ] Development instance -> API keys: roll/create a new secret key; update `backend/.env`, `frontend/.env.local`, and Vercel Preview / Render staging if they hold the old one. Verify `python backend/scripts/check_clerk_key.py` prints the new fingerprint as **ACTIVE**. Then revoke the old key and confirm `CLERK_KEY_TO_CHECK=<old key> python backend/scripts/check_clerk_key.py` prints **REJECTED**.
- [ ] Production instance: its keys are new and have never been exposed; keep them only in Vercel (Production) and Render.

**Application keys**
- [ ] `FIELD_ENCRYPTION_KEYS` (and `FIELD_BLIND_INDEX_KEYS` if you enable email encryption): generate separate values per environment (`backend/scripts/generate_encryption_key.py`) and back each up in a password manager. These were not exposed; rotate only by the documented versioned procedure (`DEPLOYMENT_GUIDE.md` section 8), never by replacing the value.
- [ ] `TURN_SHARED_SECRET` / `TURN_CREDENTIAL`: set only on the server and in Render.

**Housekeeping**
- [ ] Delete the stale root-level `.env.local` (a rejected duplicate; git-ignored and unused).
- [ ] Search your machine and notes for the old values and delete them.
- [ ] Remove old values from CI secrets if any were ever added (none are referenced by `.github/workflows/ci.yml`).
- [ ] Mark the rotation complete here only when every box above is ticked and the checks pass.

## If a secret leaks again

Rotate first, clean up second: removing a file from git history does not make the old value safe. Then follow the checklist for that key only.
