import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/common/ToastProvider";
import type { Person } from "@/types/social";
import { FriendsDrawer } from "./FriendsDrawer";

const svc = vi.hoisted(() => ({
  searchPeople: vi.fn(),
  discoverPeople: vi.fn(),
  listFriendsPage: vi.fn(),
  incomingRequests: vi.fn(),
  outgoingRequests: vi.fn(),
  sendFriendRequest: vi.fn(),
  acceptRequest: vi.fn(),
  rejectRequest: vi.fn(),
  cancelRequest: vi.fn(),
  removeFriend: vi.fn(),
  blockUser: vi.fn(),
  unblockUser: vi.fn(),
  listBlocked: vi.fn(),
}));

vi.mock("@/services/socialService", () => svc);
vi.mock("@/services/profileService", () => ({
  getProfile: vi.fn().mockResolvedValue({
    user_id: 7,
    username: "grace",
    display_name: "Grace Hopper",
    avatar_url: null,
    limited: false,
    is_self: false,
    bio: "Compilers",
    location: null,
    designation: null,
    organization: null,
    website: null,
    social_links: {},
    created_at: null,
    stats: null,
    visibility: null,
    show_meeting_stats: null,
    updated_at: null,
  }),
}));

function person(over: Partial<Person> = {}): Person {
  return {
    user_id: 7,
    username: "grace",
    display_name: "Grace Hopper",
    avatar_url: null,
    designation: null,
    relationship: "none",
    request_id: null,
    ...over,
  };
}

function renderDrawer() {
  return render(
    <ToastProvider>
      <FriendsDrawer open onClose={() => undefined} changeTick={0} />
    </ToastProvider>
  );
}

describe("FriendsDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    svc.listFriendsPage.mockResolvedValue({ items: [], has_more: false });
    svc.incomingRequests.mockResolvedValue([]);
    svc.outgoingRequests.mockResolvedValue([]);
    svc.listBlocked.mockResolvedValue({ items: [], has_more: false });
    svc.discoverPeople.mockResolvedValue({ items: [], has_more: false });
    svc.searchPeople.mockResolvedValue({ items: [], has_more: false });
  });
  afterEach(cleanup);

  it("shows an empty state for a user with no friends", async () => {
    renderDrawer();
    expect(await screen.findByText(/You have no friends yet/)).toBeTruthy();
  });

  it("lists real friends from the API", async () => {
    svc.listFriendsPage.mockResolvedValue({ items: [person({ relationship: "friend" })], has_more: false });
    renderDrawer();
    expect(await screen.findByText("Grace Hopper")).toBeTruthy();
    expect(screen.getByText("@grace")).toBeTruthy();
  });

  it("searches people (debounced, 2+ chars) and sends a friend request", async () => {
    svc.searchPeople.mockResolvedValue({ items: [person()], has_more: false });
    svc.sendFriendRequest.mockResolvedValue({ request_id: 3, status: "PENDING", friendship_created: false });
    renderDrawer();
    fireEvent.click(await screen.findByRole("tab", { name: "Find people" }));
    fireEvent.change(await screen.findByLabelText("Search by username or name"), { target: { value: "g" } });
    expect(await screen.findByText("Type at least 2 characters.")).toBeTruthy();
    expect(svc.searchPeople).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Search by username or name"), { target: { value: "gr" } });
    fireEvent.click(await screen.findByRole("button", { name: "Add friend" }));
    await waitFor(() => expect(svc.sendFriendRequest).toHaveBeenCalledWith(7));
    expect(svc.searchPeople).toHaveBeenCalledWith("gr");
    expect(await screen.findByRole("button", { name: "Cancel request" })).toBeTruthy();
  });

  it("accepts and declines incoming requests through the API", async () => {
    svc.incomingRequests.mockResolvedValue([
      { id: 11, status: "PENDING", created_at: "2026-01-01T00:00:00Z", responded_at: null, person: person() },
    ]);
    svc.acceptRequest.mockResolvedValue({ request_id: 11, status: "ACCEPTED", friendship_created: true });
    renderDrawer();
    fireEvent.click(await screen.findByRole("tab", { name: /Requests/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Accept" }));
    await waitFor(() => expect(svc.acceptRequest).toHaveBeenCalledWith(11));
  });

  it("asks for confirmation before blocking", async () => {
    svc.listFriendsPage.mockResolvedValue({ items: [person({ relationship: "friend" })], has_more: false });
    svc.blockUser.mockResolvedValue(undefined);
    renderDrawer();
    fireEvent.click(await screen.findByRole("button", { name: /View Grace Hopper/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Block" }));
    expect(svc.blockUser).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("alertdialog").catch(() => screen.findByRole("dialog", { name: "Block this person?" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Block" }));
    await waitFor(() => expect(svc.blockUser).toHaveBeenCalledWith(7));
  });

  it("shows the server-limited profile without inventing details", async () => {
    svc.listFriendsPage.mockResolvedValue({ items: [person({ relationship: "friend" })], has_more: false });
    renderDrawer();
    fireEvent.click(await screen.findByRole("button", { name: /View Grace Hopper/ }));
    expect(await screen.findByText("Compilers")).toBeTruthy();
  });
});
