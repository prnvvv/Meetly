# Meetly — Frontend

Next.js (App Router) + TypeScript client for Meetly. See the [root README](../README.md) for setup.

## Requirements

- Node.js 20.9+
- The FastAPI backend running (default `http://localhost:8000`)

## Setup

```bash
cd frontend
npm install
cp .env.local.example .env.local
npm run dev
```

Open http://localhost:3000 — the root route redirects to `/dashboard`.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint |
| `npx tsc --noEmit` | TypeScript check |

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000` | REST + WebSocket origin |
| `NEXT_PUBLIC_STUN_SERVER` | `stun:stun.l.google.com:19302` | WebRTC STUN server |

## Routes

| Route | Purpose |
| --- | --- |
| `/` | Redirects to `/dashboard` |
| `/dashboard` | Home: quick actions, upcoming and recent meetings |
| `/new-meeting` | Creates an instant meeting and enters the room |
| `/join` | Enter a meeting ID or invite link, preview, join |
| `/schedule` | Schedule a future meeting |
| `/meetings/[meetingId]` | Meeting room (WebRTC + WebSocket) |
| `/settings` | Settings placeholder |

## Architecture

```
src/app         routes and global styles
src/components  UI (layout, dashboard, meeting, common, icons)
src/hooks       useMeeting, useWebRTC, useWebSocket, useMediaDevices, ...
src/services    REST calls (meeting, schedule, participant, user)
src/lib         api client, websocket client, webrtc helpers, validators
src/types       types mirroring the backend contracts
src/context     meeting and media contexts
src/store       meeting state store
```

Media (audio, video, screen share) travels browser-to-browser over WebRTC.
The backend only relays signaling and owns participant/host state.
