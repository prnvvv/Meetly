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

- [ ] Tokens remapped to the Meetly palette, type, radii, shadows, motion
- [ ] App shell: landing-style top bar, sidebar removed, mobile menu
- [ ] Primitives: buttons, fields, cards, badges, tabs, dialogs, toasts, menus, skeletons
- [ ] Dashboard, Meetings, Join, Schedule, New meeting, Settings
- [ ] Meeting room: tiles, toolbar, panels, settings dialog, pre-join, states
- [ ] Icon standardisation
- [ ] Authenticated end-to-end verification (blocked, see below)

## 5. Demo account

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
