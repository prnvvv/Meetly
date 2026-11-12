import { toUserMessage } from "@/lib/api-client";
import { inviteToMeeting } from "@/services/socialService";

export interface InviteOutcome {
  /** People who were newly invited (or re-invited). */
  invited: number;
  /** Friend ids (as strings) that now hold an invitation, including ones sent earlier. */
  invitedIds: string[];
  /** People the server refused (not a friend any more, blocked, ...). */
  skipped: number;
  error: string | null;
}

/**
 * Sends real invitations for the friends picked on the setup screens. It never
 * throws: the meeting already exists, so a failed invite must not block starting it.
 */
export async function inviteSelectedFriends(
  meetingId: string,
  friendIds: ReadonlySet<string> | string[]
): Promise<InviteOutcome> {
  const ids = [...friendIds].map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (ids.length === 0) return { invited: 0, invitedIds: [], skipped: 0, error: null };
  try {
    const result = await inviteToMeeting(meetingId, ids);
    const skipped = result.results.filter((r) => r.result === "unavailable").length;
    const invitedIds = result.results
      .filter((r) => r.result !== "unavailable")
      .map((r) => String(r.user_id));
    return { invited: result.invited, invitedIds, skipped, error: null };
  } catch (error) {
    return { invited: 0, invitedIds: [], skipped: ids.length, error: toUserMessage(error) };
  }
}

export function describeInviteOutcome(outcome: InviteOutcome): { text: string; kind: "success" | "error" } | null {
  if (outcome.error) {
    return { text: `Meeting created, but invitations were not sent: ${outcome.error}`, kind: "error" };
  }
  if (outcome.invited > 0) {
    const n = outcome.invited;
    return { text: `${n} ${n === 1 ? "friend" : "friends"} invited`, kind: "success" };
  }
  if (outcome.skipped > 0) {
    return { text: "Those friends could not be invited.", kind: "error" };
  }
  return null;
}
