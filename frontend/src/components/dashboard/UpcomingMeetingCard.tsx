"use client";

import Link from "next/link";
import { DropdownMenu } from "@/components/common/DropdownMenu";
import { useToast } from "@/components/common/ToastProvider";
import {
  CalendarIcon,
  ClockIcon,
  CopyIcon,
  LinkIcon,
  MoreVerticalIcon,
} from "@/components/icons";
import { useCountdown } from "@/hooks/useCountdown";
import {
  buildInviteUrl,
  copyText,
  cx,
  formatCountdown,
  formatDate,
  formatTimeRange,
  isPast,
  statusLabel,
  statusTone,
} from "@/lib/utils";
import type { Meeting } from "@/types/meeting";

interface UpcomingMeetingCardProps {
  meeting: Meeting;
}

/** Meetly card for a scheduled meeting with a live "starts in" pill. */
export function UpcomingMeetingCard({ meeting }: UpcomingMeetingCardProps) {
  const now = useCountdown();
  const { toast } = useToast();
  const { start, end } = formatTimeRange(meeting.start_time, meeting.duration);
  const countdown = formatCountdown(meeting.start_time, now);
  const started = isPast(meeting.start_time, now);

  const copyLink = async () => {
    const ok = await copyText(buildInviteUrl(meeting.meeting_id));
    toast(
      ok ? "Invite link copied" : "Could not copy the invite link",
      ok ? "success" : "error"
    );
  };

  const copyMeetingId = async () => {
    const ok = await copyText(meeting.meeting_id);
    toast(
      ok ? "Meeting ID copied" : "Could not copy the meeting ID",
      ok ? "success" : "error"
    );
  };

  return (
    <article className="meeting-card">
      <div className="meeting-card__top">
        <div>
          <h3 className="meeting-card__title">{meeting.title}</h3>
          <div className="meeting-card__meta">
            <span className="meeting-card__meta-item">
              <CalendarIcon size={15} />
              {formatDate(meeting.start_time)}
            </span>
            <span className="meeting-card__meta-item">
              <ClockIcon size={15} />
              {end ? `${start} – ${end}` : start}
            </span>
          </div>
        </div>
        <span
          className={cx(
            "badge",
            statusTone(meeting.status) && `badge--${statusTone(meeting.status)}`
          )}
        >
          {statusLabel(meeting.status)}
        </span>
      </div>

      <span className="meeting-card__countdown">
        <ClockIcon size={13} />
        {started ? "Starting now" : `Starts in ${countdown}`}
      </span>

      <div className="meeting-card__actions">
        <Link
          href={`/meetings/${meeting.meeting_id}`}
          className="btn btn--primary btn--sm"
        >
          Join
        </Link>
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          onClick={copyLink}
        >
          <LinkIcon size={15} />
          Copy link
        </button>
        <DropdownMenu
          label="More options for this meeting"
          trigger={<MoreVerticalIcon size={18} />}
          items={[
            {
              key: "copy-id",
              label: "Copy meeting ID",
              icon: <CopyIcon size={16} />,
              onSelect: copyMeetingId,
            },
          ]}
        />
      </div>
    </article>
  );
}
