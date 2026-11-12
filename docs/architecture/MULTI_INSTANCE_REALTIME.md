# Rate limits, real-time state and running more than one API instance

**Verdict: Meetly's real-time layer supports exactly ONE API process. It must not be scaled out yet.** This document records what was analysed, what was made multi-instance safe, what was not, the options, and the plan. Nothing here claims horizontal scalability; none has been tested.

## What lives in process memory (verified in the code)
| State | Where | Effect with 2+ instances |
| --- | --- | --- |
| Live meeting connections and screen-share owner | `ConnectionManager._meetings` / `_screen_sharing` | A participant connected to instance A never receives broadcasts, signaling (offer/answer/ICE), media-state or reaction events from a participant on B. Calls fail silently. |
| Waiting-room lobby sockets | `ConnectionManager._lobby` | A host admitting through instance A cannot reach a guest whose socket is on B: the guest keeps waiting (until a reconnect re-reads the durable state). Host updates reach only host sockets on the same instance. |
| Notification sockets | `user_channel._sockets` | Hints are lost for sockets on another instance (the 60 s poll and focus refetch still catch up). |
| Host actions (mute / remove / end meeting) | same managers | Affect only same-instance connections. |
| Rate-limit counters | now selectable (below) | Per instance by default. |
| Everything durable (meetings, participants, waiting-room entries, invitations, notifications) | the database | Correct across instances, including after reconnect. |

## What was made safe for several instances
- **Rate limits**: `RATE_LIMIT_BACKEND=database` keeps fixed-window counters in `rate_limit_counters` (migration 0010), one atomic upsert per check, shared by all instances, no extra infrastructure. Tested for atomicity under concurrency on SQLite and a real PostgreSQL; falls back to the in-process limiter, with a log line, if the database is unavailable. Trade-off: a fixed window can allow up to 2x the limit across a window boundary. Default stays `memory` (exact sliding window) while there is one instance.
- **Durable waiting-room and membership state**: already database-backed, so a reconnect on any instance recovers the correct state.
- **Deployment guard**: production start-up refuses `WEB_CONCURRENCY` or `UVICORN_WORKERS` greater than 1; `render.yaml` pins `numInstances: 1`; the Dockerfile runs one uvicorn process.

## What is NOT multi-instance safe (needs a shared event bus)
The connection registries and every broadcast above. A cross-instance bus must carry: room broadcasts, participant-targeted signaling, host-only events, lobby messages, "close this meeting", and the notification hints.

## Options evaluated
| Option | Fit | Concerns |
| --- | --- | --- |
| **PostgreSQL LISTEN/NOTIFY** (already installed) | No new service. Good for small control events (admitted, host update, hints). | Payload limit is ~8 kB and an SDP offer can exceed it; needs a session-mode/direct connection (not the transaction pooler) per instance; no delivery guarantee if a listener is disconnected. Unsuitable for signaling on its own. |
| **Supabase Realtime Broadcast** (already part of the Supabase project) | Managed pub/sub, no servers to run, authenticated with the project keys. | Adds a client library and a network hop per event; free-tier connection and message quotas; the service-role key would also authorise broadcasting (keep it server-side); not yet exercised from this backend. |
| **Redis pub/sub** (self-hosted or a free managed tier) | The standard answer: low latency, large payloads, simple fan-out. | One more service and dependency to run, secure and pay attention to; needs a decision from you. |
| **Sticky routing by meeting id** | Would avoid a bus. | Render offers no per-meeting routing. Not viable here. |

## Recommendation and plan
1. **Stay on one instance** until load requires otherwise (a single Render instance serves rooms of the size this mesh-WebRTC design supports anyway).
2. When scaling is needed: introduce a `RealtimeBus` interface (`publish(channel, event)` / `subscribe(channel)`) with the current behaviour as the default `LocalBus`, route every `ConnectionManager` send through it, and implement **Redis** (preferred; payload size) or Supabase Realtime Broadcast. Keep one channel per meeting plus one per user.
3. Before claiming support, test with **two real uvicorn processes sharing one database**: host on A and guest on B (admit reaches the guest), signaling between participants on different instances, a host removing a participant on the other instance, ending a meeting, and instance restarts mid-meeting.
4. Switch `RATE_LIMIT_BACKEND=database` at that point (or earlier if you want limits to survive restarts).

Decision needed from you before step 2: Redis (new service) or Supabase Realtime Broadcast (no new service, new quotas and a client library).
