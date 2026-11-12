import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppNotification } from "@/types/social";
import { NotificationsMenu, timeAgo } from "./NotificationsMenu";

const invite: AppNotification = {
  id: 1,
  type: "meeting_invitation",
  entity_type: "meeting_invitation",
  entity_id: 9,
  payload: { meeting_id: "123456789", title: "Design review" },
  actor: { user_id: 2, username: "ada", display_name: "Ada", avatar_url: null },
  read: false,
  created_at: new Date().toISOString(),
};

function setup(items: AppNotification[]) {
  const handlers = {
    onMarkRead: vi.fn(),
    onMarkAllRead: vi.fn(),
    onLoadMore: vi.fn(),
    onOpenFriends: vi.fn(),
    onJoinInvitation: vi.fn(),
    onDeclineInvitation: vi.fn(),
  };
  render(<NotificationsMenu items={items} unread={items.filter((i) => !i.read).length} loading={false} hasMore={false} {...handlers} />);
  fireEvent.click(screen.getByRole("button", { name: /Notifications/ }));
  return handlers;
}

describe("NotificationsMenu", () => {
  afterEach(cleanup);

  it("shows the unread count on the bell", () => {
    setup([invite]);
    expect(screen.getByRole("button", { name: "Notifications, 1 unread" })).toBeTruthy();
  });

  it("renders an invitation with Join and Decline that call the handlers", () => {
    const h = setup([invite]);
    expect(screen.getByText('Ada invited you to "Design review"')).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    expect(h.onJoinInvitation).toHaveBeenCalledWith(invite);
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    expect(h.onDeclineInvitation).toHaveBeenCalledWith(invite);
  });

  it("opens the Requests tab for a friend request and marks it read", () => {
    const req: AppNotification = { ...invite, id: 2, type: "friend_request", payload: null };
    const h = setup([req]);
    fireEvent.click(screen.getByText("Ada sent you a friend request"));
    expect(h.onMarkRead).toHaveBeenCalledWith(2);
    expect(h.onOpenFriends).toHaveBeenCalledWith("requests");
  });

  it("shows an empty state", () => {
    setup([]);
    expect(screen.getByText("You are all caught up.")).toBeTruthy();
  });

  it("formats relative times", () => {
    const now = Date.parse("2026-01-02T00:00:00Z");
    expect(timeAgo("2026-01-02T00:00:00Z", now)).toBe("just now");
    expect(timeAgo("2026-01-01T23:30:00Z", now)).toBe("30m ago");
    expect(timeAgo("2026-01-01T20:00:00Z", now)).toBe("4h ago");
    expect(timeAgo("2025-12-30T00:00:00Z", now)).toBe("3d ago");
  });
});
