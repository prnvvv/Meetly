# TURN relay (coturn)

**Status: code is ready; no TURN server exists yet, so TURN is NOT configured or tested.** Today Meetly uses a public Google STUN server only. STUN lets two browsers discover their public addresses; it cannot relay media. When both sides are behind symmetric NATs, corporate firewalls or networks that block UDP, a direct peer-to-peer path does not exist and the call fails unless a TURN server relays the media. Do not assume STUN alone works everywhere.

## What the application does now
- `GET /api/webrtc/ice-servers` (signed-in users, rate limited) returns STUN and, **if** `TURN_URLS` and `TURN_SHARED_SECRET` are set, a TURN entry with **short-lived credentials** (`username = <expiry>:<user id>`, `credential = base64(HMAC-SHA1(secret, username))`, the scheme coturn calls `use-auth-secret`). The shared secret never reaches a browser; credentials expire after `TURN_CREDENTIAL_TTL` (default 1 h).
- The room fetches this on every join and builds its peer connections from it (`frontend/src/lib/webrtc.ts`). If the endpoint fails, the previous STUN-only configuration is used unchanged.
- Tested: credential format against coturn's algorithm, expiry, per-user uniqueness, secret never returned, rate limit, frontend merge/fallback.

## What you need to provide
A host that can accept **UDP** (and TCP/TLS) from the internet. Render web services cannot, so TURN runs elsewhere:
| Option | Notes |
| --- | --- |
| Small VPS (Hetzner, DigitalOcean, Oracle Cloud always-free tier) running coturn | Full control, a few euros a month or free on Oracle. Needs a public IP and open ports. |
| Managed TURN (Cloudflare Calls TURN, Twilio Network Traversal, Metered free tier) | No server to run; usage limits; different credential API (would need a small adapter instead of `use-auth-secret`). |

You choose; I will not buy or create a service.

## coturn configuration (self-hosted)
`/etc/turnserver.conf`:
```
listening-port=3478
tls-listening-port=5349
fingerprint
use-auth-secret
static-auth-secret=<the same value as TURN_SHARED_SECRET>
realm=turn.example.com
server-name=turn.example.com
total-quota=100
user-quota=12
no-multicast-peers
no-cli
no-tlsv1
no-tlsv1_1
cert=/etc/letsencrypt/live/turn.example.com/fullchain.pem
pkey=/etc/letsencrypt/live/turn.example.com/privkey.pem
min-port=49160
max-port=49200
# never relay into private networks (SSRF protection)
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
```
Open on the firewall: UDP/TCP 3478, TCP 5349 (TLS), UDP 49160-49200 (relay range). Generate the secret with `openssl rand -base64 32`; keep it only in the coturn config and the API's `TURN_SHARED_SECRET`.

API environment (Render): `TURN_URLS=turn:turn.example.com:3478?transport=udp,turns:turn.example.com:5349?transport=tcp`, `TURN_SHARED_SECRET=...`, `TURN_CREDENTIAL_TTL=3600`.

## How to PROVE it works (required before calling TURN configured)
1. Credentials: `curl -H "Authorization: Bearer <token>" <api>/api/webrtc/ice-servers` shows a TURN entry whose username starts with a future unix time.
2. Server: `turnutils_uclient -u <username> -w <credential> -y turn.example.com` allocates and relays.
3. Browser, forced relay: temporarily set `iceTransportPolicy: "relay"` (a debug build or the console on `chrome://webrtc-internals`) and confirm the selected candidate pair is of type `relay` and audio/video still flows between two browsers on different networks.
4. Hostile network: repeat from a phone hotspot against a UDP-blocking network (or a corporate VPN) and confirm the call connects over `turns:` (TCP 5349).
5. Expiry: a credential older than its TTL must be rejected by coturn.
Only after 1-5 pass may this be reported as tested.

## Security notes
Short-lived credentials limit abuse if one leaks; per-user quotas stop a single account hogging relay bandwidth; the denied-peer ranges stop the relay being used to reach internal networks; monitor relay bandwidth (it is the one component whose cost scales with media).
