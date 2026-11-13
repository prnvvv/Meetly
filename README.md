<div align="center">

<img src="frontend/public/images/readme/readme-header.png" alt="Meetly: Meet, Collaborate and Stay Connected" width="100%">

<br>

**Video meetings with a personality.**
Start, schedule and join browser-based video meetings, with profiles, friends, invitations and a configurable waiting room.

<br>

[![CI](https://github.com/prnvvv/Meetly/actions/workflows/ci.yml/badge.svg)](https://github.com/prnvvv/Meetly/actions/workflows/ci.yml)
![Next.js](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs&logoColor=white)
![React](https://img.shields.io/badge/React-19-000000?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-000000?logo=typescript&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.162-000000?logo=fastapi&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Supabase-000000?logo=postgresql&logoColor=white)
![WebRTC](https://img.shields.io/badge/WebRTC-peer--to--peer-000000?logo=webrtc&logoColor=white)
[![License: MIT](https://img.shields.io/badge/License-MIT-000000)](LICENSE)

[Preview](#preview) &nbsp;·&nbsp; [Features](#features) &nbsp;·&nbsp; [Architecture](#architecture) &nbsp;·&nbsp; [Getting started](#getting-started) &nbsp;·&nbsp; [Deployment](#deployment) &nbsp;·&nbsp; [Contributing](#contributing)

</div>

---

## Preview

<div align="center">

<img src="frontend/public/images/readme/Screenshot%20(4).png" alt="Meetly landing page with the crowd illustration" width="100%">

<sub><b>Landing page.</b> A monochrome home with hand-drawn crowd illustrations; signed-in visitors go straight to the dashboard.</sub>

<br><br>

<table>
  <tr>
    <td width="50%" align="center" valign="top">
      <img src="frontend/public/images/readme/Screenshot%20(5).png" alt="Meetly dashboard with quick actions, month calendar, scheduled and recent meetings" width="100%">
      <br><sub><b>Dashboard.</b> Start, join or schedule a meeting, with the month calendar, upcoming meetings and history alongside.</sub>
    </td>
    <td width="50%" align="center" valign="top">
      <img src="frontend/public/images/readme/Screenshot%20(6).png" alt="Join a meeting page with device setup" width="100%">
      <br><sub><b>Join a meeting.</b> Paste an invite link or code, add a password if needed, and check camera, microphone and speaker first.</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center" valign="top">
      <img src="frontend/public/images/readme/Screenshot%20(9).png" alt="Schedule a meeting page" width="100%">
      <br><sub><b>Schedule a meeting.</b> Topic, date, time zone, duration, optional password and repeat, with friends to invite.</sub>
    </td>
    <td width="50%" align="center" valign="top">
      <img src="frontend/public/images/readme/Screenshot%20(10).png" alt="Live meeting room with the control bar" width="100%">
      <br><sub><b>Meeting room.</b> Live status, invite and copy-link actions, participants, reactions and the control bar.</sub>
    </td>
  </tr>
</table>

</div>

---

## About

Meetly is a full-stack web app for browser-based video meetings. People sign in, start or schedule a meeting, share an invite link, and talk over WebRTC. The backend handles accounts, meeting state and signaling; audio and video travel directly between browsers.

It is built to be small enough to read end to end: a Next.js frontend, a FastAPI backend, PostgreSQL on Supabase, and Clerk for sign-in.

---

## Features

**Meetings**
- **Instant meetings** with a server-generated nine-digit ID, a shareable invite link and an optional password (bcrypt-hashed, with guess limits).
- **Join** by meeting ID or by pasting an invite link. **Schedule** meetings, see them on a month calendar and edit them until they start.
- **Live rooms** with grid, speaker and auto layouts, pin-to-stage, active-speaker highlighting, reactions, fullscreen and keyboard shortcuts (`M` mute, `V` video, `P` participants, `F` fullscreen).
- **Host controls**: mute a participant, mute everyone, remove someone, end the meeting for all.
- **Waiting room** (per meeting, off by default): guests wait on a Meetly screen and the host admits, rejects or admits everyone, with live updates. Enforced by the server and survives reconnects and restarts. See [`WAITING_ROOM_ARCHITECTURE.md`](docs/architecture/WAITING_ROOM_ARCHITECTURE.md).

**People**
- **Profiles**: username, display name, photo, bio, role, organization, location, website and social links, with public, friends-only or private visibility enforced by the API.
- **Friends**: find people by username or name, send, accept, reject or cancel requests, remove friends, block and unblock.
- **Notifications**: friend requests, acceptances and meeting invitations, delivered live over a WebSocket hint and kept in the database.
- **Meeting invitations**: pick friends on *New Meeting* or *Schedule*, or use **Invite** inside a live meeting. Invitations never bypass the password or the waiting room.

**Account**
- Sign-in and sign-up through [Clerk](https://clerk.com). Every non-public route is protected and the API verifies the Clerk token on every request.

---

## Architecture

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
2. A per-meeting **WebSocket** (`/ws/meetings/{id}`) carries joins and leaves, SDP/ICE signaling, media state, reactions, host actions and the waiting room. A second small socket tells the browser when to refetch notifications.
3. **WebRTC** connects participants in a peer-to-peer mesh, using a public STUN server for NAT traversal.
4. **Identity** is always Clerk. The API turns the verified token into an internal user id; a client-supplied user id is never trusted.

On the client, one hook (`useMeeting`) owns the room lifecycle: join validation, media, socket, peer connections, the waiting phase and host actions.

---

## Tech stack

| Area | Technology |
|---|---|
| Frontend | Next.js 16 (App Router), React 19, TypeScript (strict) |
| Styling | Plain CSS on shared design tokens; Tailwind CSS 4 and GSAP on the landing page |
| Authentication | Clerk (`@clerk/nextjs`) |
| Real-time | Native WebSocket, WebRTC, Web Audio API |
| Backend | FastAPI, Pydantic 2, SQLAlchemy 2, Alembic, Uvicorn, bcrypt, Pillow, cryptography |
| Database | PostgreSQL on Supabase in production; SQLite for local development and tests |
| Storage | Supabase Storage (private bucket, signed URLs) for avatars |
| Testing | Vitest and Testing Library (frontend), pytest (backend, plus opt-in PostgreSQL Row Level Security tests), Playwright (`e2e/`) |
| Delivery | GitHub Actions, Dependabot, Docker (backend) |

---

## Getting started

**Prerequisites:** Node.js 22, Python 3.13 (3.10+ works), and a free [Clerk](https://dashboard.clerk.com) application for the sign-in keys. No database setup is needed locally: SQLite is used when `DATABASE_URL` is empty.

```bash
git clone https://github.com/prnvvv/Meetly.git
cd Meetly
```

### 1. Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate        # Windows (Git Bash): source .venv/Scripts/activate
pip install -r requirements.txt
cp .env.example .env             # then set CLERK_PUBLISHABLE_KEY (and CLERK_SECRET_KEY)
uvicorn app.main:app --reload --port 8000
```

`backend/.env` is loaded automatically (real environment variables win). The API is at <http://localhost:8000> with interactive docs at `/docs`. With SQLite the schema is created on startup, for local development only.

### 2. Frontend

```bash
cd frontend
cp .env.local.example .env.local   # then add your Clerk keys
npm install
npm run dev
```

Open <http://localhost:3000>, sign up, and start a meeting. Open the invite link in a second browser or profile to try a two-person call. Friends, invitations and the waiting room need two accounts.

> `bash scripts/run-all.sh` starts both services together. `scripts/run-backend.sh` and `scripts/run-frontend.sh` start them separately.

### Using Supabase locally

Fill the `DATABASE_*` and `SUPABASE_*` values in `backend/.env` (where to find each one is in [`DEPLOYMENT_GUIDE.md`](docs/deployment/DEPLOYMENT_GUIDE.md)), then:

```bash
cd backend
python -m alembic upgrade head           # creates/updates the schema (uses DATABASE_DIRECT_URL)
python scripts/setup_supabase_storage.py # creates the private avatar bucket (once)
```

> **Careful:** `backend/.env` then points at a real database. Do not run destructive commands from that folder. `alembic downgrade` is refused on non-SQLite databases for this reason.

### Database migrations

The schema is owned by **Alembic** (`backend/alembic/`). PostgreSQL is never created implicitly.

```bash
cd backend
python -m alembic upgrade head      # apply
python -m alembic current           # what is applied
python -m alembic check             # models and database agree
```

| Revision | Adds |
|---|---|
| 0001 | Baseline: users, meetings, participants, history |
| 0002 | Revokes Supabase browser-role access to Meetly tables |
| 0003 | User profiles |
| 0004 | Friend requests, friendships, blocks, notifications |
| 0005 | Meeting invitations |
| 0006 | Waiting room |
| 0007 | One participant row per user per meeting |
| 0008 | `meetly_app` role and Row Level Security policies |
| 0009 | Email encryption columns |
| 0010 | Rate-limit counters |
| 0011 | Least-privilege grants for Row Level Security |

Backups and recovery: [`BACKUP_AND_RECOVERY.md`](docs/database/BACKUP_AND_RECOVERY.md). Moving data from SQLite: [`MIGRATION_GUIDE.md`](docs/database/MIGRATION_GUIDE.md).

---

## Environment variables

Templates: [`backend/.env.example`](backend/.env.example) and [`frontend/.env.local.example`](frontend/.env.local.example). Real values never go in git (`.env*` is ignored). Only the Clerk publishable key, API URL and STUN server are meant for the browser; everything else stays server-side.

**Backend** (`backend/.env`, or Render environment variables)

| Variable | Purpose | Default |
|---|---|---|
| `APP_ENV` | `local`, `test`, `staging`, `production`. Production refuses unsafe settings (demo auth, non-https origins, missing Clerk authorized parties). | `local` |
| `AUTH_MODE` | `clerk` verifies tokens. `demo` skips auth (local and tests only). | `clerk` |
| `CLERK_PUBLISHABLE_KEY` | Public Clerk key; the JWKS URL and issuer are derived from it | none |
| `CLERK_SECRET_KEY` | Lets the API read a new user's name from Clerk (optional, secret) | none |
| `CLERK_AUTHORIZED_PARTIES` | Frontend origins allowed in the token (**required in production**) | none |
| `DATABASE_URL` | Runtime database. Empty means local SQLite. Supabase: transaction pooler (port 6543) | SQLite file |
| `DATABASE_DIRECT_URL` | Migrations: Supabase session pooler (port 5432) | none |
| `DATABASE_USE_POOLER` | `true` with the transaction pooler (disables prepared statements) | `false` |
| `DATABASE_POOL_SIZE`, `DATABASE_MAX_OVERFLOW` | Connection pool sizing | `5`, `5` |
| `DATABASE_SSL_MODE` | `require` or `verify-full` (production refuses `disable`) | `require` |
| `DATABASE_RLS_ENFORCE` | Run requests under Row Level Security as `meetly_app` | `false` |
| `DATABASE_TARGET_ENV`, `DATABASE_EXPECTED_REF` | Bind an environment to one Supabase project; every other database is refused ([`ENVIRONMENTS_AND_MIGRATIONS.md`](docs/database/ENVIRONMENTS_AND_MIGRATIONS.md)) | none |
| `MEETLY_ENV_FILE`, `MEETLY_CONFIRM_DB` | Pick another env file; confirm a staging or production schema or data command | none |
| `EMAIL_ENCRYPTION_MODE`, `FIELD_BLIND_INDEX_KEYS`, `FIELD_BLIND_INDEX_KEY_VERSION` | Encrypt account emails (`off`, `dual`, `encrypted`) with a separate HMAC index key ([`EMAIL_ENCRYPTION.md`](docs/security/EMAIL_ENCRYPTION.md)) | `off` |
| `FIELD_ENCRYPTION_KEYS`, `FIELD_ENCRYPTION_KEY_VERSION` | AES-256-GCM field-encryption keys (`version:key`) | none |
| `RATE_LIMIT_BACKEND` | `memory` or `database` (shared by all instances) | `memory` |
| `EMPTY_MEETING_GRACE_MINUTES`, `EMPTY_MEETING_SWEEP_SECONDS` | How long an empty active meeting may live (`0` disables) and how often it is checked | `10`, `60` |
| `TURN_URLS`, `TURN_SHARED_SECRET`, `TURN_CREDENTIAL_TTL` | Optional TURN relay with short-lived credentials ([`TURN_COTURN.md`](docs/deployment/TURN_COTURN.md)) | not configured |
| `LOG_FORMAT`, `LOG_LEVEL` | `json` or `text`, and level; secrets, tokens and emails are redacted | json in staging and production |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_AVATAR_BUCKET` | Avatar storage. **Server only**, never in the browser | bucket `avatars` |
| `FRONTEND_URL` | Allowed CORS origins and invite-link base (comma separated, https in production) | `http://localhost:3000` |
| `STUN_SERVER` | STUN server advertised to clients | Google public STUN |

**Frontend** (`frontend/.env.local`, or Vercel environment variables): `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_STUN_SERVER`, and the Clerk sign-in and sign-up route variables. The frontend never receives a Supabase or database credential. Production builds refuse to start with a missing, non-https or localhost API URL; see [`VERCEL_SETUP.md`](docs/deployment/VERCEL_SETUP.md).

---

## Project structure

```text
.
├── backend/
│   ├── alembic/            # versioned schema migrations
│   ├── app/
│   │   ├── routers/        # thin REST handlers: users, profiles, meetings, schedules, participants,
│   │   │                   #   social (people, friends, blocks, notifications, invitations), waiting_room
│   │   ├── services/       # business rules for each area
│   │   ├── websocket/      # meeting socket, notification socket, connection manager
│   │   ├── security/       # field encryption, rate limiter, HTTP hardening
│   │   ├── database/       # engine, sessions, Row Level Security policies
│   │   └── main.py         # app factory, CORS, middleware, startup
│   ├── scripts/            # backups, SQLite to Postgres, Supabase storage setup, key generator
│   └── tests/              # pytest: REST, WebSocket, security, social, waiting room, RLS (opt-in)
├── frontend/src/
│   ├── app/                # /, /dashboard, /new-meeting, /join, /schedule, /profile, /settings, /meetings/[id]
│   ├── components/         # landing, dashboard, meeting, profile, social, layout, common, icons
│   ├── hooks/              # useMeeting, useWebRTC, useNotifications, useMyProfile, ...
│   ├── lib/ services/      # API client, WebSocket, WebRTC helpers, domain services
│   ├── styles/             # surface stylesheets on shared design tokens
│   └── types/              # TypeScript mirrors of the backend schemas
├── e2e/                    # Playwright specs (need live Clerk and a running stack)
├── docs/                   # architecture, database, deployment, security, design system
├── scripts/                # run-all, run-backend, run-frontend, e2e_probe.py
├── render.yaml             # Render blueprint (API)
└── .github/                # CI workflow, Dependabot, issue and pull request templates
```

---

## Testing

```bash
cd backend  && python -m pytest                      # SQLite suite; PostgreSQL suites run separately, below
cd frontend && npm test                              # Vitest, jsdom
cd frontend && npm run typecheck && npm run lint
python scripts/e2e_probe.py http://localhost:8000    # probe against a running backend
```

Row Level Security tests run on a real PostgreSQL in a throwaway schema and are skipped unless you opt in:

```bash
MEETLY_PG_TEST_URL=postgresql://user:pass@host:5432/db python -m pytest tests/test_rls_postgres.py -v
# add MEETLY_PG_TEST_SSLMODE=disable for a local, non-TLS server
```

Tests never touch a configured database: `tests/conftest.py` forces a temporary SQLite file. GitHub Actions runs the backend suite, the backend on PostgreSQL (migrations up, down and up again, `alembic check`, Row Level Security tests) and the frontend (`typecheck`, `lint`, `test`, `build`). A production `npm run build` needs a deployment-shaped environment; set `MEETLY_SKIP_ENV_CHECK=1` for a local build.

---

## Security

Clerk is the only identity provider. The API verifies RS256 tokens (issuer, expiry, authorized party) and maps them to internal users. Authorization is enforced in the API and, optionally, again in PostgreSQL with Row Level Security. Details, limits and what is *not* claimed: [`SECURITY_ARCHITECTURE.md`](docs/architecture/SECURITY_ARCHITECTURE.md).

- Encryption is layered, not end-to-end: TLS and WSS in transit, encrypted storage on Supabase, and an AES-256-GCM field cipher with versioned keys. **Meetly does not provide end-to-end encryption.**
- CORS is an explicit allow-list without credentials; WebSockets check the browser origin; request bodies, uploads, password guesses and common actions are size or rate limited.
- Avatars are checked by content, re-encoded to a 512 px WebP (stripping metadata) and served from a private bucket through short-lived signed URLs.

To report a vulnerability, see [`SECURITY.md`](SECURITY.md).

---

## Deployment

| Part | Where |
|---|---|
| Frontend | Vercel |
| API | Render, Docker, **single instance** (realtime state and rate limits live in process memory) |
| Database and avatar storage | Supabase |
| Authentication | Clerk |

The Render blueprints are [`render.yaml`](render.yaml) and [`render.staging.yaml`](render.staging.yaml). Step-by-step setup, every environment variable, rollback and secret rotation are in [`docs/deployment/`](docs/deployment/README.md), starting with [`DEPLOYMENT_GUIDE.md`](docs/deployment/DEPLOYMENT_GUIDE.md).

---

## Documentation

| Document | Covers |
|---|---|
| [`DATABASE_ARCHITECTURE.md`](docs/architecture/DATABASE_ARCHITECTURE.md) | Layers, connections, schema |
| [`SECURITY_ARCHITECTURE.md`](docs/architecture/SECURITY_ARCHITECTURE.md), [`RLS_AUDIT.md`](docs/security/RLS_AUDIT.md) | Auth, Row Level Security, encryption, hardening |
| [`SOCIAL_NETWORKING_ARCHITECTURE.md`](docs/architecture/SOCIAL_NETWORKING_ARCHITECTURE.md) | Friends, blocking, notifications, invitations |
| [`WAITING_ROOM_ARCHITECTURE.md`](docs/architecture/WAITING_ROOM_ARCHITECTURE.md) | State machine, realtime events |
| [`MULTI_INSTANCE_REALTIME.md`](docs/architecture/MULTI_INSTANCE_REALTIME.md), [`TURN_COTURN.md`](docs/deployment/TURN_COTURN.md) | Scaling limits, TURN |
| [`ENVIRONMENTS_AND_MIGRATIONS.md`](docs/database/ENVIRONMENTS_AND_MIGRATIONS.md) | Environment separation and the migration procedure |
| [`E2E_PLAN.md`](docs/testing/E2E_PLAN.md) | Browser end-to-end test plan |
| [`design-system.md`](docs/design-system.md) | Tokens and components |
| [`REPOSITORY_AUDIT.md`](docs/maintenance/REPOSITORY_AUDIT.md) | Latest repository audit and open items |

---

## Known limitations

- **TURN relay is not implemented yet.** Calls are peer-to-peer with a public STUN server only. They work for participants on the same Wi-Fi/router or on networks that allow direct connections, but may fail (one-way or no audio/video) between participants on different Wi-Fi routers or strict NATs and firewalls. The backend already supports TURN and a ready-to-use coturn setup is in [`deploy/coturn`](deploy/coturn); it just needs a TURN server to be hosted and configured. See [`TURN_COTURN.md`](docs/deployment/TURN_COTURN.md).
- **Peer-to-peer mesh.** Suits small meetings; large rooms would need an SFU.
- **Single API instance.** Live connections and rate limits are in memory.
- **No end-to-end encryption**, chat, recording or captions. Online and offline presence is not implemented.
- Meeting settings other than the lock and the waiting room (mute on entry, unmuting, screen sharing, chat, host controls, recording) are stored but not enforced.
- Row Level Security is installed but opt-in (`DATABASE_RLS_ENFORCE`); email encryption is staged and off by default.
- Real-browser, two-user end-to-end tests have not been run yet.

---

## Roadmap

**Built**
- [x] Instant, scheduled and password-protected meetings with invite links
- [x] Live rooms with host controls and an enforced waiting room
- [x] Profiles, friends, blocking, notifications and meeting invitations
- [x] Clerk authentication, Alembic migrations, optional Row Level Security
- [x] Backend and frontend test suites and CI

**Planned**
- [ ] Enforce the remaining meeting settings on the server
- [ ] TURN support, and an SFU for larger rooms
- [ ] Encrypt chosen sensitive fields, such as the account email
- [ ] Presence, direct messaging and groups
- [ ] Browser-level end-to-end test runs

---

## Contributing

Contributions are welcome. Read [`CONTRIBUTING.md`](CONTRIBUTING.md) for the branch, commit and test conventions, and open an issue before starting anything large. Pull requests use the repository template.

## License

Released under the [MIT License](LICENSE). The license covers the Meetly source code; third-party dependencies keep their own licenses.
