"use client";

import { useMemo } from "react";
import { useToast } from "@/components/common/ToastProvider";
import {
  CopyIcon,
  LinkIcon,
  MicIcon,
  MicOffIcon,
  PhoneOffIcon,
  PinIcon,
  UsersIcon,
  VideoIcon,
  VideoOffIcon,
  XIcon,
} from "@/components/icons";
import { WaitingRoomPanel } from "./WaitingRoomPanel";
import type { WaitingRoomControls } from "@/hooks/useMeeting";
import { ParticipantAvatar } from "@/components/meeting/ParticipantAvatar";
import { buildInviteUrl, copyText, cx } from "@/lib/utils";
import type { ParticipantSummary } from "@/types/participant";

interface ParticipantsPanelProps {
  participants: ParticipantSummary[];
  meetingId: string;
  localName: string;
  /** Authoritative — set from the server's `meeting_state.is_host`. */
  isHost?: boolean;
  selfId?: number | null;
  onClose: () => void;
  onMuteParticipant?: (targetId: number, muted: boolean) => void;
  onRemoveParticipant?: (targetId: number) => void;
  onMuteAll?: () => void;
  onEndMeeting?: () => void;
  /** Local-only pinned tile (spotlight). */
  pinnedId?: number | null;
  onTogglePin?: (participantId: number) => void;
  /** Host only: waiting-room switch and the people waiting. */
  waitingRoom?: WaitingRoomControls;
}

/** Host first, then you, then everyone else alphabetically. */
function sortRoster(
  participants: ParticipantSummary[],
  selfId: number | null
): ParticipantSummary[] {
  const rank = (participant: ParticipantSummary): number => {
    const isSelf = selfId !== null && participant.id === selfId;
    if (participant.is_host) return 0;
    return isSelf ? 1 : 2;
  };
  return [...participants].sort((a, b) => {
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;
    return a.display_name.localeCompare(b.display_name);
  });
}

function isSelf(
  participant: ParticipantSummary,
  selfId: number | null,
  localName: string
): boolean {
  if (selfId !== null) return participant.id === selfId;
  return participant.display_name === localName;
}

