import { HeadingBloom } from "@/components/common/HeadingBloom";
import { MicIcon, MicOffIcon, VideoOffIcon } from "@/components/icons";
import { cx } from "@/lib/utils";

interface ParticipantStatusProps {
  /** Display name, already including "(You)" for the local participant. */
  name: string;
  isMuted: boolean;
  /** Only the camera-off state is surfaced; an active camera needs no badge. */
  isVideoOn: boolean;
  /** Active speaker: shows the Meetly equalizer in the name tag. */
  speaking?: boolean;
}

/**
 * Footer of a participant tile. Renders two siblings for the tile footer's
 * space-between layout: the name pill (bottom-left) and the microphone /
 * camera indicators (bottom-right). State is carried by icon shape and
 * accessible text, never colour alone.
 */
export function ParticipantStatus({
  name,
  isMuted,
  isVideoOn,
  speaking = false,
}: ParticipantStatusProps) {
  return (
    <>
      <span className={cx("p-status", speaking && "p-status--speaking")}>
        {speaking ? (
          <span className="p-eq" role="img" aria-label="Speaking">
            <i className="eq-bar" style={{ animationDelay: "0ms" }} />
            <i className="eq-bar" style={{ animationDelay: "180ms" }} />
            <i className="eq-bar" style={{ animationDelay: "90ms" }} />
          </span>
        ) : null}
        <span className="p-status__name">{name}</span>
      </span>
      <span className="p-indicators">
        {!isVideoOn ? (
          <span
            className="p-indicator p-indicator--camera-off"
            role="img"
            aria-label={`${name} camera is off`}
            title="Camera off"
          >
            <VideoOffIcon size={15} />
          </span>
        ) : null}
        <span
          className={cx("p-indicator", isMuted && "p-indicator--muted")}
          role="img"
          aria-label={isMuted ? `${name} is muted` : `${name} microphone is on`}
          title={isMuted ? "Muted" : "Microphone on"}
        >
          {isMuted ? <MicOffIcon size={15} /> : <MicIcon size={15} />}
        </span>
      </span>
    </>
  );
}

/** Small HOST badge with the three-line accent. */
export function HostBadge() {
  return (
    <span className="p-host">
      <span className="p-host__label">Host</span>
      <span className="p-host__accent" aria-hidden="true">
        <HeadingBloom />
      </span>
    </span>
  );
}
