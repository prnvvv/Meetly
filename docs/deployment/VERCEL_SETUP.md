# Vercel setup (frontend)

Next.js 16 / React 19. No `vercel.json` is needed: Vercel detects Next.js and the defaults are right. This guide never deploys for you.

## Settings (manual)

1. <https://vercel.com/new> -> **Import Git Repository** -> choose the Meetly repository.
2. **Root Directory**: `frontend` (important: the repository root holds the backend too).
3. **Framework Preset**: Next.js (auto). **Build Command**: `npm run build` (default). **Install Command**: `npm ci`. **Output Directory**: leave empty / default (do **not** set `.next/standalone`; `output: "standalone"` in `next.config.ts` is for the Docker image and Vercel ignores it). **Node.js Version**: 22.x (Project Settings -> General).
4. **Environment Variables** (Settings -> Environment Variables). Set each for the right scope:

| Name | Production | Preview | Notes |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | `https://<prod-api>.onrender.com` | `https://<staging-api>.onrender.com` | https only; `wss://` is derived |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | `pk_live_...` | `pk_test_...` | public |
| `CLERK_SECRET_KEY` | `sk_live_...` | `sk_test_...` | **do not** tick "Expose to browser"; no `NEXT_PUBLIC_` prefix |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | `/` | `/` | as in `frontend/.env.local.example` |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | `/sign-up` | `/sign-up` | |
| `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL` | `/dashboard` | `/dashboard` | |
| `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL` | `/dashboard` | `/dashboard` | |
| `NEXT_PUBLIC_STUN_SERVER` | optional | optional | default Google STUN |
| `MEETLY_ALLOW_CLERK_DEV_KEY` | only `1` if you knowingly deploy production with a development Clerk key | - | see `CLERK_SETUP.md` |

`NEXT_PUBLIC_*` values are baked into the JavaScript at build time. After changing one, **redeploy** (a plain restart does not pick it up).

5. Deploy. The first build fails on purpose when the environment is unsafe (missing/`http`/`localhost` API URL, missing Clerk key, a development key on a production deployment); the build log lists each problem.

## Domain (manual)

Project -> Settings -> **Domains** -> add your domain, create the DNS record Vercel shows, wait for the certificate. Then update, in this order: Clerk allowed origins (`CLERK_SETUP.md`), Render `FRONTEND_URL` and `CLERK_AUTHORIZED_PARTIES` (exact origin, no trailing slash), redeploy the API. Preview deployments get their own `*.vercel.app` origins; add a preview origin to the **staging** API's `FRONTEND_URL` only if you test previews against staging.

## What the build guarantees

- No hard-coded host: every API and WebSocket URL comes from `NEXT_PUBLIC_API_URL`.
- `next build` refuses an unsafe environment (`frontend/next.config.ts`).
- Response headers on every page: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(self), microphone=(self), display-capture=(self)` (the app needs these only for itself).
- HTTPS is required for camera, microphone and screen sharing (browsers disable them on plain http except `localhost`). Vercel serves HTTPS.
- Routing: page refresh works on every route (Next serves them); the 401 handler sends an expired session to `/sign-in?redirect_url=<page>`.

## Verify

1. The deployment shows **Ready**; open the URL: the landing page renders, no console errors.
2. View source / bundle search: `curl -s https://<site>/ | grep -c localhost` is `0`, and the JavaScript chunks contain your Render hostname and no `localhost:8000`:
   `for f in $(curl -s https://<site>/ | grep -o '/_next/static/chunks/[^"]*\.js' | sort -u); do curl -s https://<site>$f; done | grep -c "localhost:8000"` -> `0`.
3. Run `DEPLOYMENT_VERIFICATION.md`.

## Do not

- Put `CLERK_SECRET_KEY` or any Supabase key in a `NEXT_PUBLIC_` variable.
- Deploy a production build with `http://` or `localhost` API URLs (the build refuses).
- Enable "Automatically expose System Environment Variables" for secrets you do not need.
