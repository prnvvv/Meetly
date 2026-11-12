# Waiting Room Architecture

Status: implemented (migration 0006). Configurable per meeting; **off by default**.

## Configuration and backward compatibility
- `meetings.waiting_room_enabled BOOLEAN NOT NULL DEFAULT false` and `meetings.admission_mode` (`host_approval`).
- Existing meetings get `false` from the migration. Their admission behaviour is unchanged.
- The legacy `settings.waitingRoom` JSON key existed in the UI but was **never enforced**. It is deliberately **not** migrated into the new column, so no old meeting silently starts requiring approval. The API now reports the enforced value in `settings.waitingRoom` (so the UI shows what is true).
- New meetings: the existing "Waiting room" toggle on New Meeting / Schedule sets the column at creation. The host can switch it live from the participants panel (`PATCH /api/meetings/{id}/waiting-room {enabled}`).
- Turning it **on** mid-meeting does not eject anyone: people who already have a participant row are grandfathered in. Turning it **off** admits everyone currently waiting.
- Precedence on join: meeting ended/not joinable -> password -> lock -> waiting room. The host never waits.

## State machine (`waiting_room_entries`, one row per user per meeting)
```
WAITING  -> ADMITTED | REJECTED | LEFT
ADMITTED -> JOINED   | LEFT
JOINED   -> LEFT     | REMOVED
LEFT     -> WAITING            (leaving on purpose = ask again)
REJECTED, REMOVED: terminal for that meeting
```
Enforced in one table in `waiting_room_service.py` (unit-tested) and by a CHECK constraint on the column. Every change is an atomic `UPDATE ... WHERE state = <expected>`, so repeated or simultaneous admits change the row once (verified with concurrent requests, including on real PostgreSQL: 5 simultaneous admits -> exactly one change; 4 simultaneous first requests from one guest -> one row). Repeating an action that already took effect is a harmless no-op (`changed: false`); a conflicting one is 409.

## Durable state vs connection state
| Durable (database) | Temporary (memory) |
| --- | --- |
| Who is waiting, admitted, rejected, joined, left, removed; who decided and when | Which sockets are connected; the lobby registry; heartbeats (never written to the database) |

Consequences:
- **Backend restart:** WAITING rows survive; the guest clients reconnect and re-send `join`, which finds the same row (no duplicate). Entries whose client never comes back are swept to LEFT after 90 s when the host list is read. ADMITTED / JOINED / REJECTED / REMOVED survive untouched, so an admitted guest whose connection dropped before entering is let in on reconnect without a second approval.
- **Dropped waiting connection:** the place is given up (WAITING -> LEFT) only if that socket is still the registered one, so a fast reconnect is never clobbered.
- **Reconnect of someone already inside:** goes straight in (state JOINED). An explicit Leave requires asking again.

## Realtime (existing meeting socket, no new transport)
Guest to server: normal `join` (with token); `leave` while waiting. Server to guest: `waiting {meeting:{title, host_name}}`, `admitted` (client re-sends `join` on the same connection), `rejected`, or error `NOT_ADMITTED`, `meeting_ended`. Host connections only: `waiting_room_updated {enabled, entries:[{id, display_name, username, requested_at}]}`.

Privacy: waiting people sit in a separate lobby registry, so no room broadcast (joins, leaves, reactions, signaling) can reach them; they only receive messages about themselves and may not use any room message (`NOT_A_PARTICIPANT`). Host-private details go to host connections only, never the room. The host sees the verified `@username` next to the typed name; no email or account id is sent.

## REST (host-only, enforced on the server; non-hosts get 403, anonymous 401)
`GET /api/meetings/{id}/waiting-room`, `PATCH` (enable/disable), `POST .../{entry_id}/admit`, `POST .../{entry_id}/reject`, `POST .../admit-all`. Entries from another meeting are not addressable (404). Removing a joined participant (existing host action) now also records REMOVED so they cannot walk back in while the waiting room is on.

## UI
Guest: a full-room screen in the same style as "meeting ended / removed", showing only the meeting title and host name, a Leave button, and a Reconnect button if the connection is lost. Host: a "Waiting room" block at the top of the existing participants panel (switch, list with Admit / Reject, Admit all), a count badge on the participants button, and a toast when someone arrives.

## Also fixed here (existing bug)
A signed-in person who had not joined yet (an invited friend, or a waiting guest) got 403 from the participants list when opening the room page, which blocked them from reaching the join step. The room page now treats that 403 as "empty for now"; the live roster arrives over the socket once they are in. The API stays strict.

## Known limits
- Demo auth mode (`AUTH_MODE=demo`, local/tests only) has no user identity, so the waiting room is not enforced there.
- A REST "end meeting" call does not push to waiting sockets (the WebSocket "end meeting" does); a guest in that case finds out on the next join attempt.
- Admission is by identity: the same person on two devices shares one entry.
