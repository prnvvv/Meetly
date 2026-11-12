# Meetly end-to-end tests

Real browsers, real Clerk sessions (development instance), real WebRTC media. See `docs/testing/E2E_PLAN.md` for what is covered and how to run and clean up. These tests write to the **development** database and must never be pointed at production.

## Running

```bash
python support/clerk_users.py create        # three Clerk dev users: host, guest, third (ids go to the git-ignored .e2e-users.json)
export E2E_CHROMIUM_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe"   # optional: reuse an installed Chrome
npx playwright test                          # all suites; or name one: npx playwright test 05-social
cd ../backend && PYTHONPATH=. python ../e2e/support/cleanup_db.py --apply   # remove the rows the tests created
python ../e2e/support/clerk_users.py delete  # remove the Clerk users when finished
```

| Suite | Covers |
| --- | --- |
| 01-auth | sign-in, session persistence, protected requests |
| 02-room | waiting room, two-way audio/video (WebRTC stats) |
| 03-lifecycle | join, reload reconnect, leave, host ends, history |
| 04-schedule-isolation | scheduling UTC conversion/repeat/password, cross-user isolation |
| 05-social | friend requests, accept/reject/cancel, 7-day rejection cooldown, notifications read state, blocking, invitations to instant and scheduled meetings |
| 06-responsive | no horizontal overflow at 360 / 768 / 1280 px on every page; screenshots in `e2e/screens/` (git-ignored) |
| 07-host-controls | host mute/remove through the UI; a guest's raw-socket attempts are refused |
| 08-media-permissions | real browser camera/microphone denial and later grant; simulated missing/unplugged device |

Things that make a re-run fail for a good reason: a **rejected** friend request blocks the same sender for 7 days (a real product rule), and friend requests are limited to 30 per hour per user. Run `cleanup_db.py --apply` between runs, and restart the API if you hit the hourly limit. API calls from a laptop to a cloud database take 1-6 seconds each, so the social test needs several minutes.
