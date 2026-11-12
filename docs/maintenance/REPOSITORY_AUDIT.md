# Repository audit

Stage 1 of the public-release cleanup. Audit date: 2026-11-13. Base: `main` at `6fc9d04`.

This document records what was inspected, what was found, what was changed in the same
pull request, and what still needs a decision. No secret values appear in it.

## Scope and method

- 419 tracked files: `frontend/src` (195), `backend/app` (80), `backend/tests` (24), `docs`, `e2e`, CI, Render blueprints.
- Static inspection, repository-wide pattern searches, reference tracing for unused files, and the existing quality gates.
- Secret scan: regular-expression search of every tracked file plus a search of all branches' history for added `.env`, database, key and certificate files. A dedicated scanner (gitleaks, trufflehog) was **not** run; install one before making the repository public.

## Quality gates run locally

| Check | Result |
| --- | --- |
| Frontend `npm run typecheck` | Passed |
| Frontend `npm run lint` | Passed, no warnings |
| Frontend `npm test` | 42 files, 384 tests passed |
| Frontend `npm audit --omit=dev` | 0 vulnerabilities |
| Frontend `npm run build` | **Not executed** locally (needs a production-shaped environment or `MEETLY_SKIP_ENV_CHECK=1`); executed by CI |
| Backend `pytest` (SQLite, isolated by `tests/conftest.py`) | 511 passed, 1 deprecation warning |
| Backend PostgreSQL suites (`test_rls_postgres.py`, `test_lifecycle_postgres.py`) | **Not executed** locally; run by the `backend-postgres` CI job |
| Backend `ruff` | **Not executed** locally (not installed in the venv); CI runs a limited rule set |
| Backend `pip-audit` | **Not executed** (tool not installed) |
| E2E (Playwright) | **Not executed** (needs live Clerk and a running stack) |

The backend test configuration forces a throwaway SQLite file and clears the Supabase
settings before the app is imported, so running it cannot touch the database that
`backend/.env` points at.

## Findings

### CRITICAL

None confirmed in tracked source.

- No credential-shaped values were found in tracked files. Every match was a key prefix in documentation, a placeholder, or an obviously fake test fixture.
- No `.env`, database, key, certificate or dump file was ever added to any branch's history. Only `.env*.example` templates and a legacy Render blueprint matched the file-name search.
- Ignored local files exist (`backend/.env`, `frontend/.env.local`, `.env.local`, `backend/data/zoom_clone.db`, `backend/data/backups/`). They are correctly ignored and not tracked. `backend/.env` targets the real Supabase project, so never run destructive tooling from that environment.

### HIGH

| ID | Finding | Files | Status |
| --- | --- | --- | --- |
| H1 | A Clerk admin script lived under `frontend/public/`, so Next.js would have served it at a public URL. It carried a hardcoded default demo-user password. | `frontend/public/images/scripts/create-demo-user.mjs` | **Fixed**: moved to `frontend/scripts/`, default password removed (`DEMO_USER_PASSWORD` now required, 12+ characters). |
| H2 | `npm run demo-user` pointed at `scripts/create-demo-user.mjs`, which did not exist, so the command was broken. | `frontend/package.json` | **Fixed** by the move in H1. |
| H3 | The demo password was published in documentation. | `docs/design-system.md` | **Fixed** in the current files. **Action for you:** the string remains in Git history, so treat that password as public and delete or reset the demo user in the Clerk development instance. History was not rewritten. |
| H4 | No `LICENSE` file. Without one, the code is "all rights reserved" and others cannot legally use it. | repository root | **Fixed**: MIT `LICENSE` added (see Licensing). Third-party asset provenance is still unconfirmed. |

### MEDIUM

