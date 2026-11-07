# Meetly design system and redesign audit

The landing page (`frontend/src/app/page.tsx` and `frontend/src/components/landing/*`)
is the source of truth for Meetly's visual identity. This document records what
was extracted from it, how it is expressed as design tokens, and which parts of
the application were brought in line.

## 1. Landing page analysis

| Aspect | What the landing page does |
| --- | --- |
| Palette | Pure white page, pure black accent, greys `#f5f5f5` (tiles/pills), `#f7f7f7` (muted surface), `#e8e8e8` (borders), `#dcdcdc` (stronger borders), `#686868` (secondary text). No brand hue. The only colour is Clerk's orange development-mode badge. |
| Typography | Rounded system stack (`ui-rounded`, SF Pro Rounded, Nunito, Segoe UI). Headings weight 800, tight tracking (`-0.03em` to `-0.05em`), `clamp()` sizing. Body 15-17px, line-height 1.5-1.6, secondary text `#686868`. Eyebrow labels are 12px uppercase, tracking `0.14em`. |
| Buttons | 48-56px tall, 8px radius, 600 weight. Primary is solid black with white text, secondary is white with a black border. Hover lifts 2px and lightens/darkens slightly. |
| Cards | `rounded-3xl` (24px), 1px `#e8e8e8` border, white fill. Hover: lifts 4px, border turns black, soft shadow, icon tile inverts to black. A cursor spotlight follows the pointer. |
| Icon tiles | 48px rounded-2xl grey (`#f5f5f5`) tile with a black icon, inverting to black/white on card hover. |
| Pills and badges | Fully rounded, grey fill or hairline border, small caps labels, optional pulsing dot. |
| Shadows | Restrained: `0 12px 28px -16px rgba(0,0,0,.18)` for cards, `0 24px 48px -30px rgba(0,0,0,.35)` for floating surfaces. |
| Background | White with a faint dotted grid (`#e2e2e2` dots, 22px) that fades at section edges. |
| Icons | One Lucide-style set (`src/components/icons`), 24px grid, 1.75 stroke, rounded caps and joins. |
| Motion | 150-300ms eases, `cubic-bezier(0.2, 0.8, 0.2, 1)` for entrances, reveal-on-scroll, drawn scribble underlines, pulsing live dots. All respect `prefers-reduced-motion`. |
| Layout | Centered container, 86% wide up to a max width, 96px section rhythm, hairline dividers. |

## 2. Design tokens

The tokens live in `frontend/src/app/globals.css` (`:root`) and are consumed by
every stylesheet through `var(--…)`. The old Zoom-blue values were replaced, so
the existing component CSS inherits the new identity.

| Token group | Tokens |
| --- | --- |
| Brand / action | `--color-primary` `#000`, `--color-primary-hover` `#262626`, `--color-primary-active` `#404040`, `--color-primary-soft` `#f5f5f5`, `--color-primary-text` `#000` |
| Surfaces | `--color-bg` `#fff`, `--color-surface` `#fff`, `--color-surface-alt` `#f7f7f7` |
| Lines | `--color-border` `#e8e8e8`, `--color-border-strong` `#dcdcdc` |
| Text | `--color-text` `#000`, `--color-text-secondary` `#686868`, `--color-text-muted` `#8c8c8c`, `--color-text-inverse` `#fff` |
| Feedback | `--color-danger` (functional red, destructive and "off" states only), success/warning are monochrome and always paired with text |
| Typography | `--font-sans` (rounded stack), `--text-xs` … `--text-3xl`, `--leading-*`, display tracking `--tracking-display` |
| Radius | `--radius-sm` 8, `--radius-md` 12, `--radius-lg` 16, `--radius-xl` 24, `--radius-2xl` 28, `--radius-pill` |
| Shadow | `--shadow-xs` `--shadow-sm` `--shadow-md` `--shadow-lg` |
| Motion | `--transition-fast` 150ms, `--transition` 220ms, `--ease-out` |
| Meeting room | `--room-*` tokens, now light: white room, `#f5f5f5` tiles, black controls |

## 3. Audit of the existing application (before the redesign)

### Routes discovered

