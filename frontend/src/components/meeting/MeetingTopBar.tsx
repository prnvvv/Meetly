"use client";

import {
  CopyIcon,
  MaximizeIcon,
  MinimizeIcon,
  ShieldIcon,
  UsersIcon,
} from "@/components/icons";
import { cx } from "@/lib/utils";

interface MeetingTopBarProps {
  title: string;
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

/** Meeting header: identity on the left, utilities on the right. */
export function MeetingTopBar({
  title,
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
      <div className="room__identity">
        <span
          className="room__security"
          title="This meeting is protected by a meeting ID"
          aria-label="Meeting security status"
        >
          <ShieldIcon size={16} />
        </span>
        <div className="room__heading">
          <div className="room__title">{title}</div>
          <div className="room__subtitle">
            <span className="room__id">{meetingId}</span>
            <span className="room__meeting-label">Meeting ID</span>
            {isLive ? (
              <span className="room__chip room__chip--live">Live</span>
            ) : null}
            <span
              className={cx(
                "room__connection",
                connection === "reconnecting" &&
                  "room__connection--reconnecting",
                connection === "disconnected" && "room__connection--failed"
              )}
            >
              {connectionLabel(connection)}
            </span>
          </div>
        </div>
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
