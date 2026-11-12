"use client";

import { useEffect, useRef, useState } from "react";
import { BellIcon } from "@/components/icons";
import { ProfileAvatar } from "@/components/profile/ProfileAvatar";
import { cx } from "@/lib/utils";
import type { AppNotification } from "@/types/social";

interface NotificationsMenuProps {
  items: AppNotification[];
  unread: number;
  loading: boolean;
  hasMore: boolean;
  onOpenChange?: (open: boolean) => void;
  onMarkRead: (id: number) => void;
  onMarkAllRead: () => void;
  onLoadMore: () => void;
  /** Called when a friend-related notification is clicked. */
  onOpenFriends: (tab: "requests" | "friends") => void;
}

function describe(n: AppNotification): { text: string; tab: "requests" | "friends" | null } {
  const who = n.actor?.display_name ?? "Someone";
  switch (n.type) {
    case "friend_request":
      return { text: `${who} sent you a friend request`, tab: "requests" };
    case "friend_request_accepted":
      return { text: `${who} accepted your friend request`, tab: "friends" };
    default:
      return { text: "You have a new notification", tab: null };
  }
}

export function timeAgo(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function NotificationsMenu({
  items,
  unread,
  loading,
  hasMore,
  onOpenChange,
  onMarkRead,
  onMarkAllRead,
  onLoadMore,
  onOpenFriends,
}: NotificationsMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    onOpenChange?.(open);
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onOpenChange]);

  return (
    <div className="menu-anchor" ref={ref}>
      <button
        type="button"
        className={cx("icon-button", "nt-bell", open && "icon-button--active")}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        onClick={() => setOpen((v) => !v)}
      >
        <BellIcon />
        {unread > 0 ? (
          <span className="nt-badge" aria-hidden="true">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="menu nt-panel" role="dialog" aria-label="Notifications">
          <div className="nt-panel__head">
            <span className="nt-panel__title">Notifications</span>
            <button type="button" className="btn btn--ghost btn--sm" disabled={unread === 0} onClick={onMarkAllRead}>
              Mark all read
            </button>
          </div>
          {loading && items.length === 0 ? (
            <p className="sd-empty" aria-busy="true">Loading…</p>
          ) : items.length === 0 ? (
            <p className="sd-empty">You are all caught up.</p>
          ) : (
            <ul className="nt-list">
              {items.map((n) => {
                const d = describe(n);
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      className={cx("nt-item", !n.read && "nt-item--unread")}
                      onClick={() => {
                        if (!n.read) onMarkRead(n.id);
                        if (d.tab) {
                          setOpen(false);
                          onOpenFriends(d.tab);
                        }
                      }}
                    >
                      <ProfileAvatar name={n.actor?.display_name ?? "?"} url={n.actor?.avatar_url} size={36} />
                      <span className="nt-item__text">
                        <span>{d.text}</span>
                        <span className="sd-row__sub">{timeAgo(n.created_at)}</span>
                      </span>
                      {!n.read ? <span className="nt-dot" aria-label="Unread" /> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {hasMore ? (
            <button type="button" className="btn btn--ghost btn--sm btn--block" onClick={onLoadMore}>
              Load older
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
