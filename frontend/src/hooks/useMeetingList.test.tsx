import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Meeting } from "@/types/meeting";
import { MAX_LIST_LIMIT, useMeetingList } from "./useMeetingList";

const getUpcoming = vi.hoisted(() => vi.fn());
const getRecent = vi.hoisted(() => vi.fn());

vi.mock("@/services/scheduleService", () => ({
  getUpcomingMeetings: getUpcoming,
  getRecentMeetings: getRecent,
}));

function meetings(count: number): Meeting[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    meeting_id: String(100000000 + i),
    host_id: 1,
    title: `Meeting ${i + 1}`,
    description: null,
    start_time: new Date(2026, 10, 8, 9, 0).toISOString(),
    end_time: null,
    duration: 30,
    status: "scheduled" as const,
    meeting_link: "",
    created_at: new Date().toISOString(),
  }));
}

/** Behaves like the real API: returns at most `limit` rows out of `total`. */
function serverWith(total: number) {
  return (limit: number) => Promise.resolve(meetings(Math.min(limit, total)));
}

beforeEach(() => {
  getUpcoming.mockReset();
  getRecent.mockReset();
});

describe("useMeetingList", () => {
  it("requests one page first and reports that more may exist", async () => {
    getUpcoming.mockImplementation(serverWith(35));
    const { result } = renderHook(() => useMeetingList("upcoming", 10));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getUpcoming).toHaveBeenCalledWith(10);
    expect(result.current.items).toHaveLength(10);
    expect(result.current.hasMore).toBe(true);
  });

  it("loads more by raising the limit and stops when the server runs out", async () => {
    getUpcoming.mockImplementation(serverWith(25));
    const { result } = renderHook(() => useMeetingList("upcoming", 10));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.loadMore();
    });
    expect(getUpcoming).toHaveBeenLastCalledWith(20);
    expect(result.current.items).toHaveLength(20);
    expect(result.current.hasMore).toBe(true);

    await act(async () => {
      await result.current.loadMore();
    });
    expect(getUpcoming).toHaveBeenLastCalledWith(30);
    expect(result.current.items).toHaveLength(25);
    expect(result.current.hasMore).toBe(false);
  });

  it("never asks for more than the API maximum and says when it is capped", async () => {
    getRecent.mockImplementation(serverWith(500));
    const { result } = renderHook(() => useMeetingList("recent", 50));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.loadMore();
    });
    expect(getRecent).toHaveBeenLastCalledWith(MAX_LIST_LIMIT);
    expect(result.current.items).toHaveLength(MAX_LIST_LIMIT);
    expect(result.current.hasMore).toBe(false);
    expect(result.current.capped).toBe(true);
  });

  it("keeps the rows already shown if loading more fails", async () => {
    getUpcoming.mockImplementationOnce(serverWith(40));
    const { result } = renderHook(() => useMeetingList("upcoming", 10));
    await waitFor(() => expect(result.current.loading).toBe(false));

    getUpcoming.mockRejectedValueOnce(new Error("boom"));
    await act(async () => {
      await result.current.loadMore();
    });
    expect(result.current.items).toHaveLength(10);
    expect(result.current.error).toBeTruthy();
    expect(result.current.loadingMore).toBe(false);
  });

  it("surfaces an error with no rows when the first request fails", async () => {
    getUpcoming.mockRejectedValue(new Error("down"));
    const { result } = renderHook(() => useMeetingList("upcoming", 10));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items).toEqual([]);
    expect(result.current.error).toBeTruthy();
  });
});
