"use client";

import { useCallback, useEffect, useState } from "react";
import { toUserMessage } from "@/lib/api-client";
import {
  getRecentMeetings,
  getUpcomingMeetings,
} from "@/services/scheduleService";
import type { Meeting } from "@/types/meeting";

export type MeetingListKind = "upcoming" | "recent";

/** Matches the backend's maximum `limit` for the schedule endpoints. */
export const MAX_LIST_LIMIT = 100;
export const DEFAULT_PAGE_SIZE = 10;

interface MeetingListState {
  items: Meeting[];
  /** The limit the current `items` were requested with. */
  limit: number;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
}

const fetchers: Record<MeetingListKind, (limit: number) => Promise<Meeting[]>> = {
  upcoming: getUpcomingMeetings,
  recent: getRecentMeetings,
};

/**
 * A meeting list that grows on demand. The API pages by `limit` (no offset), so
 * "Load more" re-requests with a larger limit and keeps the current rows on
 * screen while it does. `hasMore` is true when the server filled the whole
 * requested page, i.e. there may be more.
 */
export function useMeetingList(kind: MeetingListKind, pageSize: number = DEFAULT_PAGE_SIZE) {
  const [state, setState] = useState<MeetingListState>({
    items: [],
    limit: pageSize,
    loading: true,
    loadingMore: false,
    error: null,
  });

  useEffect(() => {
    let active = true;
    fetchers[kind](pageSize).then(
      (items) => {
        if (active) {
          setState({ items, limit: pageSize, loading: false, loadingMore: false, error: null });
        }
      },
      (error: unknown) => {
        if (active) {
          setState({
            items: [],
            limit: pageSize,
            loading: false,
            loadingMore: false,
            error: toUserMessage(error),
          });
        }
      }
    );
    return () => {
      active = false;
    };
  }, [kind, pageSize]);

  const retry = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const items = await fetchers[kind](pageSize);
      setState({ items, limit: pageSize, loading: false, loadingMore: false, error: null });
    } catch (error) {
      setState((current) => ({ ...current, loading: false, error: toUserMessage(error) }));
    }
  }, [kind, pageSize]);

  const loadMore = useCallback(async () => {
    const nextLimit = Math.min(state.limit + pageSize, MAX_LIST_LIMIT);
    setState((current) => ({ ...current, loadingMore: true, error: null }));
    try {
      const items = await fetchers[kind](nextLimit);
      setState({ items, limit: nextLimit, loading: false, loadingMore: false, error: null });
    } catch (error) {
      setState((current) => ({ ...current, loadingMore: false, error: toUserMessage(error) }));
    }
  }, [kind, pageSize, state.limit]);

  const hasMore = state.items.length >= state.limit && state.limit < MAX_LIST_LIMIT;
  /** True when we hit the API's ceiling and the page was still full. */
  const capped = state.items.length >= MAX_LIST_LIMIT;

  return { ...state, hasMore, capped, loadMore, retry };
}
