# Secret exposure review and rotation

## Review result (2026-11-12, values never printed)
| Check | Result |
| --- | --- |
| Clerk secret key in Git (all branches and history) | **0 matches** |
| Other secret patterns in tracked files (Supabase secret key, JWT-shaped service keys, connection strings with passwords) | **none** |
| CI (`.github/workflows/ci.yml`) and `render.yaml` | contain no secret values (`render.yaml` uses `sync: false` placeholders) |
| Where Clerk secrets live | three local, gitignored files: `backend/.env`, `frontend/.env.local`, and a stray `.env.local` at the repository root |
| Key type | **test keys** (`sk_test_`), no live key is configured |
| `backend/.env` and `frontend/.env.local` | same key, fingerprint `ba6acc2e`, **ACTIVE** |
| root `.env.local` | a *different* key, fingerprint `488e6215`, **REJECTED by Clerk** (already invalid) |

The key that was shown in a tool log during the Stage 0 audit came from the root `.env.local`, i.e. the **already rejected** key (fingerprint `488e6215`), so it cannot be used. The active key (`ba6acc2e`) does not appear in any log I produced. Treat the rotation below as precautionary hygiene, not an emergency. The root `.env.local` is a stale duplicate: delete it (it is gitignored and unused by either app).

Separately: you pasted your Supabase **secret key** and publishable key into the chat. Chat history is not a secret store, so rotate the Supabase secret key too (section 2).

Check a key at any time (prints only the key type, a fingerprint and ACTIVE/REJECTED):
```bash
cd backend && python scripts/check_clerk_key.py
```

## 1. Rotate the Clerk secret key (your action in the Clerk dashboard)
1. Clerk Dashboard -> your **development** application -> **API keys**.
2. Create/roll a new secret key. (If the dashboard offers "Roll key" with a grace period, use it; otherwise create the new one first and revoke the old one in step 6.)
3. Put the new value into `backend/.env` and `frontend/.env.local` as `CLERK_SECRET_KEY`, and into Vercel and Render if they hold it. Do not paste it in chat.
4. Restart the backend and the frontend dev server.
5. Verify: `python backend/scripts/check_clerk_key.py` must print the new fingerprint as **ACTIVE**; sign in on the site; `GET /api/users/me` works in the browser.
6. Revoke the old key in the dashboard, then check it is dead: `CLERK_KEY_TO_CHECK=<old key> python backend/scripts/check_clerk_key.py` must print **REJECTED**.
7. Search for leftovers: `grep -rl "<first 12 chars of the old key>" .` finds nothing (excluding `node_modules`).

For production use a separate Clerk **production** instance with its own keys (see `docs/database/ENVIRONMENTS_AND_MIGRATIONS.md`); never reuse the development keys.

## 2. Rotate the Supabase secret key
1. Supabase Dashboard -> Project Settings -> **API Keys** -> create a new secret key, then delete the old one.
2. Update `SUPABASE_SERVICE_ROLE_KEY` in `backend/.env` (and Render).
3. Verify: `cd backend && python scripts/setup_supabase_storage.py` prints `updated avatars` (it uses the key).
4. The publishable key is public by design and not used by Meetly; no action needed.

## 3. If a secret is ever committed
Rotate it first (the old value stays valid in Git history), then remove the file from history only if you need to; adding it to `.gitignore` does not un-leak it.
