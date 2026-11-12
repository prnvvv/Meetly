import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/types/api";
import type { Meeting } from "@/types/meeting";
import { useMeetingRoom } from "./useMeetingRoom";

const getMeeting = vi.hoisted(() => vi.fn());
const getParticipants = vi.hoisted(() => vi.fn());

vi.mock("@/services/meetingService", () => ({ getMeeting }));
vi.mock("@/services/participantService", () => ({ getParticipants }));

const MEETING = { id: 1, meeting_id: "810288678", title: "T" } as Meeting;

describe("useMeetingRoom", () => {
  beforeEach(() => {
    getMeeting.mockReset().mockResolvedValue(MEETING);
    getParticipants.mockReset();
  });
  afterEach(cleanup);

  it("loads the meeting and its participants", async () => {
    getParticipants.mockResolvedValue([{ id: 1 }]);
    const { result } = renderHook(() => useMeetingRoom("810288678"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.meeting).toEqual(MEETING);
    expect(result.current.participants).toHaveLength(1);
  });

  it("still opens the room for someone who has not joined yet (403 on the roster)", async () => {
    // An invited friend or a guest in the waiting room may not list participants;
    // the live roster arrives over the socket after they are let in.
    getParticipants.mockRejectedValue(new ApiError("You are not part of this meeting", 403));
    const { result } = renderHook(() => useMeetingRoom("810288678"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.meeting).toEqual(MEETING);
    expect(result.current.participants).toEqual([]);
  });

  it("still reports other roster failures", async () => {
    getParticipants.mockRejectedValue(new ApiError("boom", 500));
    const { result } = renderHook(() => useMeetingRoom("810288678"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeTruthy();
    expect(result.current.meeting).toBeNull();
  });

  it("reports a missing meeting", async () => {
    getMeeting.mockRejectedValue(new ApiError("nope", 404));
    getParticipants.mockResolvedValue([]);
    const { result } = renderHook(() => useMeetingRoom("810288678"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.notFound).toBe(true);
  });
});
