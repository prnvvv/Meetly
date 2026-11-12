# Deployment verification

Run after every deployment, first on staging, then production. Use two separate accounts (A and B), ideally on two devices or one normal and one private window. Stop at the first failure and use `ROLLBACK_GUIDE.md` if it affects users.

## 1. Infrastructure (2 minutes)

| Check | Command / action | Expected |
| --- | --- | --- |
| API alive | `curl -s https://<api>/health` | `{"status":"ok"}` |
| API ready | `curl -s https://<api>/health/ready` | `status: ok`, `database`, `schema`, `encryption_config` all `true` |
| Auth enforced | `curl -s -o /dev/null -w "%{http_code}" https://<api>/api/users/me` | `401` |
| CORS | open the site, browser console | no CORS errors; requests go to the Render host |
| Frontend bundle | see `VERCEL_SETUP.md` Verify | no `localhost` |
| RLS state | Render env `DATABASE_RLS_ENFORCE` | `true` on staging; production once staging is clean |
| One instance | Render -> service -> Scaling | exactly 1 instance |

## 2. Authentication

1. Sign up with a new email as **A**: arrives at `/dashboard`.
2. Reload: still signed in. Close and reopen the tab: still signed in.
3. User menu -> sign out: lands on the landing page; opening `/dashboard` redirects to sign-in.
4. Sign in again. Leave the tab idle past the token lifetime (about a minute) and click around: requests keep working (the app refreshes the token).
5. Profile: set username, bio, upload a photo (appears; the URL is a temporary Supabase link).

## 3. Social (A and B)

1. A -> Friends -> Find people -> finds B by username; **Add friend**. B's bell shows 1 unread; B opens Friends -> Requests -> **Accept**. Both lists show each other. A's bell shows "accepted".
2. A removes B; B no longer sees A. A sends a request again; B **Decline**s; A sends once more and **Cancel**s.
3. B blocks A: A's *Add friend* now fails and B's Friends -> Blocked lists A. Unblock works.
4. Invitations: A creates a meeting and invites friend B from the invite picker. B sees the invitation and **Join**; a non-friend cannot be invited; a scheduled meeting's invitation says it opens at the start time.

## 4. Meeting (A host, B guest)

1. A: New Meeting with the waiting room on. B opens the link: sees "Waiting for the host". A sees B in the participants panel and **Admit**s; B enters.
2. Both turn on microphone and camera: each sees and hears the other (check from two networks if you can: one on mobile data).
3. A mutes B (if you use host mute), B sees the state change; A removes B: B is sent out and cannot rejoin without admission. A non-host cannot see host controls.
4. B reloads: reconnects as the same participant (no duplicate in the list).
5. Deny camera permission in the browser on a third visit: the app shows the permission message and still lets you join with the microphone or without devices; allow it afterwards and the camera starts.
6. A ends the meeting for everyone: B is returned to the dashboard; both see the meeting under Recent.
7. Everyone leaves a meeting without ending it: after about 10 minutes it appears as ended.

## 5. Scheduling

Schedule a meeting for tomorrow in another time zone: it lists with the correct local time; edit and cancel work; a second account cannot edit it.

## 6. Logs

Render -> Logs during the above: no `ERROR` lines, no tracebacks, no secrets or tokens printed, request ids present.

Record the date, the commit and who ran which section. Anything not run is "not verified", not "passed".
