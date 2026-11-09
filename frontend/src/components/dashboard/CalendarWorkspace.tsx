"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { useToast } from "@/components/common/ToastProvider";
import { ChevronRightIcon } from "@/components/icons";
import { toUserMessage } from "@/lib/api-client";
import {
  addMonths,
  buildMonthGrid,
  dayKey,
  isCompleted,
  isPastDay,
  startOfMonth,
} from "@/lib/calendar";
import { buildInviteUrl, copyText, cx, formatTimeRange } from "@/lib/utils";
import { useCalendarMeetings } from "@/hooks/useCalendarMeetings";
import { createMeeting, endMeeting } from "@/services/meetingService";
import { getParticipants } from "@/services/participantService";
import type { Meeting } from "@/types/meeting";
import type { Participant } from "@/types/participant";
import { DayDialog } from "./DayDialog";
import { MeetingDialog } from "./MeetingDialog";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MAX_DOTS = 3;
const NO_MEETINGS: Meeting[] = [];

type DialogState = { kind: "schedule"; date: Date } | { kind: "edit"; meeting: Meeting } | null;

/** Participants for the meetings of the selected day, fetched lazily and cached. */
function useParticipants(meetings: Meeting[]) {
  const [cache, setCache] = useState<Record<string, Participant[] | "error">>({});
  const requested = useRef(new Set<string>());

  useEffect(() => {
    for (const meeting of meetings) {
      const id = meeting.meeting_id;
      if (requested.current.has(id)) continue;
      requested.current.add(id);
      getParticipants(id).then(
        (list) => setCache((current) => ({ ...current, [id]: list })),
        () => setCache((current) => ({ ...current, [id]: "error" }))
      );
    }
  }, [meetings]);

  return cache;
}

interface CalendarWorkspaceProps {
  /** Bumped by the page when meetings change elsewhere (e.g. edited from a list). */
  reloadKey: number;
  /** Called after this workspace changed a meeting, so sibling lists can refetch. */
  onChanged: () => void;
}

