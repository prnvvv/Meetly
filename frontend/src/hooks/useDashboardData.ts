"use client";

import { useCallback, useEffect, useState } from "react";
import { toUserMessage } from "@/lib/api-client";
import {
  getRecentMeetings,
  getUpcomingMeetings,
} from "@/services/scheduleService";
import type { Meeting } from "@/types/meeting";

export interface AsyncList<T> {
  items: T[];
  loading: boolean;
  error: string | null;
}

interface DashboardData {
  upcoming: AsyncList<Meeting>;
  recent: AsyncList<Meeting>;
  refresh: () => Promise<void>;
}

/** The dashboard previews a few meetings per panel; "View all" holds the rest. */
export const PREVIEW_LIMIT = 3;

const EMPTY: AsyncList<Meeting> = { items: [], loading: true, error: null };

function toList<T>(result: PromiseSettledResult<T[]>): AsyncList<T> {
  if (result.status === "fulfilled") {
    return { items: result.value, loading: false, error: null };
  }
  return { items: [], loading: false, error: toUserMessage(result.reason) };
}

async function fetchLists(limit: number): Promise<{
  upcoming: AsyncList<Meeting>;
  recent: AsyncList<Meeting>;
}> {
  const [upcomingResult, recentResult] = await Promise.allSettled([
    getUpcomingMeetings(limit),
    getRecentMeetings(limit),
  ]);
  return {
    upcoming: toList(upcomingResult),
    recent: toList(recentResult),
  };
}

/** Loads upcoming and recent meetings for the dashboard. */
export function useDashboardData(limit: number = PREVIEW_LIMIT): DashboardData {
  const [upcoming, setUpcoming] = useState<AsyncList<Meeting>>(EMPTY);
  const [recent, setRecent] = useState<AsyncList<Meeting>>(EMPTY);

  useEffect(() => {
    let active = true;
    void fetchLists(limit).then((lists) => {
      if (!active) return;
      setUpcoming(lists.upcoming);
      setRecent(lists.recent);
    });
    return () => {
      active = false;
    };
  }, [limit]);

  const refresh = useCallback(async () => {
    setUpcoming((current) => ({ ...current, loading: true, error: null }));
    setRecent((current) => ({ ...current, loading: true, error: null }));
    const lists = await fetchLists(limit);
    setUpcoming(lists.upcoming);
    setRecent(lists.recent);
  }, [limit]);

  return { upcoming, recent, refresh };
}
