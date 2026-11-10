import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ParticipantAvatar } from "@/components/meeting/ParticipantAvatar";
import { HostBadge, ParticipantStatus } from "@/components/meeting/ParticipantStatus";
import { cx } from "@/lib/utils";

export interface VideoTileProps {
  name: string;
  isMuted?: boolean;
  isHost?: boolean;
  speaking?: boolean;
  /** Live WebRTC/local stream for this tile, if any. */
  stream?: MediaStream | null;
  /** When false the avatar placeholder is shown instead of the video. */
  isVideoOn?: boolean;
  /** Mute the <audio> of a local tile to avoid echo. */
  videoMuted?: boolean;
  /** Mirror the preview of the local camera (display-only). */
  mirrored?: boolean;
  /** Locally pinned participant. */
  isPinned?: boolean;
  /** Floating reactions currently shown above this tile. */
  reactions?: string[];
  /**
   * Picks the avatar illustration. Pass the participant id so people in the
   * same meeting get different faces; omitted, it is derived from the name.
   */
  avatarVariant?: number;
  /** Real uploaded profile photo; replaces the illustrated avatar. */
  avatarImageUrl?: string | null;
  /**
   * Shape of the tile while there is no video (avatar). Set in multi-person
   * rooms so a camera-off participant is a regular landscape card instead of
   * stretching to whatever cell the grid has; unset (e.g. when alone) the tile
   * fills the canvas.
   */
  fallbackAspect?: number;
  /** Reports the video's real width / height (null when there is no video). */
  onAspectChange?: (aspect: number | null) => void;
  /** Shown under the avatar while the camera is off (e.g. the waiting hint). */
  placeholderExtra?: ReactNode;
  /** Hover menu (pin / host actions) for this participant. */
  menu?: ReactNode;
  /** Extra classes for layout modifiers (e.g. featured/speaker tile). */
  className?: string;
  /** A custom node replaces the default video/placeholder rendering. */
  children?: ReactNode;
}

/** One participant on the room stage. */
export function VideoTile({
  name,
  isMuted = false,
  isHost = false,
  speaking = false,
  stream = null,
  isVideoOn = true,
  videoMuted = false,
  mirrored = false,
  isPinned = false,
  reactions = [],
  avatarVariant,
  avatarImageUrl,
  onAspectChange,
  fallbackAspect,
  placeholderExtra,
  menu,
  className,
  children,
}: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // The camera's intrinsic aspect ratio (width / height), once known.
  const [aspect, setAspect] = useState<number | null>(null);
  // The stream whose video track has ended (camera unplugged / peer dropped).
  const [endedStream, setEndedStream] = useState<MediaStream | null>(null);

  const trackEnded =
    stream !== null &&
    (endedStream === stream ||
      stream.getVideoTracks?.()[0]?.readyState === "ended");
  // A dead track is shown as the avatar, never as a frozen or black frame.
  const showVideo = Boolean(stream) && isVideoOn && !trackEnded;

  const aspectCallback = useRef(onAspectChange);
  useEffect(() => {
    aspectCallback.current = onAspectChange;
  });

  useEffect(() => {
    const element = videoRef.current;
    if (element) element.srcObject = showVideo ? stream : null;
    if (!showVideo || !element) return;

    const measure = () => {
      const { videoWidth: w, videoHeight: h } = element;
      // Chrome reports a 2x2 placeholder for dead tracks: not a real frame.
      if (w >= 16 && h >= 16) {
        const next = w / h;
        setAspect((current) =>
          current !== null && Math.abs(current - next) < 0.001 ? current : next
        );
      }
    };
    measure();
    element.addEventListener("loadedmetadata", measure);
    element.addEventListener("resize", measure);

    const track = stream?.getVideoTracks?.()[0];
    const onEnded = () => setEndedStream(stream);
    track?.addEventListener?.("ended", onEnded);
    return () => {
      element.removeEventListener("loadedmetadata", measure);
      element.removeEventListener("resize", measure);
      track?.removeEventListener?.("ended", onEnded);
    };
  }, [stream, showVideo]);

  // Tell the grid the real shape of this tile (null while there is no video),
  // so it can choose the layout that gives every camera the most room.
  useEffect(() => {
    aspectCallback.current?.(showVideo ? aspect : null);
  }, [showVideo, aspect]);
  useEffect(() => () => aspectCallback.current?.(null), []);

  // The tile takes the camera's own shape, so the whole frame shows with no
  // crop, no zoom and no letterbox bars.
  const tileAspect = showVideo ? aspect : (fallbackAspect ?? null);
  const adaptive = tileAspect !== null;

  return (
    <div
      className={cx(
        "tile",
        showVideo ? "tile--video" : "tile--avatar",
        adaptive && "tile--adaptive",
        speaking && "tile--speaking",
        isPinned && "tile--pinned",
        className
      )}
      style={adaptive ? ({ "--tile-ar": tileAspect } as CSSProperties) : undefined}
    >
      {children ??
        (showVideo ? (
          <video
            ref={videoRef}
            className={cx(
              "tile__video",
              mirrored && "tile__video--mirrored"
            )}
            autoPlay
            playsInline
            muted={videoMuted}
          />
        ) : (
          <div className="tile__placeholder">
            <ParticipantAvatar name={name} variant={avatarVariant} imageUrl={avatarImageUrl} />
            {placeholderExtra}
          </div>
        ))}

      <div className="tile__badges tile__badges--top">
        {isHost ? <HostBadge /> : null}
        {isPinned ? (
          <span className="tile__pin" title="Pinned">
            Pinned
          </span>
        ) : null}
      </div>

      {reactions.length > 0 ? (
        <div className="tile__reactions" aria-live="polite">
          {reactions.map((emoji, index) => (
            <span
              className="tile__reaction"
              key={`${emoji}-${index}`}
              role="img"
              aria-label={`${name} reacted ${emoji}`}
            >
              {emoji}
            </span>
          ))}
        </div>
      ) : null}

      <div className="tile__footer">
        <ParticipantStatus name={name} isMuted={isMuted} isVideoOn={isVideoOn} speaking={speaking} />
      </div>

      {menu ? <div className="tile__menu">{menu}</div> : null}
    </div>
  );
}
