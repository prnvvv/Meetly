"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Skeleton } from "@/components/common/Skeleton";
import {
  CalendarIcon,
  ClockIcon,
  CopyIcon,
  LinkIcon,
  PlusIcon,
  TrashIcon,
  UsersIcon,
  VideoIcon,
  XIcon,
} from "@/components/icons";
import { isCompleted } from "@/lib/calendar";
import { cx, formatTimeRange, statusLabel } from "@/lib/utils";
import type { Meeting } from "@/types/meeting";
import type { Participant } from "@/types/participant";

export type ParticipantCache = Record<string, Participant[] | "error">;

export function participantSummary(entry: Participant[] | "error" | undefined): string {
  if (entry === undefined) return "Loading participants…";
  if (entry === "error") return "Participants unavailable";
  if (entry.length === 0) return "No participants yet";
  const names = entry.slice(0, 2).map((p) => p.display_name);
  const rest = entry.length - names.length;
  return rest > 0 ? `${names.join(", ")} +${rest}` : names.join(", ");
}

interface DayDialogProps {
  date: Date;
  isToday: boolean;
  isPast: boolean;
  meetings: Meeting[];
  loading: boolean;
  participants: ParticipantCache;
  busy: boolean;
  /** Another dialog (edit / confirm) is on top: ignore Escape so only that one closes. */
  suspended: boolean;
  onClose: () => void;
  onSchedule: () => void;
  onInstant: () => void;
  onEdit: (meeting: Meeting) => void;
  onCancel: (meeting: Meeting) => void;
  onCopyInvitation: (meeting: Meeting) => void;
  onCopyLink: (meeting: Meeting) => void;
}

/** Small popup for one calendar day: its meetings and every action available for it. */
export function DayDialog({
  date,
  isToday,
  isPast,
  meetings,
  loading,
  participants,
  busy,
  suspended,
  onClose,
  onSchedule,
  onInstant,
  onEdit,
  onCancel,
  onCopyInvitation,
  onCopyLink,
}: DayDialogProps) {
  useEffect(() => {
    if (suspended) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, suspended]);

  const label = date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="dialog dialog--day"
        role="dialog"
        aria-modal="true"
        aria-labelledby="day-dialog-title"
      >
        <div className="dialog__head">
          <div>
            <p className="eyebrow">{isToday ? "Today" : "Selected date"}</p>
            <h2 className="dialog__title" id="day-dialog-title">
              {label}
            </h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <XIcon size={18} />
          </button>
        </div>

        <div className="day__body" aria-live="polite">
          {loading ? (
            <div className="day__list" aria-hidden="true">
              <Skeleton className="skeleton--line" style={{ height: 64 }} />
              <Skeleton className="skeleton--line" style={{ height: 64 }} />
            </div>
          ) : meetings.length === 0 ? (
            <div className="day__empty">
              <span className="day__empty-icon" aria-hidden="true">
                <CalendarIcon size={26} />
              </span>
              <h3>{isPast ? "No meetings on this day" : "Nothing planned"}</h3>
              <p>
                {isPast
                  ? "Meetings you host or join on this date will appear here."
                  : "This day is free. Plan a meeting or jump into one right now."}
              </p>
            </div>
          ) : (
            <ul className="day__list">
              {meetings.map((meeting) => {
                const { start, end } = formatTimeRange(meeting.start_time, meeting.duration);
                const live = meeting.status === "scheduled" || meeting.status === "active";
                return (
                  <li key={meeting.meeting_id} className={cx("event", isCompleted(meeting) && "event--done")}>
                    <div className="event__top">
                      <h3 className="event__title">{meeting.title}</h3>
                      <span className={cx("badge", `badge--${meeting.status}`)}>
                        {statusLabel(meeting.status)}
                      </span>
                    </div>
                    <p className="event__meta">
                      <ClockIcon size={14} aria-hidden="true" />
                      {end ? `${start} – ${end}` : start}
                    </p>
                    <p className="event__meta">
                      <UsersIcon size={14} aria-hidden="true" />
                      {participantSummary(participants[meeting.meeting_id])}
                    </p>
                    <p className="event__meta event__meta--mono">ID {meeting.meeting_id}</p>
                    <div className="event__actions">
                      {live && (
                        <Link href={`/meetings/${meeting.meeting_id}`} className="btn btn--primary btn--sm">
                          Join
                        </Link>
                      )}
                      {meeting.status === "scheduled" && (
                        <button type="button" className="btn btn--secondary btn--sm" onClick={() => onEdit(meeting)}>
                          Edit
                        </button>
                      )}
                      <button
                        type="button"
                        className="icon-button event__icon"
                        aria-label={`Copy invitation for ${meeting.title}`}
                        title="Copy invitation"
                        onClick={() => onCopyInvitation(meeting)}
                      >
                        <CopyIcon size={16} />
                      </button>
                      <button
                        type="button"
                        className="icon-button event__icon"
                        aria-label={`Copy link for ${meeting.title}`}
                        title="Copy link"
                        onClick={() => onCopyLink(meeting)}
                      >
                        <LinkIcon size={16} />
                      </button>
                      {live && (
                        <button
                          type="button"
                          className="icon-button event__icon event__icon--danger"
                          aria-label={`${meeting.status === "scheduled" ? "Cancel" : "End"} ${meeting.title}`}
                          title={meeting.status === "scheduled" ? "Cancel meeting" : "End meeting"}
                          onClick={() => onCancel(meeting)}
                        >
                          <TrashIcon size={16} />
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <footer className="day__actions">
          <button
            type="button"
            className="btn btn--primary btn--sm"
            disabled={isPast}
            aria-label="Schedule here"
            title={isPast ? "Pick today or a later date to schedule" : "Schedule a meeting on this date"}
            onClick={onSchedule}
          >
            <PlusIcon size={16} />
            Schedule
          </button>
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            onClick={onInstant}
            disabled={busy}
            aria-label="Instant meeting"
            title="Start an instant meeting"
          >
            <VideoIcon size={16} />
            Instant
          </button>
          <Link href="/join" className="btn btn--secondary btn--sm">
            <LinkIcon size={16} />
            Join
          </Link>
        </footer>
      </div>
    </div>
  );
}