/** Slide-in panel listing who is in the meeting. */
export function ParticipantsPanel({
  participants,
  meetingId,
  localName,
  isHost = false,
  selfId = null,
  onClose,
  onMuteParticipant,
  onRemoveParticipant,
  onMuteAll,
  onEndMeeting,
  pinnedId = null,
  onTogglePin,
  waitingRoom,
}: ParticipantsPanelProps) {
  const { toast } = useToast();

  const roster = useMemo(
    () => sortRoster(participants, selfId),
    [participants, selfId]
  );

  const copy = async (value: string, ok: string) => {
    const copied = await copyText(value);
    toast(copied ? ok : "Could not copy to the clipboard", copied ? "success" : "error");
  };

  return (
    <aside
      className="room-panel"
      role="dialog"
      aria-label={`Participants (${participants.length})`}
    >
      <div className="room-panel__head">
        <span className="room-panel__title">
          Participants ({participants.length})
        </span>
        <button
          type="button"
          className="room-icon-button"
          aria-label="Close participants panel"
          onClick={onClose}
        >
          <XIcon size={18} />
        </button>
      </div>

      {isHost && (onMuteAll || onEndMeeting) ? (
        <div className="room-panel__hostbar">
          <span className="room-panel__hostbar-label">
            <UsersIcon size={14} />
            Host controls
          </span>
          <div className="room-panel__hostbar-actions">
            {onMuteAll ? (
              <button
                type="button"
                className="room__chip"
                onClick={onMuteAll}
                aria-label="Mute everyone except the host"
              >
                <MicOffIcon size={14} />
                Mute all
              </button>
            ) : null}
            {onEndMeeting ? (
              <button
                type="button"
                className="room__chip room__chip--danger"
                onClick={onEndMeeting}
                aria-label="End meeting for everyone"
              >
                <PhoneOffIcon size={14} />
                End meeting
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {isHost && waitingRoom ? <WaitingRoomPanel controls={waitingRoom} /> : null}

      <div className="room-panel__body">
        {roster.length === 0 ? (
          <p className="room-panel__empty">Nobody else is here yet.</p>
        ) : (
          roster.map((participant) => {
            const you = isSelf(participant, selfId, localName);
            const canAct = isHost && !you;
            return (
              <div className="participant-row" key={participant.id}>
                <ParticipantAvatar
                  name={participant.display_name}
                  variant={participant.id > 0 ? participant.id : undefined}
                  size={36}
                  accent={false}
                  className="participant-row__avatar"
                />
                <div className="participant-row__body">
                  <div className="participant-row__name">
                    <span>{participant.display_name}</span>
                    {participant.is_host ? (
                      <span className="participant-row__badge">Host</span>
                    ) : null}
                    {you ? (
                      <span className="participant-row__badge participant-row__badge--muted">
                        You
                      </span>
                    ) : null}
                  </div>
                  <div className="participant-row__meta">
                    {participant.is_muted ? "Muted" : "Unmuted"}
                    {" · "}
                    {participant.is_video_on ? "Camera on" : "Camera off"}
                  </div>
                </div>

                <div className="participant-row__indicators">
                  {participant.is_muted ? (
                    <span
                      className="participant-row__indicator"
                      title="Muted"
                      aria-label={`${participant.display_name} is muted`}
                    >
                      <MicOffIcon size={14} />
                    </span>
                  ) : (
                    <span
                      className="participant-row__indicator participant-row__indicator--on"
                      title="Unmuted"
                      aria-label={`${participant.display_name} is unmuted`}
                    >
                      <MicIcon size={14} />
                    </span>
                  )}
                  {participant.is_video_on ? (
                    <span
                      className="participant-row__indicator participant-row__indicator--on"
                      title="Camera on"
                      aria-label={`${participant.display_name} camera is on`}
                    >
                      <VideoIcon size={14} />
                    </span>
                  ) : (
                    <span
                      className="participant-row__indicator"
                      title="Camera off"
                      aria-label={`${participant.display_name} camera is off`}
                    >
                      <VideoOffIcon size={14} />
                    </span>
                  )}
                </div>

                {(onTogglePin || (canAct && (onMuteParticipant || onRemoveParticipant))) ? (
                  <div className="participant-row__actions">
                    {onTogglePin ? (
                      <button
                        type="button"
                        className={cx(
                          "room-icon-button",
                          pinnedId === participant.id && "room-icon-button--active"
                        )}
                        aria-pressed={pinnedId === participant.id}
                        aria-label={
                          pinnedId === participant.id
                            ? `Unpin ${participant.display_name}`
                            : `Pin ${participant.display_name} to the stage`
                        }
                        onClick={() => onTogglePin(participant.id)}
                      >
                        <PinIcon size={16} />
                      </button>
                    ) : null}
                    {canAct && onMuteParticipant ? (
                      <button
                        type="button"
                        className="room-icon-button"
                        aria-label={
                          participant.is_muted
                            ? `Ask ${participant.display_name} to unmute`
                            : `Mute ${participant.display_name}`
                        }
                        onClick={() =>
                          onMuteParticipant(participant.id, !participant.is_muted)
                        }
                      >
                        {participant.is_muted ? (
                          <MicIcon size={16} />
                        ) : (
                          <MicOffIcon size={16} />
                        )}
                      </button>
                    ) : null}
                    {onRemoveParticipant ? (
                      <button
                        type="button"
                        className="room-icon-button room-icon-button--danger"
                        aria-label={`Remove ${participant.display_name} from the meeting`}
                        onClick={() => onRemoveParticipant(participant.id)}
                      >
                        <XIcon size={16} />
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>

      <div className="room-panel__footer">
        <div className="room-panel__invite">
          <span className="room-panel__invite-label">Meeting ID</span>
          <span className="room-panel__invite-value">{meetingId}</span>
          <button
            type="button"
            className="room-icon-button"
            aria-label="Copy meeting ID"
            onClick={() => void copy(meetingId, "Meeting ID copied")}
          >
            <CopyIcon size={16} />
          </button>
        </div>
        <button
          type="button"
          className="room__chip"
          onClick={() =>
            void copy(buildInviteUrl(meetingId), "Invite link copied")
          }
          aria-label="Copy invite link"
        >
          <LinkIcon size={14} />
          Copy invite link
        </button>
      </div>
    </aside>
  );
}
