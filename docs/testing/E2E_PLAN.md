# Real-browser, two-user end-to-end plan

**Status: NOT run.** Everything below needs your approval first because it creates and later deletes test accounts in your Clerk **development** instance and installs a browser test runner. Until it is done, anything that depends on real Clerk sessions, real WebRTC media or a browser (the UI of the new Invite friends states, the waiting-room screens, RLS through the UI) is verified only by component tests and API/WebSocket tests, not in a browser.

## What I need from you (one approval)
1. Permission to create **two clearly named test users** in the Clerk development instance (`e2e-host`, `e2e-guest`, emails ending `+clerk_test@example.com`, which Clerk treats as test addresses) using the existing development secret key, and to **delete them again** at the end.
2. Permission to install Playwright and its Chromium build as a dev dependency of `frontend/` (about 150-200 MB download).
3. Confirmation that the end-to-end run may write test accounts and a few test meetings into the **development** Supabase project (they are removed afterwards), or a staging project to use instead. If a staging project and Clerk instance exist, use those.

## How a real Clerk session is obtained (no password, no 2FA)
The Clerk Backend API creates a one-time **sign-in token** for each test user. The browser opens the app with that token (`?__clerk_ticket=...`), Clerk's own front-end code exchanges it for a real session, and from then on the page sends real session tokens to the API exactly as for a human. Nothing in the app is bypassed: the backend verifies the same RS256 token it verifies in production.

## Environment
Two Playwright browser contexts (separate cookies and storage, so two identities), Chromium started with `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream` so camera and microphone permissions are granted and each page produces a test video pattern and an audio tone. The local frontend and backend run against the chosen database.

## Scenarios (each asserts persistence after a page refresh)
1. Both users sign in with real Clerk sessions; `GET /api/users/me` returns two different internal ids; each sees only their own profile data.
2. Profile: host edits bio and privacy, refreshes, values persist; guest sees only what the privacy setting allows.
3. Friends: guest finds the host by username, sends a request; the host's bell updates **without a reload** (WebSocket hint); host accepts; both lists show each other; block/unblock works; blocked user vanishes from search.
4. Schedule Meeting page: empty state for a user with no friends is a full-width block with the Find friends action (screenshot at 360, 768 and 1280 px; no narrow-column text); with a friend, the friend is selectable, removable and, after scheduling, shows as invited.
5. Invitation: host invites the friend from the schedule page and again from inside a live meeting (Invite button); duplicate invitation is refused; the guest accepts from the bell and joins.
6. Waiting room: host creates a meeting with the waiting room on; the guest opens the link and sees the waiting screen; the host sees the request instantly, admits; the guest enters. Repeat with reject (guest cannot re-enter). Refresh the guest tab while waiting; reconnect while the host admits; host refreshes mid-wait; toggle the waiting room off during the wait; end the meeting while someone waits.
7. **Media**: after both are in the room, read `RTCPeerConnection.getStats()` in each page twice 3 s apart and assert **inbound audio and inbound video `bytesReceived` and `framesDecoded` increase** on both sides (real media, not just a connected state). Record the selected candidate-pair type (`host`, `srflx`, `relay`).
8. Controls: host mutes the guest, removes the guest, ends the meeting; the guest is returned to the correct screen; the meeting appears in Recent with the right participant count.
9. Cleanup: end meetings, delete both Clerk users, delete their rows from the development database (explicitly listed, never a bulk delete).

## TURN
Scenarios 7 and a forced-relay variant (`iceTransportPolicy: "relay"`) can only pass once a TURN server exists (`docs/deployment/TURN_COTURN.md`). Until then the relay variant is expected to fail and TURN stays "not configured".

## Responsive check of the new Invite friends section
At 360, 768, 1024 and 1280 px: no horizontal page scroll, the empty-state text never narrower than about 12 characters per line, the action buttons wrap instead of overflowing, the More button stays right-aligned beside the friends row.
