import type { Meeting } from "@/types/meeting";

/** Local-time calendar helpers. Days are keyed "YYYY-MM-DD" in the viewer's timezone. */

export function dayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function addMonths(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

export interface CalendarCell {
  date: Date;
  key: string;
  inMonth: boolean;
}

/**
 * The visible grid for a month: whole weeks starting on Sunday, always six rows
 * so the calendar keeps one height as you page through months.
 */
export function buildMonthGrid(month: Date): CalendarCell[] {
  const first = startOfMonth(month);
  const gridStart = new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index);
    return { date, key: dayKey(date), inMonth: date.getMonth() === first.getMonth() };
  });
}

/** The [start, end) window the grid covers, for one range request. */
export function gridRange(month: Date): { start: Date; end: Date } {
  const grid = buildMonthGrid(month);
  const last = grid[grid.length - 1].date;
  return {
    start: grid[0].date,
    end: new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1),
  };
}

export function groupByDay(meetings: Meeting[]): Map<string, Meeting[]> {
  const groups = new Map<string, Meeting[]>();
  for (const meeting of meetings) {
    const start = new Date(meeting.start_time);
    if (Number.isNaN(start.getTime())) continue;
    const key = dayKey(start);
    const list = groups.get(key);
    if (list) list.push(meeting);
    else groups.set(key, [meeting]);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => a.start_time.localeCompare(b.start_time));
  }
  return groups;
}

/** Ended or cancelled: nothing left to do with it but look back. */
export function isCompleted(meeting: Meeting): boolean {
  return meeting.status === "ended" || meeting.status === "cancelled";
}

export function endOfMeeting(meeting: Meeting): Date | null {
  const start = new Date(meeting.start_time);
  if (Number.isNaN(start.getTime())) return null;
  if (meeting.end_time) return new Date(meeting.end_time);
  if (meeting.duration) return new Date(start.getTime() + meeting.duration * 60_000);
  return null;
}

/** A day before today cannot hold a new scheduled meeting. */
export function isPastDay(date: Date, now: Date = new Date()): boolean {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return date.getTime() < today.getTime();
}
