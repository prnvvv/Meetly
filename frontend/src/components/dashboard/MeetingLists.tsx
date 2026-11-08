"use client";

import Link from "next/link";
import { useState } from "react";
import { ErrorState } from "@/components/common/ErrorState";
import { Skeleton } from "@/components/common/Skeleton";
import { CalendarIcon, ChevronRightIcon, ClockIcon, UsersIcon, VideoIcon } from "@/components/icons";
import { cx, formatDayLabel, formatDuration, formatTimeRange, statusLabel } from "@/lib/utils";
import type { AsyncList } from "@/hooks/useDashboardData";
import type { Meeting } from "@/types/meeting";
import { MeetingDialog } from "./MeetingDialog";

interface ListPanelProps {
  title: string;
  id: string;
  viewAllHref: string;
  list: AsyncList<Meeting>;
  limit: number;
  onRetry: () => void;
  empty: { icon: React.ReactNode; title: string; text: string; href: string; cta: string };
  renderRow: (meeting: Meeting) => React.ReactNode;
}

/**
 * Compact list panel. It never shows more than `limit` rows; the rest lives
 * behind "View all" on the Meetings page, so history can never grow the dashboard.
 */
function ListPanel({ title, id, viewAllHref, list, limit, onRetry, empty, renderRow }: ListPanelProps) {
  const extra = Math.max(0, list.items.length - limit);
  return (
    <section className="panel lp" aria-labelledby={`${id}-heading`}>
      <header className="lp__head">
        <h2 className="lp__title" id={`${id}-heading`}>
          {title}
        </h2>
        <Link href={viewAllHref} className="panel__link">
          {extra > 0 ? `View all (${list.items.length}+)` : "View all"}
        </Link>
      </header>
      <div className="lp__body">
        {list.loading ? (
          <div className="lp__rows" aria-hidden="true">
            {Array.from({ length: limit }).map((_, i) => (
              <Skeleton key={i} className="skeleton--line" style={{ height: 44, marginBottom: 0 }} />
            ))}
          </div>
        ) : list.error ? (
          <ErrorState message={list.error} onRetry={onRetry} />
        ) : list.items.length === 0 ? (
          <div className="lp__empty">
            <span className="lp__empty-icon" aria-hidden="true">
              {empty.icon}
            </span>
            <div className="lp__empty-text">
              <strong>{empty.title}</strong>
              <span>{empty.text}</span>
            </div>
            <Link href={empty.href} className="btn btn--secondary btn--sm">
              {empty.cta}
            </Link>
          </div>
        ) : (
          <ul className="lp__rows">{list.items.slice(0, limit).map(renderRow)}</ul>
        )}
      </div>
    </section>
  );
}

interface MeetingListsProps {
  upcoming: AsyncList<Meeting>;
  recent: AsyncList<Meeting>;
  limit: number;
  onRetry: () => void;
  /** A meeting was edited from a list: refetch everything. */
  onChanged: () => void;
}

export function MeetingLists({ upcoming, recent, limit, onRetry, onChanged }: MeetingListsProps) {
  const [editing, setEditing] = useState<Meeting | null>(null);

  return (
    <div className="lists">
      <ListPanel
        title="Upcoming"
        id="upcoming"
        viewAllHref="/meetings"
        list={upcoming}
        limit={limit}
        onRetry={onRetry}
        empty={{
          icon: <CalendarIcon size={20} />,
          title: "No upcoming meetings",
          text: "Pick a date on the calendar to plan one.",
          href: "/schedule",
          cta: "Schedule",
        }}
        renderRow={(meeting) => {
          const { start, end } = formatTimeRange(meeting.start_time, meeting.duration);
          const duration = formatDuration(meeting.duration);
          return (
            <li key={meeting.meeting_id} className="row">
              <div className="row__body">
                <span className="row__title">{meeting.title}</span>
                <span className="row__meta">
                  <ClockIcon size={13} aria-hidden="true" />
                  {formatDayLabel(meeting.start_time)}, {end ? `${start} – ${end}` : start}
                  {duration ? ` · ${duration}` : ""}
                </span>
              </div>
              <span className="badge badge--scheduled row__badge">{statusLabel(meeting.status)}</span>
              <div className="row__actions">
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={() => setEditing(meeting)}
                  aria-label={`Edit ${meeting.title}`}
                >
                  Edit
                </button>
                <Link
                  href={`/meetings/${meeting.meeting_id}`}
                  className="btn btn--primary btn--sm"
                  aria-label={`Join ${meeting.title}`}
                >
                  Join
                </Link>
              </div>
            </li>
          );
        }}
      />

      <ListPanel
        title="Recent"
        id="recent"
        viewAllHref="/meetings?tab=recent"
        list={recent}
        limit={limit}
        onRetry={onRetry}
        empty={{
          icon: <VideoIcon size={20} />,
          title: "No recent meetings",
          text: "Meetings you host or attend show up here.",
          href: "/new-meeting",
          cta: "New meeting",
        }}
        renderRow={(meeting) => {
          const duration = formatDuration(meeting.duration);
          return (
            <li key={meeting.meeting_id} className="row row--link">
              <Link
                href={`/meetings/${meeting.meeting_id}`}
                className="row__link"
                aria-label={`Open ${meeting.title}`}
              >
                <span className="row__body">
                  <span className="row__title">{meeting.title}</span>
                  <span className="row__meta">
                    <UsersIcon size={13} aria-hidden="true" />
                    Hosted by you · {formatDayLabel(meeting.start_time)}
                    {duration ? ` · ${duration}` : ""}
                  </span>
                </span>
                <span className={cx("badge", `badge--${meeting.status}`, "row__badge")}>
                  {statusLabel(meeting.status)}
                </span>
                <ChevronRightIcon size={16} className="row__chevron" aria-hidden="true" />
              </Link>
            </li>
          );
        }}
      />

      {editing ? (
        <MeetingDialog
          meeting={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
        />
      ) : null}
    </div>
  );
}
