# Social Networking Architecture (foundation)

Scope: profiles, people search, friend requests, friendships, blocking, notifications. Not included: messaging, communities, feeds, following, presence.

## Data model (migrations 0003, 0004)

| Table | Purpose | Key constraints |
| --- | --- | --- |
| `user_profiles` | Public identity, 1:1 with `users` | PK `user_id`; `username` unique, lowercase CHECK; visibility CHECK |
| `friend_requests` | Request lifecycle | CHECK sender<>receiver; **partial unique index** on `(pair_low, pair_high)` WHERE `status='PENDING'` |
| `friendships` | Accepted friendships | one row per pair, `user_low_id < user_high_id` CHECK, unique pair |
| `user_blocks` | Blocks | unique `(blocker, blocked)`, CHECK not self |
| `notifications` | In-app feed | unique `dedupe_key`; `expires_at`; open `type` string; minimal JSON payload (`actor_id`) |

Identity (`users`) stays independent of friendship; relationships reference users only; notifications reference entities by type and id, so new features add rows and types, not columns.

## Request lifecycle

`PENDING -> ACCEPTED | REJECTED | CANCELLED` (terminal). Only the receiver accepts or rejects; only the sender cancels. Repeating an action that already took effect is idempotent (accept twice = one friendship, one notification); a different terminal state returns 409.

**Simultaneous requests (A to B and B to A at once):** the partial unique index allows one pending row per unordered pair. One insert wins; the loser re-reads, sees the winner's request from the other direction and accepts it. Result: exactly one friendship, no duplicate rows. Verified with concurrent threads in the test-suite and against real PostgreSQL. Sending to someone who already requested you accepts their request directly.

**Policy decisions**
- Rejections are silent (no notification) and block the same sender from re-requesting that person for 7 days.
- Cancelling removes the receiver's notification.
- Private profiles and blocked users cannot be requested; the answer is the same "not found" as for a missing user.
- Removing a friend sends no notification.

## Blocking policy
Blocking removes the friendship, cancels pending requests in both directions, hides each user from the other (search, profile, notifications), and prevents new requests and invitations. It does **not** remove anyone from a meeting they are already in; the host controls a live room.

## Privacy rules (enforced server-side)
Profile views: `public` is full for any signed-in user; `friends` is full for friends and a minimal card (name, username) for others; `private` returns 404 to everyone but the owner. Avatars are signed only when the viewer may see the full profile. Search excludes self, private profiles (unless already a friend), and blocked users in either direction. No endpoint returns email addresses or Clerk ids.

## Notifications
`GET /api/notifications` (cursor pagination by id, unread filter, unread count), `PATCH /api/notifications/{id}/read` (own only, otherwise 404), `POST /api/notifications/read-all`. Creation uses a `dedupe_key` (for example `friend_request:42`) so retries never duplicate. Expired rows are hidden immediately.

**Realtime:** `WS /ws/notifications`, authenticated by the first message `{"type":"auth","token":...}` (never the URL). The server only pushes `{"type":"notifications_changed"}`; the client refetches over REST, so no private data travels on the socket. At most 5 sockets per user. The client also polls every 60 s and on tab focus, so a dropped socket is harmless. This reuses the existing FastAPI/Starlette WebSocket stack with a separate per-user registry (the meeting socket is per-meeting).

## API summary
`GET /api/users/search`, `GET /api/users/discover`, `GET /api/friends`, `GET /api/friends/requests/incoming|outgoing`, `POST /api/friends/requests`, `POST /api/friends/requests/{id}/accept|reject`, `DELETE /api/friends/requests/{id}`, `DELETE /api/friends/{user_id}`, `POST|DELETE /api/users/{user_id}/block`, `GET /api/blocks`, notifications as above. All require a verified Clerk token; the acting user always comes from the token. Search is rate-limited (40/min), requests (30/hour), blocks (30/min).

## Known limits
- Rate limiting is in-process (single instance). Replace the store if the API is scaled out.
- `discover` suggests people from shared meetings only.
- Presence (online/offline) is intentionally not implemented; the invite picker shows `@username` instead of a fake status.

## Meeting invitations (migration 0005)

Table `meeting_invitations` (one row per `(meeting, invitee)`, unique), replacing the unused free-text `invitations` table, which is left in place and untouched. States: `PENDING -> ACCEPTED | DECLINED | CANCELLED | EXPIRED`.

| Endpoint | Rule |
| --- | --- |
| `POST /api/meetings/{id}/invitations` `{user_ids: [..]}` | Inviter must be the host or someone who has joined. Meeting must be scheduled or active. Invitees must be the inviter's friends and not blocked either way. 1-50 per call. Per-person result: `invited`, `reinvited`, `already_invited`, `unavailable` (not a friend, blocked, yourself, host, unknown; deliberately indistinct). |
| `GET /api/meetings/{id}/invitations` | Host sees all; a participant sees only the ones they sent; everyone else gets 404. |
| `GET /api/invitations` | The signed-in user's received invitations (pending by default), with meeting title, time and `has_password`. |
| `POST /api/invitations/{id}/accept` / `decline` | Invitee only (anyone else gets 404). Idempotent. Accepting returns `meeting_id`, `has_password`, `joinable_now`. Decline is silent. |
| `DELETE /api/invitations/{id}` | Inviter or host withdraws a pending invitation; the invitee notification disappears. |

Behaviour:
- **No bypass.** An invitation grants nothing: the invitee still passes the normal join checks (password, lock, and the waiting room once enabled). The password hash is never returned, only `has_password`, and the join page asks for the password.
- **Expiry** is lazy: a pending invitation is treated as expired once the meeting window has passed (instant meetings: 24 h; scheduled: start + duration, max 7 days). Expired or ended-meeting invitations cannot be accepted (409) and can be re-sent.
- **Duplicates and retries:** repeated or concurrent invites produce one row and one notification (verified with 4 simultaneous requests on real PostgreSQL). Re-inviting after decline/cancel/expiry resets the row and sends exactly one new notification.
- **Blocking** withdraws pending invitations in both directions and prevents new ones; already accepted invitations and live meeting participation are not touched.
- **Notifications:** `meeting_invitation` (to the invitee, with Join/Decline in the bell) and `meeting_invitation_accepted` (to the inviter). Payload carries only the actor id, public meeting id and title.
- **UI:** New Meeting and Schedule send real invitations for the friends picked in the existing picker. A failed invite never blocks creating the meeting; the user is told.
