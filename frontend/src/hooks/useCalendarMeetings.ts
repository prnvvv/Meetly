"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toUserMessage } from "@/lib/api-client";
import { groupByDay, gridRange } from "@/lib/calendar";
import { getMeetingsInRange } from "@/services/scheduleService";
import type { Meeting } from "@/types/meeting";

interface State {
  year: number;
  month: number;
  items: Meeting[];
  error: string | null;
}

/** Real meetings for the visible calendar grid; refetches when the month changes. */
export function useCalendarMeetings(visibleMonth: Date, reloadKey = 0) {
  const year = visibleMonth.getFullYear();
  const month = visibleMonth.getMonth();
  const [state, setState] = useState<State | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    const { start, end } = gridRange(new Date(year, month, 1));
    getMeetingsInRange(start, end).then(
      (items) => {
        if (active) setState({ year, month, items, error: null });
      },
      (error: unknown) => {
        if (active) setState({ year, month, items: [], error: toUserMessage(error) });
      }
    );
    return () => {
      active = false;
    };
  }, [year, month, version, reloadKey]);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  const ready = state !== null && state.year === year && state.month === month;
  const items = useMemo(() => (ready && state ? state.items : []), [ready, state]);
  const byDay = useMemo(() => groupByDay(items), [items]);

  return {
    byDay,
    items,
    loading: !ready,
    error: ready && state ? state.error : null,
    refresh,
  };
}