| Route | Purpose | Notes |
| --- | --- | --- |
| `/` | Landing page | Already the new identity |
| `/sign-up`, `/sign-in` | Clerk auth | `/sign-in` redirects to `/` (the sign-in form is embedded in the landing hero) |
| `/dashboard` | Home: action tiles, join form, upcoming and recent meetings | Old Zoom look |
| `/meetings` | Meetings list with tabs | Old Zoom look |
| `/meetings/[meetingId]` | Meeting room (pre-join, room, panels, settings) | Old dark Zoom-style room |
| `/new-meeting` | Instant meeting creation | Old look |
| `/schedule` | Schedule a meeting | Old look |
| `/join` | Join by ID | Old look |
| `/settings` | Display name and preferences | Old look |

Not implemented (and therefore not invented): Calendar, Meeting details,
Meeting history page, Invitations, Notifications, Notes/Tasks, Profile, chat
and screen sharing UI.

### Shared structure
`AppShell` (top bar + sidebar + main), `TopNav`, `Sidebar`; common components
`ConfirmDialog`, `DropdownMenu`, `EmptyState`, `ErrorState`, `Skeleton`,
`ToastProvider`; dashboard components `ActionTiles`, `JoinForm`,
`ScheduleForm`, `UpcomingMeetingCard`, `RecentMeetingCard`; meeting components
`ControlBar`, `DeviceSelector`, `MeetingSettingsDialog`, `MeetingTopBar`,
`ParticipantGrid`, `ParticipantsPanel`, `ReactionPicker`, `RoomPopover`,
`VideoTile`.

### Findings
- Four hand-written stylesheets (`primitives`, `shell`, `dashboard`,
  `meeting`; about 3,400 lines) driven by about 470 token references and about
  60 hard-coded colours, so a token-level redesign is possible.
- Blue Zoom-style primary (`#0b5cff`), 6-14px radii, gray-blue neutrals, a dark
  `#131519` meeting room and blue/green/amber accents throughout.
- Admin-style left sidebar plus a top bar that duplicated its links.
- Two dead top-bar buttons: **Help** and **Notifications** had no handler and
  no destination (and no notifications feature exists). Removed.
- Icons were already one consistent set (24px grid, 1.75 stroke); the only
  stragglers were a bespoke inline SVG in `EmptyState` and a mismatched
  "Join" icon in the sidebar.
- The **backend has no authentication**: `/api/users/me` returns one fixed
  default user. Clerk gates the frontend only, so data is not per account.

## 4. Implementation checklist

- [x] Tokens remapped to the Meetly palette, type, radii, shadows, motion (`globals.css`)
- [x] App shell: landing-style sticky top bar, sidebar removed, slide-down mobile menu
- [x] Primitives: buttons, fields, cards, badges, tabs, dialogs, toasts, menus, skeletons, states
- [x] Dashboard, Meetings, Join, Schedule, New meeting, Settings
- [x] Meeting room: tiles, control bar, panels, popovers, settings dialog, notices, overlay screens
- [x] Icon standardisation (one set; bespoke `EmptyState` SVG replaced, Join icon aligned)
- [x] Clerk modal / user menu theme made monochrome
- [x] Zoom wording removed from code and comments
- [ ] Authenticated end-to-end verification through Clerk (blocked: invalid `CLERK_SECRET_KEY`, see section 8)

## 5. Bugs found and fixed during the redesign

| Bug | Cause | Fix |
| --- | --- | --- |
| Settings page content clipped at 640px with a shadow | `.settings` class collided with the in-room settings dialog (`max-height`, `overflow: hidden`, uppercase labels) | Page uses `.settings-page` |
| Meeting room pushed the control bar off-screen when the camera was on (page 1,291px in a 900px window) | `.room` used `min-height`, so the stage (measured in JS to size tiles) could grow with its own content | `.room` is exactly viewport-tall |
| Avatar initials rendered as "D(" | Initials were derived from the label "Demo User (You)" | `getInitials` ignores parenthesised annotations (unit tested) |
| Two top-bar buttons did nothing | Help and Notifications icons had no handler or destination, and no notification feature exists | Removed (regression test added) |
| Room header squeezed "Copy invite" and the title at 360-390px | Header actions could shrink | Actions no longer shrink, header wraps below 480px |

## 6. Verification

