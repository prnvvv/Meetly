"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  SignInButton,
  SignUpButton,
  Show,
  UserButton,
  useAuth,
} from "@clerk/nextjs";
import {
  MenuIcon,
  PlusIcon,
  SettingsIcon,
  UserIcon,
  UsersIcon,
  VideoIcon,
  XIcon,
} from "@/components/icons";
import { FriendsDrawer, type Tab as FriendsTab } from "@/components/social/FriendsDrawer";
import { NotificationsMenu } from "@/components/social/NotificationsMenu";
import { useToast } from "@/components/common/ToastProvider";
import { useNotifications } from "@/hooks/useNotifications";
import { toUserMessage } from "@/lib/api-client";
import { acceptInvitation, declineInvitation } from "@/services/socialService";
import type { AppNotification } from "@/types/social";
import { APP_NAME } from "@/lib/constants";
import { clerkAppearance } from "@/lib/clerk-appearance";
import { cx } from "@/lib/utils";

const NAV_LINKS = [
  { href: "/dashboard", label: "Home" },
  { href: "/schedule", label: "Schedule" },
  { href: "/join", label: "Join" },
];

interface TopNavProps {
  onMenuToggle: () => void;
  menuOpen: boolean;
  onNavigate: () => void;
}

/**
 * Application top bar, the in-app twin of the landing page navigation:
 * camera logo + wordmark, text links with an underline on the active one,
 * a black primary action and the Clerk user menu. On small screens the
 * links move into a slide-down panel.
 */
export function TopNav({ onMenuToggle, menuOpen, onNavigate }: TopNavProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { toast } = useToast();
  const { isSignedIn } = useAuth();
  const notifications = useNotifications(!!isSignedIn);
  const [friendsOpen, setFriendsOpen] = useState(false);
  const [friendsTab, setFriendsTab] = useState<FriendsTab>("friends");
  const joinInvitation = async (n: AppNotification) => {
    if (n.entity_id == null) return;
    try {
      const result = await acceptInvitation(n.entity_id);
      void notifications.refresh();
      // Password-protected meetings need the password typed on the join page first.
      router.push(
        result.has_password ? `/join?meeting=${result.meeting_id}` : `/meetings/${result.meeting_id}`
      );
    } catch (error) {
      toast(toUserMessage(error), "error");
      void notifications.refresh();
    }
  };
  const declineInvite = async (n: AppNotification) => {
    if (n.entity_id == null) return;
    try {
      await declineInvitation(n.entity_id);
    } catch (error) {
      toast(toUserMessage(error), "error");
    }
    void notifications.refresh();
  };
  const openFriends = (tab: FriendsTab = "friends") => {
    setFriendsTab(tab);
    setFriendsOpen(true);
  };
  const isActive = (href: string) =>
    href === "/dashboard"
      ? pathname === "/dashboard" || pathname === "/"
      : pathname.startsWith(href);

  return (
    <header className="topnav">
      <div className="topnav__inner">
        <Link href="/dashboard" className="brand" aria-label={`${APP_NAME} home`}>
          <VideoIcon size={26} strokeWidth={2.25} />
          <span className="brand__name">{APP_NAME}</span>
        </Link>

        <nav className="topnav__links" aria-label="Primary">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cx(
                "topnav__link",
                isActive(link.href) && "topnav__link--active"
              )}
              aria-current={isActive(link.href) ? "page" : undefined}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="topnav__actions">
          <Show when="signed-out">
            <SignInButton mode="modal" appearance={clerkAppearance}>
              <button type="button" className="btn btn--secondary btn--sm">
                Sign in
              </button>
            </SignInButton>
            <SignUpButton mode="modal" appearance={clerkAppearance}>
              <button type="button" className="btn btn--primary btn--sm">
                Sign up
              </button>
            </SignUpButton>
          </Show>
          <Show when="signed-in">
            <Link href="/new-meeting" className="btn btn--primary btn--sm topnav__cta">
              <PlusIcon size={16} />
              New Meeting
            </Link>
            <button
              type="button"
              className={cx("icon-button", friendsOpen && "icon-button--active")}
              aria-label="Friends"
              aria-haspopup="dialog"
              onClick={() => openFriends("friends")}
            >
              <UsersIcon />
            </button>
            <NotificationsMenu
              items={notifications.items}
              unread={notifications.unread}
              loading={notifications.loading}
              hasMore={notifications.hasMore}
              onMarkRead={(id) => void notifications.markRead(id)}
              onMarkAllRead={() => void notifications.markAllRead()}
              onLoadMore={() => void notifications.loadMore()}
              onOpenFriends={openFriends}
              onJoinInvitation={(n) => void joinInvitation(n)}
              onDeclineInvitation={(n) => void declineInvite(n)}
            />
            <Link
              href="/settings"
              className={cx(
                "icon-button",
                pathname.startsWith("/settings") && "icon-button--active"
              )}
              aria-label="Settings"
            >
              <SettingsIcon />
            </Link>
            <UserButton appearance={clerkAppearance}>
              <UserButton.MenuItems>
                <UserButton.Link
                  label="Profile"
                  href="/profile"
                  labelIcon={<UserIcon size={16} />}
                />
              </UserButton.MenuItems>
            </UserButton>
          </Show>
          <button
            type="button"
            className="icon-button topnav__menu-toggle"
            onClick={onMenuToggle}
            aria-expanded={menuOpen}
            aria-controls="app-menu"
            aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
          >
            {menuOpen ? <XIcon /> : <MenuIcon />}
          </button>
        </div>
      </div>

      <Show when="signed-in">
        <FriendsDrawer
          open={friendsOpen}
          onClose={() => setFriendsOpen(false)}
          changeTick={notifications.changeTick}
          initialTab={friendsTab}
        />
      </Show>

      <div
        id="app-menu"
        className={cx("topnav__panel", menuOpen && "topnav__panel--open")}
      >
        <nav aria-label="Menu" className="topnav__panel-links">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={onNavigate}
              className={cx(
                "topnav__panel-link",
                isActive(link.href) && "topnav__panel-link--active"
              )}
              aria-current={isActive(link.href) ? "page" : undefined}
            >
              {link.label}
            </Link>
          ))}
          <Link
            href="/settings"
            onClick={onNavigate}
            className={cx(
              "topnav__panel-link",
              isActive("/settings") && "topnav__panel-link--active"
            )}
          >
            Settings
          </Link>
        </nav>
        <Link
          href="/new-meeting"
          onClick={onNavigate}
          className="btn btn--primary btn--block"
        >
          <PlusIcon size={16} />
          New Meeting
        </Link>
      </div>
    </header>
  );
}
