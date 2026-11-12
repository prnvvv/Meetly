# Meetly

**Video meetings with a personality.** Meetly is a full-stack web app for starting, scheduling and joining browser-based video meetings, with profiles, friends, invitations and a configurable waiting room, wrapped in a minimal black-and-white design with hand-drawn people illustrations.

[![CI](https://github.com/prnvvv/Meetly/actions/workflows/ci.yml/badge.svg)](https://github.com/prnvvv/Meetly/actions/workflows/ci.yml)
![Next.js](https://img.shields.io/badge/Next.js-16-000000)
![React](https://img.shields.io/badge/React-19-61dafb)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6)
![FastAPI](https://img.shields.io/badge/FastAPI-0.162-009688)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Supabase-3ecf8e)
![WebRTC](https://img.shields.io/badge/WebRTC-peer--to--peer-0b5cff)

---

## Contents

- [Features](#features)
- [How it works](#how-it-works)
- [Tech stack](#tech-stack)
- [Getting started](#getting-started)
- [Database and migrations](#database-and-migrations)
- [Environment variables](#environment-variables)
- [Project structure](#project-structure)
- [API overview](#api-overview)
- [Security](#security)
- [Testing and CI](#testing-and-ci)
- [Deployment](#deployment)
- [Documentation](#documentation)
- [Limitations](#limitations)
- [Roadmap](#roadmap)

---

## Features

**Meetings**
- **Instant meetings** with a server-generated nine-digit ID, a shareable invite link and an optional password (bcrypt-hashed, with guess limits).
- **Join** by meeting ID or by pasting an invite link. **Schedule** meetings, see them on a month calendar and edit them until they start.
- **Live rooms** with grid, speaker and auto layouts, pin-to-stage, active-speaker highlighting, reactions, fullscreen and keyboard shortcuts (`M` mute, `V` video, `P` participants, `F` fullscreen).
- **Host controls**: mute a participant, mute everyone, remove someone, end the meeting for all.
- **Waiting room** (per meeting, off by default): guests wait on a Meetly screen, the host admits, rejects or admits everyone from the participants panel, with live updates. Enforced by the server, survives reconnects and restarts. See [`WAITING_ROOM_ARCHITECTURE.md`](docs/architecture/WAITING_ROOM_ARCHITECTURE.md).

**People**
- **Profiles** (`/profile`, reached from the user menu): username, display name, photo, bio, role, organization, location, website and social links, with **public / friends-only / private** visibility enforced by the API.
- **Friends** (top-bar icon): find people by username or name, send/accept/reject/cancel requests, remove friends, block and unblock. Simultaneous requests resolve to one friendship.
- **Notifications** (bell): friend requests, acceptances and meeting invitations, delivered live over a WebSocket hint and kept in the database.
- **Meeting invitations**: pick friends on *New Meeting* or *Schedule*, or use **Invite** inside a live meeting (copy the link, search friends, send invitations, see who accepted). Invitations never bypass the password or the waiting room.

**Account**
- Sign-in and sign-up through [Clerk](https://clerk.com); every non-public route is protected and the API verifies the Clerk token on every request.

---

## How it works

The backend handles **state and signaling only**. Audio and video travel directly between browsers.

```mermaid
flowchart LR
    B1["Browser A"] <-->|"WebRTC audio + video"| B2["Browser B"]
    B1 -->|"REST + Clerk token"| API["FastAPI"]
    B1 <-->|"WebSocket: signaling, room state, waiting room"| API
    B2 <-->|"WebSocket"| API
    API --> DB[("PostgreSQL (Supabase)")]
    API -->|"avatars (service key, server only)"| ST[("Supabase Storage")]
    B1 -.->|"sign-in"| Clerk["Clerk"]
```

1. **REST** creates, validates, schedules and ends meetings and powers profiles, friends, invitations and notifications.
2. A per-meeting **WebSocket** (`/ws/meetings/{id}`) carries joins and leaves, SDP/ICE signaling, media state, reactions, host actions and the waiting room. A second small socket (`/ws/notifications`) tells the browser when to refetch notifications.
3. **WebRTC** connects participants in a peer-to-peer mesh, using a public STUN server for NAT traversal.
4. **Identity** is always Clerk. The API turns the verified token into an internal user id; a client-supplied user id is never trusted.

On the client, one hook (`useMeeting`) owns the room lifecycle: join validation, media, socket, peer connections, the waiting phase and host actions.

---

## Tech stack

| Area | Technology |
|---|---|
| Frontend | Next.js 16 (App Router), React 19, TypeScript (strict) |
| Styling | Plain CSS on shared design tokens; Tailwind CSS 4 and GSAP on the landing page |
| Auth | Clerk (`@clerk/nextjs`) |
| Realtime and media | Native WebSocket, WebRTC, Web Audio API |
| Backend | FastAPI, Pydantic 2, SQLAlchemy 2, Alembic, Uvicorn, bcrypt, Pillow, cryptography |
| Database | PostgreSQL on Supabase in production; SQLite for local development and tests |
| Storage | Supabase Storage (private bucket, signed URLs) for avatars |
| Tests | Vitest + Testing Library (frontend), pytest (backend, plus opt-in PostgreSQL Row Level Security tests) |
| CI | GitHub Actions, Dependabot |

---

## Getting started

**Prerequisites:** Node.js 22, Python 3.13 (3.10+ works), and a free [Clerk](https://dashboard.clerk.com) application for the sign-in keys. No database setup is needed locally: SQLite is used when `DATABASE_URL` is empty.

### 1. Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env             # then set CLERK_PUBLISHABLE_KEY (and CLERK_SECRET_KEY)
uvicorn app.main:app --reload --port 8000
```

`backend/.env` is loaded automatically (real environment variables win). The API is at <http://localhost:8000> with docs at `/docs`. With SQLite the schema is created on startup.

### 2. Frontend

```bash
cd frontend
cp .env.local.example .env.local   # then add your Clerk keys
npm install
npm run dev
```

Open <http://localhost:3000>, sign up, and start a meeting. Open the invite link in a second browser or profile to try a two-person call. To try friends, invitations and the waiting room you need two accounts.

> `scripts/run-all.sh` starts both services together (Git Bash on Windows, any shell on macOS/Linux).

### Using Supabase locally

Fill the `DATABASE_*` and `SUPABASE_*` values in `backend/.env` (where to find each one is in [`DEPLOYMENT_GUIDE.md`](docs/deployment/DEPLOYMENT_GUIDE.md)), then:

```bash
cd backend
python -m alembic upgrade head          # creates/updates the schema (uses DATABASE_DIRECT_URL)
python scripts/setup_supabase_storage.py # creates the private avatar bucket (once)
```

> **Careful:** `backend/.env` then points at a real database. Do not run destructive commands from that folder. `alembic downgrade` is refused on non-SQLite databases for this reason.

---

## Database and migrations

The schema is owned by **Alembic** (`backend/alembic/`). SQLite (dev/tests) is also created automatically on startup; PostgreSQL is never created implicitly.

```bash
cd backend
python -m alembic upgrade head      # apply
python -m alembic current           # what is applied
python -m alembic revision --autogenerate -m "describe change"   # new reviewed revision
python -m alembic check             # models and database agree
```

| Revision | Adds |
|---|---|
| 0001 | Baseline: users, meetings, participants, history |
| 0002 | Revokes Supabase browser-role access to Meetly tables |
| 0003 | User profiles (backfills existing users) |
| 0004 | Friend requests, friendships, blocks, notifications |
| 0005 | Meeting invitations |
| 0006 | Waiting room (`meetings.waiting_room_enabled`, default off; entries) |
| 0007 | One participant row per user per meeting |
| 0008 | `meetly_app` role and Row Level Security policies |

Moving existing data from SQLite, backups and recovery: [`MIGRATION_GUIDE.md`](docs/database/MIGRATION_GUIDE.md), [`BACKUP_AND_RECOVERY.md`](docs/database/BACKUP_AND_RECOVERY.md).

---

## Environment variables

Templates: [`backend/.env.example`](backend/.env.example) and [`frontend/.env.local.example`](frontend/.env.local.example). Real values never go in git (`.env*` is ignored).

**Backend** (`backend/.env`, or Render env vars)

| Variable | Purpose | Default |
|---|---|---|
| `APP_ENV` | `local`, `test`, `staging`, `production`. Production refuses unsafe settings (demo auth, non-https origins, missing Clerk authorized parties). | `local` |
| `AUTH_MODE` | `clerk` verifies tokens. `demo` skips auth (local/tests only). | `clerk` |
| `CLERK_PUBLISHABLE_KEY` | Public Clerk key; the JWKS URL and issuer are derived from it | — |
| `CLERK_SECRET_KEY` | Lets the API read a new user's name from Clerk (optional, secret) | — |
| `CLERK_AUTHORIZED_PARTIES` | Frontend origins allowed in the token (**required in production**) | — |
| `DATABASE_URL` | Runtime database. Empty = local SQLite. Supabase: transaction pooler (port 6543) | SQLite file |
| `DATABASE_DIRECT_URL` | Migrations/data migration: Supabase session pooler (port 5432) | — |
| `DATABASE_USE_POOLER` | `true` with the transaction pooler (disables prepared statements) | `false` |
| `DATABASE_POOL_SIZE`, `DATABASE_MAX_OVERFLOW` | Connection pool sizing | `5`, `5` |
| `DATABASE_SSL_MODE` | `require` or `verify-full` (production refuses `disable`) | `require` |
| `DATABASE_RLS_ENFORCE` | Run requests under Row Level Security as `meetly_app` | `false` |
| `DATABASE_TARGET_ENV`, `DATABASE_EXPECTED_REF` | Bind this environment to one Supabase project; every other database is refused ([`ENVIRONMENTS_AND_MIGRATIONS.md`](docs/database/ENVIRONMENTS_AND_MIGRATIONS.md)) | — |
| `MEETLY_ENV_FILE`, `MEETLY_CONFIRM_DB` | Pick another env file (`.env.staging`); confirm a staging/production schema or data command | — |
| `EMAIL_ENCRYPTION_MODE`, `FIELD_BLIND_INDEX_KEYS(_VERSION)` | Encrypt account emails (`off` / `dual` / `encrypted`) with a separate HMAC index key ([`EMAIL_ENCRYPTION.md`](docs/security/EMAIL_ENCRYPTION.md)) | `off` |
| `RATE_LIMIT_BACKEND` | `memory` or `database` (shared by all instances) | `memory` |
| `EMPTY_MEETING_GRACE_MINUTES` | Minutes an active meeting may stay empty before it is ended automatically (`0` disables) | `10` |
| `EMPTY_MEETING_SWEEP_SECONDS` | How often the empty-meeting check runs | `60` |
| `TURN_URLS`, `TURN_SHARED_SECRET`, `TURN_CREDENTIAL_TTL` | Optional TURN relay with short-lived credentials ([`TURN_COTURN.md`](docs/deployment/TURN_COTURN.md)) | not configured |
| `LOG_FORMAT`, `LOG_LEVEL` | `json`/`text`, level; secrets, tokens and emails are redacted | json in staging/production |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_AVATAR_BUCKET` | Avatar storage. **Server only**, never in the browser | bucket `avatars` |
| `FIELD_ENCRYPTION_KEYS`, `FIELD_ENCRYPTION_KEY_VERSION` | AES-256-GCM field-encryption keys (`version:key`), see Security | — |
| `FRONTEND_URL` | Allowed CORS origins and invite-link base (comma separated, https in production) | `http://localhost:3000` |
| `STUN_SERVER` | STUN server advertised to clients | Google public STUN |

**Frontend** (`frontend/.env.local`, or Vercel env vars): `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_STUN_SERVER`, and the Clerk route variables. The frontend never receives a Supabase or database credential.

---

## Project structure

```text
.
├── backend/
│   ├── alembic/            # versioned schema migrations
│   ├── app/
│   │   ├── routers/        # thin REST handlers: users, profiles, meetings, schedules, participants,
│   │   │                   #   social (people, friends, blocks, notifications, invitations), waiting_room
│   │   ├── services/       # business rules for each area; storage, avatar image checks
│   │   ├── websocket/      # meeting socket, notification socket, lobby/connection manager
│   │   ├── security/       # field encryption, rate limiter, HTTP hardening
│   │   ├── database/       # engine, sessions, Row Level Security policies
│   │   ├── models/ schemas/ utils/ config/
│   │   └── main.py         # app factory, CORS, middleware, startup
│   ├── scripts/            # backup_db, migrate_sqlite_to_postgres, setup_supabase_storage, key generator
│   └── tests/              # pytest: REST, WebSocket, security, social, waiting room, RLS (opt-in)
├── frontend/src/
│   ├── app/                # /, /dashboard, /new-meeting, /join, /schedule, /profile, /settings, /meetings/[id]
│   ├── components/         # landing, dashboard, meeting, profile, social, layout, common, icons
│   ├── hooks/              # useMeeting, useWebRTC, useNotifications, useMyProfile, ...
│   ├── lib/ services/      # API client, WebSocket, WebRTC helpers, social/profile/waiting-room services
│   ├── styles/             # surface stylesheets on shared tokens
│   └── types/              # TypeScript mirrors of the backend schemas
├── docs/                   # architecture, database, deployment, design system
├── scripts/                # run-all / run-backend / run-frontend, e2e_probe.py
├── render.yaml             # Render blueprint (API)
└── .github/workflows/      # CI
```

---

## API overview

Full interactive documentation is served at `/docs`. All routes except `/health` need a Clerk token. `{meeting_id}` is the public nine-digit ID.

| Area | Endpoints |
|---|---|
| Meetings | `POST /api/meetings`, `GET/DELETE /api/meetings/{id}`, `POST /api/meetings/{id}/join`, `GET/POST /api/meetings/{id}/participants` |
| Schedules | `POST /api/schedules`, `GET /api/schedules/upcoming\|recent\|range`, `PATCH /api/schedules/{id}` |
| Profiles | `GET/PATCH /api/users/me/profile`, `PUT/DELETE /api/users/me/avatar`, `GET /api/users/{id}/profile`, `GET /api/users/username-available` |
| People | `GET /api/users/search`, `GET /api/users/discover` |
| Friends | `GET /api/friends`, `GET /api/friends/requests/incoming\|outgoing`, `POST /api/friends/requests`, `POST …/{id}/accept\|reject`, `DELETE …/{id}`, `DELETE /api/friends/{user_id}` |
| Blocking | `POST/DELETE /api/users/{id}/block`, `GET /api/blocks` |
| Notifications | `GET /api/notifications`, `PATCH /api/notifications/{id}/read`, `POST /api/notifications/read-all` |
| Invitations | `POST/GET /api/meetings/{id}/invitations`, `GET /api/invitations`, `POST /api/invitations/{id}/accept\|decline`, `DELETE /api/invitations/{id}` |
| Waiting room (host) | `GET/PATCH /api/meetings/{id}/waiting-room`, `POST …/{entry}/admit\|reject`, `POST …/admit-all` |
| Realtime | `WS /ws/meetings/{id}`, `WS /ws/notifications` |

Meeting socket messages: `join`, `leave`, `offer`, `answer`, `ice_candidate`, `meeting_state`, `media_state`, `screen_share`, `mute_participant`, `remove_participant`, `end_meeting`, `reaction`, `ping`; server events include `joined`, `waiting`, `admitted`, `rejected`, `waiting_room_updated` (host only), `participant_*`, `host_action`, `meeting_ended`, `error` (stable `code`, safe `message`).

---

## Security

Clerk is the only identity provider; the API verifies RS256 tokens (issuer, expiry, authorized party) and maps them to internal users. Authorization is enforced in the API and, optionally, again in PostgreSQL with Row Level Security. Details, limits and what is *not* claimed: [`SECURITY_ARCHITECTURE.md`](docs/architecture/SECURITY_ARCHITECTURE.md).

- **Layered encryption** (not end-to-end): HTTPS/TLS and WSS in transit; encrypted storage and backups on Supabase (verify for your plan); an AES-256-GCM field cipher with versioned keys and rotation in `app/security/crypto.py`. No column uses it yet. Meetly does **not** provide end-to-end encryption.
- Generate a key: `python backend/scripts/generate_encryption_key.py 1`. Keys live only in environment variables, never in the database or git.
- CORS is an explicit allow-list without credentials; WebSockets check the browser origin; request bodies, uploads, password guesses and common actions are size- or rate-limited.
- Avatars are checked by content, re-encoded to a 512 px WebP (stripping metadata) and served from a private bucket through short-lived signed URLs.

---

## Testing and CI

```bash
cd backend  && python -m pytest                 # SQLite suite; the PostgreSQL suites run separately, below
cd frontend && npm test                          # Vitest, jsdom
cd frontend && npm run typecheck && npm run lint && npm run build
python scripts/e2e_probe.py http://localhost:8000   # probe against a running backend
```

Row Level Security tests run on a real PostgreSQL in a throwaway schema and are skipped unless you opt in:

```bash
MEETLY_PG_TEST_URL=postgresql://user:pass@host:5432/db python -m pytest tests/test_rls_postgres.py -v
# add MEETLY_PG_TEST_SSLMODE=disable for a local, non-TLS server
```

Tests never touch a configured database (`tests/conftest.py` forces a temporary SQLite file). GitHub Actions runs backend (SQLite), backend on PostgreSQL (migrations up, down and up again, `alembic check`, RLS tests) and frontend (`typecheck`, `lint`, `test`, `build`).

---

## Deployment

Frontend on Vercel, API on Render (Docker, **single instance**: realtime state and rate limits are in process memory), database and avatar storage on Supabase, auth on Clerk. Step-by-step setup, every environment variable, the SQLite-to-Supabase cutover and rollback: [`docs/deployment/DEPLOYMENT_GUIDE.md`](docs/deployment/DEPLOYMENT_GUIDE.md).

---

## Documentation

| Document | Covers |
|---|---|
| [`IMPLEMENTATION_AUDIT.md`](docs/architecture/IMPLEMENTATION_AUDIT.md) | Original audit and findings |
| [`DATABASE_ARCHITECTURE.md`](docs/architecture/DATABASE_ARCHITECTURE.md) | Layers, connections, schema |
| [`SECURITY_ARCHITECTURE.md`](docs/architecture/SECURITY_ARCHITECTURE.md) | Auth, RLS, encryption, hardening |
| [`SOCIAL_NETWORKING_ARCHITECTURE.md`](docs/architecture/SOCIAL_NETWORKING_ARCHITECTURE.md) | Friends, blocking, notifications, invitations |
| [`WAITING_ROOM_ARCHITECTURE.md`](docs/architecture/WAITING_ROOM_ARCHITECTURE.md) | State machine, realtime events |
| [`MIGRATION_GUIDE.md`](docs/database/MIGRATION_GUIDE.md), [`BACKUP_AND_RECOVERY.md`](docs/database/BACKUP_AND_RECOVERY.md) | Moving data, backups |
| [`DEPLOYMENT_GUIDE.md`](docs/deployment/DEPLOYMENT_GUIDE.md) | Go-live checklist |
| [`ENVIRONMENTS_AND_MIGRATIONS.md`](docs/database/ENVIRONMENTS_AND_MIGRATIONS.md), [`INCIDENT_2026-11-12_SUPABASE_DEV_WIPE.md`](docs/database/INCIDENT_2026-11-12_SUPABASE_DEV_WIPE.md) | Environment separation, migration procedure, the data-loss investigation |
| [`SQLITE_TO_POSTGRES_MAPPING.md`](docs/database/SQLITE_TO_POSTGRES_MAPPING.md), [`LEGACY_INVITATIONS.md`](docs/database/LEGACY_INVITATIONS.md) | Cutover mapping, the unused legacy table |
| [`EMAIL_ENCRYPTION.md`](docs/security/EMAIL_ENCRYPTION.md), [`RLS_AUDIT.md`](docs/security/RLS_AUDIT.md), [`SECRET_ROTATION.md`](docs/security/SECRET_ROTATION.md) | Email encryption, RLS matrix, secret rotation |
| [`MULTI_INSTANCE_REALTIME.md`](docs/architecture/MULTI_INSTANCE_REALTIME.md), [`TURN_COTURN.md`](docs/deployment/TURN_COTURN.md), [`E2E_PLAN.md`](docs/testing/E2E_PLAN.md) | Scaling limits, TURN, browser E2E plan |
| [`design-system.md`](docs/design-system.md) | Tokens and components |

---

## Limitations

- **Peer-to-peer mesh with STUN only.** Suits small meetings; strict NATs need a TURN server and large rooms an SFU.
- **Single API instance.** Live connections and rate limits are in memory.
- **No end-to-end encryption**, chat, recording or captions. Online/offline presence is not implemented.
- Meeting settings other than the lock and the waiting room (mute on entry, unmuting, screen sharing, chat, host controls, recording) are still stored but not enforced.
- Row Level Security is installed but opt-in (`DATABASE_RLS_ENFORCE`); email encryption is staged (`dual` on the development database, `off` by default).
- TURN is **not configured** (STUN only), so calls can fail on strict networks until a TURN server is set up and tested.
- Real-browser two-user end-to-end tests have not been run yet ([`E2E_PLAN.md`](docs/testing/E2E_PLAN.md)).

---

## Roadmap

- Enforce the remaining meeting settings server-side.
- TURN support, and an SFU for larger rooms.
- Encrypt chosen sensitive fields (for example the account email, with a keyed hash for lookups).
- Presence, direct messaging and groups (the data model keeps identity, relationships and notifications independent so these can be added with migrations).
- Browser-level end-to-end tests.

---

## License

No license file is published yet, so all rights are reserved by the repository owner.