| Check | Result |
| --- | --- |
| Frontend unit tests (Vitest) | 249 passed in 22 files |
| Backend tests (pytest, Python 3.14, SQLite) | 117 passed |
| `tsc --noEmit`, ESLint | clean |
| Production build (`next build --webpack`, scratch copy of the real code and Clerk) | compiled, type-checked and prerendered 10 pages. The in-place Turbopack build was blocked by a stale local server holding `.next/standalone`. |
| Responsive matrix: 7 routes x 7 viewports (1920x1080 to 360x800), headless Chrome | 49 combinations, no horizontal overflow, no off-screen elements, no console errors |
| Functional flows against the real backend (instant meeting, room connect, camera, mute, participants panel, End, schedule, join by ID) | all passed |

How the signed-in pages were exercised: Clerk cannot verify sessions without a
valid secret key, so the authenticated screens were rendered in a throwaway copy
of the frontend (outside the repo) with the `@clerk/nextjs` module stubbed as a
signed-in user. No bypass exists in the repository.

### Not verified / not implemented
- Real Clerk sign-in, sign-out and sign-in again, the demo-account login and the
  dashboard-after-login flow (blocked by the key, below).
- Screen sharing, in-meeting chat and host permissions between two users: no
  UI exists for the first two, and host actions need a second participant.
- Account-specific data: the backend has no authentication, so all users share
  one default account.

## 7. Dashboard

Composition, top to bottom: top bar (76px), hero (greeting + people illustration),
three quick-action cards, two meeting panels.

| Piece | Component | Notes |
| --- | --- | --- |
| Hero | `DashboardHero` | Greeting uses the viewer's clock and the signed-in user's first name; date is local. Illustration is `public/images/people-illustration-dashboard.png` via `next/image` (about 200px tall on desktop, scales down, never cropped). |
| Quick actions | `ActionTiles` | Three equal 125px cards, whole card is the link: `/new-meeting`, `/join`, `/schedule`. |
| Panels | `MeetingPanel` | Title + "View all" header. The grid stretches both panels to one height and the body keeps a floor of three rows, so every state has identical dimensions. |
| Rows | `UpcomingRow`, `RecentRow`, `AddRow` | Upcoming: calendar tile, "Today, 10:00 AM - 10:30 AM" in local time, Join, overflow menu (copy link / ID). Recent: camera tile, "Yesterday, 45 min", whole row opens the meeting. A partly filled panel ends with a real shortcut row instead of blank space. |
| Empty states | `PanelEmptyState` | Own illustration per panel (`empty-upcoming.svg`, `empty-recent.svg`), heading, explanation and an action. |

Rules that keep the page compact:
- The dashboard asks the API for 3 rows per list (`PREVIEW_LIMIT`) and also slices to 3, so it never grows with history.
- Everything else is behind **View all**. `/meetings` pages with **Load more** (10 at a time; the API pages by `limit`, max 100, and the page says when it is showing the latest 100). `/meetings?tab=recent` opens the Recent tab.
- No nested scrollbars anywhere on the dashboard.

Example data (for example "Team Sync" or "Project Kickoff") is **not** in the
product. States were verified by faking only the two list endpoints in a test
harness; the shipped code renders real API data only.

Verified at 1920x1080, 1440x900, 1366x768, 1024x768, 768x1024, 390x844 and 360x800 for
populated, both empty, either one empty, one meeting each, 200 meetings returned and an API error:
panels equal in size in every state, action cards equal, page height identical across states,
no horizontal overflow, no nested scrollers, no console errors. At 1440x900 the whole dashboard
is exactly 900px tall.

## 8. Demo account

| | |
| --- | --- |
| Email | `demouser@gmail.com` |
| Password | `thisisdemouser` |
| Valid in | The Clerk **development** instance configured by `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` in `frontend/.env.local` |

Create it with Clerk's Backend API (the user is created by Clerk, nothing is
bypassed):

```bash
cd frontend
# 1. put the FULL secret key from Clerk Dashboard -> API keys in .env.local
#    CLERK_SECRET_KEY=sk_test_...
npm run demo-user
```

The script is idempotent, never prints the key, and refuses to run with a
truncated key. Override the defaults with `DEMO_USER_EMAIL` and
`DEMO_USER_PASSWORD`.

**Current status:** the `CLERK_SECRET_KEY` in this checkout's `.env.local` is a
redacted placeholder (14 characters ending in an ellipsis), so the account has
not been created yet. Until a valid key is configured, the Clerk middleware also
cannot verify sessions, so signing in will not reach the dashboard.

Note: because the backend has no authentication, every signed-in user sees the
same data. The demo account does not get account-specific data.
