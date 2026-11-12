# WebRTC: STUN, TURN and what was actually tested

**Status: STUN works in the application. TURN is implemented and configurable but NO TURN server exists, so TURN is not configured and not tested against a real relay. This is a manual infrastructure requirement.**

## What STUN and TURN do

- **STUN** lets each browser learn its public address so two browsers can connect directly. It carries no media. Meetly uses `stun:stun.l.google.com:19302` by default (`STUN_SERVER` / `NEXT_PUBLIC_STUN_SERVER`).
- **TURN** relays the media when no direct path exists (symmetric NAT, corporate firewalls, networks that block UDP). Without it, those users cannot join a call. Roughly 10-20 % of real-world connections need it; for a personal-use deployment among a few known people it may never matter, but you cannot know before someone fails to connect.

## What the code does (READY)

| Piece | Behaviour |
| --- | --- |
| `GET /api/webrtc/ice-servers` | signed-in users only, rate-limited. Returns STUN, plus TURN **when configured**. |
| coturn mode | `TURN_URLS` + `TURN_SHARED_SECRET`: per-user credentials that expire (`TURN_CREDENTIAL_TTL`, default 3600 s): username `<expiry>:<user id>`, password `base64(HMAC-SHA1(secret, username))`. The shared secret never leaves the server. |
| Managed-provider mode | `TURN_URLS` + `TURN_USERNAME` + `TURN_CREDENTIAL`: one fixed pair returned to **signed-in users only**. Used only when `TURN_SHARED_SECRET` is empty. A fixed pair is more exposed than an expiring one; prefer providers that issue short-lived credentials if you have the choice (that would need a small adapter). |
| UDP and TCP | list several URLs, for example `turn:t.example.com:3478?transport=udp,turn:t.example.com:3478?transport=tcp,turns:t.example.com:5349?transport=tcp` |
| Fallback | no TURN variables -> STUN only. If the endpoint fails or the user is offline of it, the browser keeps the STUN-only configuration (`frontend/src/services/iceService.ts`). A half-configured TURN (URLs without credentials) is ignored, not half-applied. |
| Credentials on the page | the API returns them only to authenticated users; they are never in the JavaScript bundle or in environment variables with a `NEXT_PUBLIC_` prefix. |

Unit/integration tested: credential format against coturn's algorithm, expiry, per-user uniqueness, static-pair mode, partial configuration, the secret never being returned, rate limit, frontend merge and fallback (`backend/tests/test_webrtc_config.py`, `frontend/src/services/iceService.test.ts`).

## Render cannot host TURN

A TURN server needs inbound **UDP** (3478, a relay port range) and ideally TLS on 5349/443. Render web services accept HTTP(S)/WebSocket traffic only, so TURN must run elsewhere. Do not try to proxy it through the API.

## Options (you choose; nothing here buys anything)

| Option | Cost | Effort | Notes |
| --- | --- | --- | --- |
| Self-hosted **coturn** on a small VPS (Hetzner, DigitalOcean, Oracle Cloud always-free) | a few euro/month or free tier | install, certificate, firewall | full control, expiring credentials work as coded. Configuration: `TURN_COTURN.md`. |
| Managed TURN with a free tier (for example Metered, Cloudflare Calls TURN) | free tier with limits, then usage billed | create account, copy URLs and credentials | use `TURN_USERNAME`/`TURN_CREDENTIAL`; check the free-tier bandwidth before relying on it. |
| Do nothing | free | none | acceptable for a few users on ordinary networks; some people will not connect. |

## Turn it on (after you have a server)

1. Render -> service -> Environment: `TURN_URLS`, and either `TURN_SHARED_SECRET` or `TURN_USERNAME` + `TURN_CREDENTIAL`. Save (the service restarts).
2. `curl -H "Authorization: Bearer <a signed-in user's token>" https://<api>/api/webrtc/ice-servers` -> contains a TURN entry and `"turn_enabled": true`.
3. Prove it (all of `TURN_COTURN.md` "How to PROVE it works"): force `iceTransportPolicy: "relay"` in a test build and confirm the selected candidate pair type is `relay` with audio and video flowing, from two different networks (phone hotspot vs home Wi-Fi), once over UDP and once over `turns:` TCP.

## What was tested and what was not

| Check | Evidence |
| --- | --- |
| ICE candidates gathered, offer/answer through the signalling WebSocket, two-way audio and video byte/frame counters growing, reload reconnection, leave/end | **Real browsers** (two independent Chrome contexts with real Clerk sessions, fake camera/microphone) - `e2e/tests/02-room`, `03-lifecycle`. |
| Candidate pair types in those runs | `host`/`prflx` on **one machine**. That proves signalling and media plumbing, **not** NAT traversal. |
| STUN reachability and server-reflexive candidates | see the testing report; the Google STUN server was reachable from the test machine only if listed there. |
| Real different-network call, TURN relay, mobile networks, hostile firewalls | **NOT tested.** Needs two real networks and a TURN server. Do not claim NAT traversal from same-machine results. |
| Camera/microphone denied, device missing, device removed mid-call | see the testing report (real browser permission states). |

## Do not

- Put TURN credentials in `NEXT_PUBLIC_*` variables, the frontend repository or screenshots.
- Expose a TURN server without the `denied-peer-ip` ranges (it would let anyone reach your internal network through it): see `TURN_COTURN.md`.
