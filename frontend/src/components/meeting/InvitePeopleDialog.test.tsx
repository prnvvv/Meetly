import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/common/ToastProvider";
import { FRIENDS_PANEL_EVENT } from "@/lib/friendsPanel";
import { ApiError } from "@/types/api";
import { InvitePeopleDialog } from "./InvitePeopleDialog";

const svc = vi.hoisted(() => ({
  inviteToMeeting: vi.fn(),
  listMeetingInvitations: vi.fn(),
  listFriendsPage: vi.fn(),
}));
vi.mock("@/services/socialService", () => svc);
vi.mock("@/lib/utils", async (original) => ({
  ...(await original<typeof import("@/lib/utils")>()),
  copyText: vi.fn().mockResolvedValue(true),
}));

const person = (id: number, username: string, name: string) => ({
  user_id: id,
  username,
  display_name: name,
  avatar_url: null,
  designation: null,
  relationship: "friend" as const,
  request_id: null,
});

function renderDialog(over: Partial<React.ComponentProps<typeof InvitePeopleDialog>> = {}) {
  const onClose = vi.fn();
  render(
    <ToastProvider>
      <InvitePeopleDialog open meetingId="123456789" onClose={onClose} {...over} />
    </ToastProvider>
  );
  return { onClose };
}

describe("InvitePeopleDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    svc.listFriendsPage.mockResolvedValue({
      items: [person(2, "ada", "Ada Lovelace"), person(3, "grace", "Grace Hopper")],
      has_more: false,
    });
    svc.listMeetingInvitations.mockResolvedValue([]);
  });
  afterEach(cleanup);

  it("shows the meeting link and what the link still requires", async () => {
    renderDialog({ waitingRoomEnabled: true });
    expect(await screen.findByText(/\/meetings\/123456789/)).toBeTruthy();
    expect(screen.getByText(/still needs the meeting password and has to be admitted/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Copy link/ }));
    expect(await screen.findByText("Invite link copied")).toBeTruthy();
  });

  it("shows loading, then lists friends", async () => {
    renderDialog();
    expect(screen.getByText("Loading your friends…")).toBeTruthy();
    expect(await screen.findByText("Ada Lovelace")).toBeTruthy();
    expect(screen.getByText("@grace")).toBeTruthy();
  });

  it("shows a proper empty state that leads to finding friends", async () => {
    svc.listFriendsPage.mockResolvedValue({ items: [], has_more: false });
    const heard = vi.fn();
    window.addEventListener(FRIENDS_PANEL_EVENT, heard);
    const { onClose } = renderDialog();
    expect(await screen.findByText("No friends yet")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Find friends" }));
    expect(onClose).toHaveBeenCalled();
    expect((heard.mock.calls[0][0] as CustomEvent).detail).toEqual({ tab: "find" });
    window.removeEventListener(FRIENDS_PANEL_EVENT, heard);
  });

  it("shows an error state with retry when friends cannot be loaded", async () => {
    svc.listFriendsPage.mockRejectedValueOnce(new ApiError("Service down", 503));
    renderDialog();
    expect(await screen.findByRole("alert")).toBeTruthy();
    svc.listFriendsPage.mockResolvedValue({ items: [person(2, "ada", "Ada Lovelace")], has_more: false });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Ada Lovelace")).toBeTruthy();
  });

  it("filters friends with the search box", async () => {
    renderDialog();
    await screen.findByText("Ada Lovelace");
    fireEvent.change(screen.getByLabelText("Search friends"), { target: { value: "gra" } });
    expect(screen.queryByText("Ada Lovelace")).toBeNull();
    expect(screen.getByText("Grace Hopper")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search friends"), { target: { value: "zzz" } });
    expect(screen.getByText(/No friends match/)).toBeTruthy();
  });

  it("selects several friends and sends one real invitation request", async () => {
    svc.inviteToMeeting.mockResolvedValue({
      meeting_id: "123456789",
      invited: 2,
      results: [
        { user_id: 2, result: "invited" },
        { user_id: 3, result: "invited" },
      ],
    });
    renderDialog();
    fireEvent.click(await screen.findByRole("checkbox", { name: /Ada Lovelace/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Grace Hopper/ }));
    expect(screen.getByText("2 selected")).toBeTruthy();
    svc.listMeetingInvitations.mockResolvedValue([
      { id: 1, status: "PENDING", created_at: "", responded_at: null, person: { user_id: 2, username: "ada", display_name: "Ada" } },
      { id: 2, status: "PENDING", created_at: "", responded_at: null, person: { user_id: 3, username: "grace", display_name: "Grace" } },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Send invitations" }));
    await waitFor(() => expect(svc.inviteToMeeting).toHaveBeenCalledWith("123456789", [2, 3]));
    expect(await screen.findByText("2 friends invited")).toBeTruthy();
    expect((await screen.findAllByText("Invited")).length).toBe(2);
    expect(screen.getByText("0 selected")).toBeTruthy();
  });

  it("will not offer someone who already holds an invitation, but allows a declined one again", async () => {
    svc.listMeetingInvitations.mockResolvedValue([
      { id: 1, status: "PENDING", created_at: "", responded_at: null, person: { user_id: 2, username: "ada", display_name: "Ada" } },
      { id: 2, status: "DECLINED", created_at: "", responded_at: "x", person: { user_id: 3, username: "grace", display_name: "Grace" } },
    ]);
    renderDialog();
    const pending = await screen.findByRole("checkbox", { name: /Ada Lovelace/ });
    await waitFor(() => expect((pending as HTMLButtonElement).disabled).toBe(true));
    expect(screen.getByText("Invited")).toBeTruthy();
    expect(screen.getByText("Declined")).toBeTruthy();
    const declined = screen.getByRole("checkbox", { name: /Grace Hopper/ });
    expect((declined as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(pending);
    expect(screen.getByText("0 selected")).toBeTruthy();
  });

  it("reports people the server refused", async () => {
    svc.inviteToMeeting.mockResolvedValue({
      meeting_id: "123456789",
      invited: 1,
      results: [
        { user_id: 2, result: "invited" },
        { user_id: 3, result: "unavailable" },
      ],
    });
    renderDialog();
    fireEvent.click(await screen.findByRole("checkbox", { name: /Ada Lovelace/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Grace Hopper/ }));
    fireEvent.click(screen.getByRole("button", { name: "Send invitations" }));
    expect(await screen.findByText(/1 could not be invited/)).toBeTruthy();
  });

  it("shows the server message when the meeting is over or sending fails", async () => {
    svc.inviteToMeeting.mockRejectedValue(new ApiError("This meeting has ended or was cancelled", 409));
    renderDialog();
    fireEvent.click(await screen.findByRole("checkbox", { name: /Ada Lovelace/ }));
    fireEvent.click(screen.getByRole("button", { name: "Send invitations" }));
    expect(await screen.findByText("This meeting has ended or was cancelled")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Send invitations" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("disables sending until someone is selected and while a request is in flight", async () => {
    let finish: (v: unknown) => void = () => undefined;
    svc.inviteToMeeting.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderDialog();
    const send = await screen.findByRole("button", { name: "Send invitations" });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: /Ada Lovelace/ }));
    fireEvent.click(send);
    fireEvent.click(screen.getByRole("button", { name: "Sending…" }));
    expect(svc.inviteToMeeting).toHaveBeenCalledTimes(1);
    finish({ meeting_id: "1", invited: 1, results: [{ user_id: 2, result: "invited" }] });
  });

  it("closes with the Close button and on Escape", async () => {
    const { onClose } = renderDialog();
    await screen.findByText("Ada Lovelace");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
