import { beforeEach, describe, expect, it, vi } from "vitest";
import { describeInviteOutcome, inviteSelectedFriends } from "./inviteFriends";

const inviteToMeeting = vi.hoisted(() => vi.fn());
vi.mock("@/services/socialService", () => ({ inviteToMeeting }));

describe("inviteSelectedFriends", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends nothing when no friend is picked", async () => {
    expect(await inviteSelectedFriends("123456789", new Set())).toEqual({ invited: 0, invitedIds: [], skipped: 0, error: null });
    expect(inviteToMeeting).not.toHaveBeenCalled();
  });

  it("sends numeric ids and counts invited and skipped", async () => {
    inviteToMeeting.mockResolvedValue({
      meeting_id: "123456789",
      invited: 1,
      results: [
        { user_id: 4, result: "invited" },
        { user_id: 5, result: "unavailable" },
      ],
    });
    const outcome = await inviteSelectedFriends("123456789", new Set(["4", "5", "nope"]));
    expect(inviteToMeeting).toHaveBeenCalledWith("123456789", [4, 5]);
    expect(outcome).toEqual({ invited: 1, invitedIds: ["4"], skipped: 1, error: null });
  });

  it("never throws when the API fails", async () => {
    inviteToMeeting.mockRejectedValue(new Error("down"));
    const outcome = await inviteSelectedFriends("123456789", ["4"]);
    expect(outcome.error).toBe("down");
    expect(describeInviteOutcome(outcome)?.kind).toBe("error");
  });

  it("describes outcomes for the toast", () => {
    expect(describeInviteOutcome({ invited: 2, invitedIds: [], skipped: 0, error: null })).toEqual({ text: "2 friends invited", kind: "success" });
    expect(describeInviteOutcome({ invited: 1, invitedIds: [], skipped: 0, error: null })?.text).toBe("1 friend invited");
    expect(describeInviteOutcome({ invited: 0, invitedIds: [], skipped: 0, error: null })).toBeNull();
  });
});
