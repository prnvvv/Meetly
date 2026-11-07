"use client";

import Link from "next/link";
import { DropdownMenu } from "@/components/common/DropdownMenu";
import { useToast } from "@/components/common/ToastProvider";
import {
  CalendarIcon,
  ChevronRightIcon,
  CopyIcon,
  LinkIcon,
  MoreVerticalIcon,
  PlusIcon,
  VideoIcon,
} from "@/components/icons";
import {
  buildInviteUrl,
  copyText,
  formatDayLabel,
  formatDuration,
  formatTimeRange,
} from "@/lib/utils";
import type { Meeting } from "@/types/meeting";

/** Rows are list items; wrap them in <ul className="meeting-list">. */

/** Scheduled meeting: calendar tile, title, "Today, 10:00 AM - 10:30 AM", Join and a menu. */
export function UpcomingRow({ meeting }: { meeting: Meeting }) {
  const { toast } = useToast();
  const { start, end } = formatTimeRange(meeting.start_time, meeting.duration);
  const when = [formatDayLabel(meeting.start_time), end ? `${start} – ${end}` : start]
    .filter(Boolean)
    .join(", ");

  const copy = async (value: string, noun: string) => {
    const ok = await copyText(value);
    toast(ok ? `${noun} copied` : `Could not copy the ${noun.toLowerCase()}`, ok ? "success" : "error");
  };

  return (
    <li className="meeting-item">
      <span className="meeting-item__icon" aria-hidden="true">
        <CalendarIcon size={22} />
      </span>
      <div className="meeting-item__body">
        <div className="meeting-item__title">{meeting.title}</div>
        <div className="meeting-item__meta">{when}</div>
      </div>
      <div className="meeting-item__side">
        <Link
          href={`/meetings/${meeting.meeting_id}`}
          className="btn btn--primary btn--sm"
          aria-label={`Join ${meeting.title}`}
        >
          Join
        </Link>
        <DropdownMenu
          label={`More options for ${meeting.title}`}
          trigger={<MoreVerticalIcon size={18} />}
          items={[
            {
              key: "copy-link",
              label: "Copy invite link",
              icon: <LinkIcon size={16} />,
              onSelect: () => copy(buildInviteUrl(meeting.meeting_id), "Invite link"),
            },
            {
              key: "copy-id",
              label: "Copy meeting ID",
              icon: <CopyIcon size={16} />,
              onSelect: () => copy(meeting.meeting_id, "Meeting ID"),
            },
          ]}
        />
      </div>
    </li>
  );
}

/** Finished meeting: camera tile, title, "Yesterday, 45 min", whole row opens the meeting. */
export function RecentRow({ meeting }: { meeting: Meeting }) {
  const duration = formatDuration(meeting.duration);
  const when = [formatDayLabel(meeting.start_time), duration].filter(Boolean).join(", ");

  return (
    <li className="meeting-item meeting-item--link">
      <Link
        href={`/meetings/${meeting.meeting_id}`}
        className="meeting-item__link"
        aria-label={`Open ${meeting.title}`}
      >
        <span className="meeting-item__icon" aria-hidden="true">
          <VideoIcon size={22} />
        </span>
        <span className="meeting-item__body">
          <span className="meeting-item__title">{meeting.title}</span>
          <span className="meeting-item__meta">{when}</span>
        </span>
        <ChevronRightIcon className="meeting-item__chevron" size={20} aria-hidden="true" />
      </Link>
    </li>
  );
}

/**
 * Last row of a partly filled panel: a real shortcut that takes the place of
 * an unused slot, so a panel with one or two meetings still looks complete.
 */
export function AddRow({ href, label }: { href: string; label: string }) {
  return (
    <li className="meeting-item meeting-item--add">
      <Link href={href} className="meeting-add">
        <span className="meeting-add__icon" aria-hidden="true">
          <PlusIcon size={20} />
        </span>
        <span className="meeting-add__label">{label}</span>
      </Link>
    </li>
  );
}
