"use client";

import { ParticipantAvatar } from "@/components/meeting/ParticipantAvatar";
import { HeadingBloom } from "@/components/common/HeadingBloom";

interface WaitingRoomScreenProps {
  title: string;
  hostName: string | null;
  connection: "connecting" | "connected" | "reconnecting" | "disconnected";
  onLeave: () => void;
  onReconnect: () => void;
}

/**
 * What a guest sees while the host decides. It uses the same full-room screen
 * language as the "ended" / "removed" states and shows only the meeting title and
 * host name; nothing about the room or the other people in it.
 */
export function WaitingRoomScreen({
  title,
  hostName,
  connection,
  onLeave,
  onReconnect,
}: WaitingRoomScreenProps) {
  const offline = connection === "disconnected";
  return (
    <div className="room room-loading">
      <div className="room-overlay-screen wr-screen" role="status" aria-live="polite">
        <ParticipantAvatar name="Meetly" variant={2} size={120} accent={false} />
        <h1 className="room-overlay-screen__title">
          Waiting for the{" "}
          <span className="relative inline-block">
            host
            <HeadingBloom />
          </span>
        </h1>
        <div className="room-overlay-screen__text">
          {offline
            ? "The connection was lost. Reconnect to keep your place."
            : connection === "reconnecting"
              ? "Reconnecting…"
              : "You will join as soon as the host lets you in."}
        </div>

        <dl className="wr-meeting">
          <div>
            <dt>Meeting</dt>
            <dd>{title}</dd>
          </div>
          {hostName ? (
            <div>
              <dt>Host</dt>
              <dd>{hostName}</dd>
            </div>
          ) : null}
        </dl>

        {!offline ? <span className="spinner" aria-hidden="true" /> : null}

        <div className="wr-screen__actions">
          {offline ? (
            <button type="button" className="btn btn--primary" onClick={onReconnect}>
              Reconnect
            </button>
          ) : null}
          <button type="button" className="btn btn--secondary" onClick={onLeave}>
            Leave
          </button>
        </div>
      </div>
    </div>
  );
}
