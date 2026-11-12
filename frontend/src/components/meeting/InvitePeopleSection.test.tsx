import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Friend } from "@/lib/friends";
import { InvitePeopleSection } from "./InvitePeopleSection";

const friends: Friend[] = [
  { id: "1", name: "Ada Lovelace", username: "ada", avatarUrl: null },
  { id: "2", name: "Grace Hopper", username: "grace", avatarUrl: "https://img.test/g.webp" },
];

function setup(over: Partial<React.ComponentProps<typeof InvitePeopleSection>> = {}) {
  const props = {
    friends,
    loading: false,
    selectedIds: new Set<string>(),
    onToggle: vi.fn(),
    onClear: vi.fn(),
    onOpenMore: vi.fn(),
    ...over,
  };
  render(<InvitePeopleSection {...props} />);
  return props;
}

describe("InvitePeopleSection", () => {
  afterEach(cleanup);

  it("shows just \"No friends yet\" when there is nothing to list", () => {
    setup({ friends: [] });
    expect(screen.getByText("No friends yet")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Find friends" })).toBeNull();
    expect(screen.queryByRole("list", { name: "Friends" })).toBeNull();
    expect(screen.queryByRole("button", { name: "More" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Scroll friends/ })).toBeNull();
  });

  it("shows a failure state with retry when friends cannot be loaded", () => {
    const onRetry = vi.fn();
    setup({ friends: [], error: "The meeting service is temporarily unavailable.", onRetry });
    expect(screen.getByRole("alert").textContent).toMatch(/Couldn.t load your friends/);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("shows skeletons while loading, never the empty state", () => {
    setup({ friends: [], loading: true });
    expect(screen.queryByText("No friends yet")).toBeNull();
    expect(document.querySelectorAll(".nm-friend--skeleton")).toHaveLength(6);
  });

  it("lists friends, supports multi-select and removing a selection", () => {
    const props = setup({ selectedIds: new Set(["1", "2"]) });
    expect(screen.getByRole("checkbox", { name: "Ada Lovelace, @ada" })).toBeTruthy();
    expect(screen.getByText("2 selected")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove Ada Lovelace" }));
    expect(props.onToggle).toHaveBeenCalledWith("1");
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(props.onClear).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(props.onOpenMore).toHaveBeenCalled();
  });

  it("marks already invited friends and does not let them be picked again", () => {
    const props = setup({ invitedIds: new Set(["2"]) });
    const invited = screen.getByRole("checkbox", { name: /Grace Hopper, @grace, already invited/ });
    expect((invited as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Invited")).toBeTruthy();
    fireEvent.click(invited);
    expect(props.onToggle).not.toHaveBeenCalled();
  });

  it("shows a photo when the friend has one and an illustration otherwise", () => {
    setup();
    expect(document.querySelector('img[src="https://img.test/g.webp"]')).toBeTruthy();
    // the friend without a photo gets one of the hand-drawn illustrations
    expect(document.querySelectorAll('[data-variant]:not([data-variant="photo"])').length).toBeGreaterThanOrEqual(1);
  });
});