export function CalendarWorkspace({ reloadKey, onChanged }: CalendarWorkspaceProps) {
  const router = useRouter();
  const { toast } = useToast();

  const [today, setToday] = useState<Date | null>(null);
  // A fixed placeholder until mount: the server cannot know the viewer's date or
  // timezone, so seeding from `new Date()` here would mismatch on hydration.
  const [visibleMonth, setVisibleMonth] = useState(() => new Date(2000, 0, 1));
  const [selected, setSelected] = useState<Date>(() => new Date(2000, 0, 1));
  const [dayOpen, setDayOpen] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [pendingCancel, setPendingCancel] = useState<Meeting | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Client clock only after mount, so the prerendered HTML never disagrees with it.
    const id = window.setTimeout(() => {
      const now = new Date();
      setToday(now);
      setVisibleMonth(startOfMonth(now));
      setSelected(now);
    }, 0);
    return () => window.clearTimeout(id);
  }, []);

  const { byDay, loading, error, refresh } = useCalendarMeetings(visibleMonth, reloadKey, today !== null);
  const grid = useMemo(() => buildMonthGrid(visibleMonth), [visibleMonth]);
  const todayKey = today ? dayKey(today) : "";
  const selectedKey = dayKey(selected);
  const dayMeetings = useMemo(() => byDay.get(selectedKey) ?? [], [byDay, selectedKey]);
  const participants = useParticipants(dayOpen ? dayMeetings : NO_MEETINGS);

  const monthLabel = today
    ? visibleMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" })
    : "";
  const selectedIsToday = selectedKey === todayKey;
  const selectedInPast = today ? isPastDay(selected, today) : false;

  const goToMonth = (month: Date) => {
    setVisibleMonth(month);
    // Keep the selection in view: land on the same day number, or the 1st.
    setSelected(
      new Date(month.getFullYear(), month.getMonth(), Math.min(selected.getDate(), 28))
    );
  };
  const goToToday = () => {
    const now = new Date();
    setVisibleMonth(startOfMonth(now));
    setSelected(now);
  };

  const onKeyNav = (event: React.KeyboardEvent) => {
    if (dayOpen) return;
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
    if (!step) return;
    event.preventDefault();
    const next = new Date(selected.getFullYear(), selected.getMonth(), selected.getDate() + step);
    setSelected(next);
    if (next.getMonth() !== visibleMonth.getMonth()) setVisibleMonth(startOfMonth(next));
  };

  const copy = async (value: string, noun: string) => {
    const ok = await copyText(value);
    toast(ok ? `${noun} copied` : `Could not copy the ${noun.toLowerCase()}`, ok ? "success" : "error");
  };

  const copyInvitation = (meeting: Meeting) => {
    const { start, end } = formatTimeRange(meeting.start_time, meeting.duration);
    const when = new Date(meeting.start_time).toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
    const text = [
      `Join my Meetly meeting: ${meeting.title}`,
      `When: ${when}, ${end ? `${start} – ${end}` : start}`,
      `Meeting ID: ${meeting.meeting_id}`,
      `Link: ${buildInviteUrl(meeting.meeting_id)}`,
    ].join("\n");
    void copy(text, "Invitation");
  };

  async function startInstant() {
    setBusy(true);
    try {
      const meeting = await createMeeting({ title: "Instant Meeting" });
      router.push(`/meetings/${meeting.meeting_id}`);
    } catch (cause) {
      toast(toUserMessage(cause), "error");
      setBusy(false);
    }
  }

  async function confirmCancel() {
    if (!pendingCancel) return;
    const meeting = pendingCancel;
    setBusy(true);
    try {
      await endMeeting(meeting.meeting_id);
      toast(meeting.status === "scheduled" ? "Meeting cancelled" : "Meeting ended", "success");
      setPendingCancel(null);
      refresh();
      onChanged();
    } catch (cause) {
      toast(toUserMessage(cause), "error");
    } finally {
      setBusy(false);
    }
  }

  const closeDialog = useCallback(() => setDialog(null), []);

  return (
    <>
      {/* Calendar ---------------------------------------------------- */}
      <section className="panel cal" aria-labelledby="cal-heading">
        <header className="cal__head">
          <h2 className="panel__title" id="cal-heading" aria-live="polite">
            {monthLabel}
          </h2>
          <div className="cal__nav">
            <button type="button" className="btn btn--secondary btn--sm" onClick={goToToday}>
              Today
            </button>
            <button
              type="button"
              className="icon-button cal__arrow cal__arrow--prev"
              aria-label="Previous month"
              onClick={() => goToMonth(addMonths(visibleMonth, -1))}
            >
              <ChevronRightIcon size={18} />
            </button>
            <button
              type="button"
              className="icon-button cal__arrow"
              aria-label="Next month"
              onClick={() => goToMonth(addMonths(visibleMonth, 1))}
            >
              <ChevronRightIcon size={18} />
            </button>
          </div>
        </header>

        <div className="cal__weekdays" aria-hidden="true">
          {WEEKDAYS.map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>

        <div className="cal__grid" role="grid" aria-label={monthLabel} onKeyDown={onKeyNav}>
          {grid.map((cell) => {
            const meetings = byDay.get(cell.key) ?? [];
            const isSelected = cell.key === selectedKey;
            const upcomingCount = meetings.filter((m) => !isCompleted(m)).length;
            const doneCount = meetings.length - upcomingCount;
            const label = today
              ? cell.date.toLocaleDateString(undefined, {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })
              : "";
            return (
              <button
                key={cell.key}
                type="button"
                role="gridcell"
                tabIndex={isSelected ? 0 : -1}
                aria-selected={isSelected}
                aria-current={cell.key === todayKey ? "date" : undefined}
                aria-label={`${label}${meetings.length ? `, ${meetings.length} meeting${meetings.length > 1 ? "s" : ""}` : ""}`}
                className={cx(
                  "cal__cell",
                  !cell.inMonth && "cal__cell--outside",
                  cell.key === todayKey && "cal__cell--today",
                  isSelected && "cal__cell--selected"
                )}
                onClick={() => {
                  setSelected(cell.date);
                  if (!cell.inMonth) setVisibleMonth(startOfMonth(cell.date));
                  setDayOpen(true);
                }}
              >
                <span className="cal__num">{cell.date.getDate()}</span>
                {meetings.length > 0 && (
                  <span className="cal__dots" aria-hidden="true">
                    {Array.from({ length: Math.min(upcomingCount, MAX_DOTS) }).map((_, i) => (
                      <i key={`u${i}`} className="cal__dot cal__dot--upcoming" />
                    ))}
                    {Array.from({ length: Math.min(doneCount, MAX_DOTS - Math.min(upcomingCount, MAX_DOTS)) }).map(
                      (_, i) => (
                        <i key={`d${i}`} className="cal__dot cal__dot--done" />
                      )
                    )}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <footer className="cal__legend">
          <span>
            <i className="cal__dot cal__dot--upcoming" /> Scheduled
          </span>
          <span>
            <i className="cal__dot cal__dot--done" /> Completed
          </span>
          {error ? (
            <button type="button" className="cal__retry" onClick={refresh}>
              Couldn’t load meetings. Retry
            </button>
          ) : null}
        </footer>
      </section>

      {dayOpen ? (
        <DayDialog
          date={selected}
          isToday={selectedIsToday}
          isPast={selectedInPast}
          meetings={dayMeetings}
          loading={loading}
          participants={participants}
          busy={busy}
          suspended={dialog !== null || pendingCancel !== null}
          onClose={() => setDayOpen(false)}
          onSchedule={() => setDialog({ kind: "schedule", date: selected })}
          onInstant={startInstant}
          onEdit={(meeting) => setDialog({ kind: "edit", meeting })}
          onCancel={setPendingCancel}
          onCopyInvitation={copyInvitation}
          onCopyLink={(meeting) => copy(buildInviteUrl(meeting.meeting_id), "Invite link")}
        />
      ) : null}

      {dialog ? (
        <MeetingDialog
          meeting={dialog.kind === "edit" ? dialog.meeting : undefined}
          date={dialog.kind === "schedule" ? dialog.date : undefined}
          onClose={closeDialog}
          onSaved={(saved) => {
            closeDialog();
            const start = new Date(saved.start_time);
            // Follow the meeting to its (possibly new) day so the user sees the result.
            setSelected(start);
            setVisibleMonth(startOfMonth(start));
            refresh();
            onChanged();
          }}
        />
      ) : null}

      <ConfirmDialog
        open={pendingCancel !== null}
        title={pendingCancel?.status === "active" ? "End this meeting?" : "Cancel this meeting?"}
        message={
          pendingCancel?.status === "active"
            ? `“${pendingCancel.title}” is in progress. Ending it removes everyone from the room.`
            : `“${pendingCancel?.title ?? ""}” will be cancelled and removed from your schedule.`
        }
        confirmLabel={pendingCancel?.status === "active" ? "End meeting" : "Cancel meeting"}
        cancelLabel="Keep it"
        destructive
        onConfirm={confirmCancel}
        onCancel={() => (busy ? undefined : setPendingCancel(null))}
      />
    </>
  );
}