| ID | Finding | Files | Status |
| --- | --- | --- | --- |
| M1 | Six dashboard components and one hook are referenced only by their own tests and by `docs/design-system.md`; no production code imports them. | `components/dashboard/{DashboardHero,MeetingPanel,MeetingRows,PanelEmptyState,RecentMeetingCard,UpcomingMeetingCard}.tsx`, `hooks/useMeetingList.ts` (+ tests) | **Needs approval** before deletion. |
| M2 | `components/ui/skiper39-demo.tsx` has no references anywhere. `skiper39.tsx` is used by the landing page but has the most `any`/lint suppressions (9). | `frontend/src/components/ui/` | Demo file needs approval; `skiper39.tsx` typing is a follow-up. |
| M3 | Three source images are not referenced; only their `-trimmed` versions are (about 1.1 MB). | `frontend/public/images/new-meeting/{cheerful-lady,coffee-mug,plant}.png` | **Needs approval** (they may be the originals you want to keep). |
| M4 | `opentelemetry-api` was pinned in `backend/requirements.txt` but never imported. | `backend/requirements.txt` | **Fixed**: removed. |
| M5 | `backend/requirements.txt` mixes runtime and test dependencies (`pytest` and its helpers) and lists `PyYAML` and `watchfiles`, which nothing in the repository imports directly. They may be pulled in as `uvicorn` extras, so they were left alone. | `backend/requirements.txt` | Follow-up: split `requirements-dev.txt`, confirm the extras. |
| M6 | `backend/migrations/.gitkeep` was an empty placeholder left over from before Alembic; `backend/alembic/` is the real migration directory. | `backend/migrations/` | **Fixed**: removed. `backend/app/websocket/INTEGRATION.md` still mentions it. |
| M7 | Several documents describe an earlier state of the project (for example "No Alembic", "the backend has no authentication"), which contradicts `backend/alembic/` and `backend/app/auth.py`. The design system doc also has a stale "Current status" paragraph. | `docs/architecture/IMPLEMENTATION_AUDIT.md`, `docs/design-system.md`, `backend/app/websocket/INTEGRATION.md` | Follow-up: mark as historical or update. |
| M8 | Two different documents share the name `SECRET_ROTATION.md` with different content, and deployment guides overlap (`DEPLOYMENT_GUIDE.md`, `ENVIRONMENT_SETUP.md` and the per-service guides). | `docs/security/`, `docs/deployment/` | Follow-up: consolidate. |
| M9 | CI has no dependency or secret scanning, no backend type checking, and a deliberately narrow Ruff rule set. | `.github/workflows/ci.yml` | Follow-up. |
| M10 | 23 `except Exception` / bare `except` sites in `backend/app` were counted but not reviewed one by one. | `backend/app/**` | Follow-up review. |
| M11 | Twelve frontend files contain `any`, `@ts-ignore` or `eslint-disable`. | see `git grep` | Follow-up review. |
| M13 | The README and `backend/README.md` say that with SQLite "the schema is created on startup". That is acceptable for local development, but the release brief forbids automatic schema creation outside development; confirm startup never does this against PostgreSQL. | `README.md`, `backend/app/main.py`, `backend/app/database/` | Verify in the deep review; README test counts were stale and are now removed. |
| M12 | Two PNGs are 1.2 MB and 0.9 MB and are not optimised. | `frontend/public/images/` | Follow-up (measure first). |

### LOW

- `pyproject.toml` still names the project `scalarzoomclone`.
- `vitest.config.ts` prints an ESM-in-CommonJS warning on every run.
- `backend/app/seed/seed_data.py` uses `print`; acceptable for a CLI seed script, but could use logging.
- `.gitignore` ignored every file named `main.py` at any depth; narrowed to the repository root.
- `.gitignore` ignores `AGENTS.md`, but `next dev` regenerates `frontend/AGENTS.md` and asks for it to be committed, and `frontend/CLAUDE.md` (untracked) imports it. Decide whether these agent files are public.
- `docs/deployment/legacy/render.sqlite.yaml` is intentionally kept for rollback until the Postgres cutover completes (referenced by `ROLLBACK_GUIDE.md` and `RENDER_SETUP.md`). Do not delete yet.
- `scripts/e2e_probe.py` is a manual probe, documented in the README; keep.

## Not yet audited in depth

These areas were listed in the brief but have **not** been reviewed line by line. Do not read their absence from this report as a clean result.

- WebSocket authentication and authorization (`backend/app/websocket/handler.py`, 990 lines, the largest module).
- Row Level Security policies and Supabase role grants beyond what existing tests cover.
- Rate limiting coverage, upload handling, and error responses that could leak internals.
- N+1 queries, missing indexes, unbounded queries.
- Frontend bundle size, re-renders, accessibility.
- TURN/WebRTC behavior on restrictive networks (needs live testing; cannot be settled in code).
- HTTP security headers: the frontend sets `nosniff`, `Referrer-Policy` and `Permissions-Policy`; no CSP or HSTS is configured in the application (Vercel and Render may add HSTS at the edge, unverified).

## Licensing

MIT was chosen and added as `LICENSE` (copyright holder: the repository owner's GitHub handle; change it if you want a legal name). The alternatives considered:

- **MIT**: very permissive; anyone may use, modify and sell it, including closed-source forks, provided the notice stays. Simplest and most common for portfolio and community projects.
- **Apache-2.0**: permissive like MIT, plus an explicit patent grant and patent-retaliation clause. Slightly longer, favoured by companies.
- **GPL-3.0**: copyleft; derivatives and anything linking to it must also be GPL. Protects openness, discourages commercial reuse and hosted forks.
- **AGPL-3.0**: GPL plus a network clause, so hosted modifications must publish source. Relevant if you want to prevent a closed hosted clone of a SaaS.

Third-party assets: `frontend/public/images/` contains illustrations and `skiper39.tsx` appears to come from a component registry. Confirm their licenses and attribution before publication. Dependency licenses were not scanned.

## Proposed cleanup actions

Done in this pull request: H1, H2, H3 (files), M4, M6, `.gitignore` narrowing, contributor files (`CONTRIBUTING.md`, `SECURITY.md`, issue and pull request templates).

Needs your approval before I do it: delete M1 (test-only dashboard components, hook and their tests), the M2 demo file and the M3 images; decide on the agent files.

Next stages, in order: dependency split and CI hardening (M5, M9), documentation consolidation and README rewrite (M7, M8), deep review of WebSocket auth and the broad exception sites (M10), `docs/deployment/PRODUCTION_DEPLOYMENT.md`, then the cleanup report and public-release checklist.
