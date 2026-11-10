"use client";

import {
  CopyIcon,
  MaximizeIcon,
  MinimizeIcon,
  ShieldIcon,
  UsersIcon,
  VideoIcon,
} from "@/components/icons";
import { APP_NAME } from "@/lib/constants";
import { cx } from "@/lib/utils";

interface MeetingTopBarProps {
  title: string;
  /** Host display name (or email); falls back to the meeting title. */
  hostName?: string | null;
  meetingId: string;
  connection: "connecting" | "connected" | "reconnecting" | "disconnected";
  participantCount: number;
  isLive: boolean;
  participantsOpen: boolean;
  isFullscreen: boolean;
  fullscreenSupported: boolean;
  onToggleParticipants: () => void;
  onCopyInvite: () => void;
  onToggleFullscreen: () => void;
}

function connectionLabel(status: MeetingTopBarProps["connection"]): string {
  switch (status) {
    case "connected":
      return "Connected";
    case "reconnecting":
      return "Reconnecting…";
    case "disconnected":
      return "Disconnected";
    default:
      return "Connecting…";
  }
}

/**
 * Compact room header: Meetly brand and meeting facts on the left, utilities
 * on the right. The brand reuses the app's `.brand` markup (not a link, so a
 * stray click can never leave a live call).
 */
export function MeetingTopBar({
  title,
  hostName,
  meetingId,
  connection,
  participantCount,
  isLive,
  participantsOpen,
  isFullscreen,
  fullscreenSupported,
  onToggleParticipants,
  onCopyInvite,
  onToggleFullscreen,
}: MeetingTopBarProps) {
  return (
    <header className="room__header">
      <span className="brand room__brand">
        <VideoIcon size={22} strokeWidth={2.25} />
        <span className="brand__name">{APP_NAME}</span>
      </span>

      <div className="room__info" title={title}>
        <span
          className="room__security"
          title="This meeting is protected by a meeting ID"
          aria-label="Meeting security status"
        >
          <ShieldIcon size={14} />
        </span>
        <span className="room__host">{hostName || title}</span>
        <span className="room__sep" aria-hidden="true" />
        <span className="room__id">{meetingId}</span>
        {isLive ? <span className="room__chip room__chip--live">Live</span> : null}
        <span
          data-state={connection}
          className={cx(
            "room__connection",
            connection === "reconnecting" && "room__connection--reconnecting",
            connection === "disconnected" && "room__connection--failed"
          )}
        >
          {connectionLabel(connection)}
        </span>
      </div>

      <div className="room__header-actions">
        <button
          type="button"
          className={cx(
            "room__header-button",
            participantsOpen && "room__header-button--active"
          )}
          aria-pressed={participantsOpen}
          aria-label={`Show participants, ${participantCount} in the meeting`}
          title="Participants"
          onClick={onToggleParticipants}
        >
          <UsersIcon size={16} />
          <span className="room__header-button-label">{participantCount}</span>
        </button>

        <button
          type="button"
          className="room__header-button room__header-button--wide"
          onClick={onCopyInvite}
          aria-label="Copy invite link"
          title="Copy invite link"
        >
          <CopyIcon size={15} />
          <span className="room__header-button-label">Copy invite</span>
        </button>

        {fullscreenSupported ? (
          <button
            type="button"
            className="room__header-button"
            onClick={onToggleFullscreen}
            aria-label={isFullscreen ? "Exit full screen" : "Enter full screen"}
            title={isFullscreen ? "Exit full screen" : "Enter full screen"}
          >
            {isFullscreen ? <MinimizeIcon size={16} /> : <MaximizeIcon size={16} />}
          </button>
        ) : null}
      </div>
    </header>
  );
}
