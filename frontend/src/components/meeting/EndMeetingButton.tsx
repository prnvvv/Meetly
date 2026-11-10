import { EndCallIcon } from "@/components/icons";
import {
  CONTROL_ICON_SIZE,
  MediaControlButton,
} from "@/components/meeting/MediaControlButton";

interface EndMeetingButtonProps {
  /**
   * Host-only handler. When provided the button ends the meeting for everyone
   * (the page confirms first); otherwise it simply leaves the meeting.
   */
  onEndMeeting?: () => void;
  onLeave: () => void;
}

/** The separate red action: "End" for the host, "Leave" for everyone else. */
export function EndMeetingButton({ onEndMeeting, onLeave }: EndMeetingButtonProps) {
  const endsForEveryone = Boolean(onEndMeeting);
  return (
    <MediaControlButton
      className="room__controls-end"
      variant="end"
      tone="danger"
      icon={<EndCallIcon size={CONTROL_ICON_SIZE} />}
      label={endsForEveryone ? "End" : "Leave"}
      aria-label={endsForEveryone ? "End meeting for everyone" : "Leave meeting"}
      title={endsForEveryone ? "End meeting for everyone" : "Leave meeting"}
      aria-haspopup={endsForEveryone ? "dialog" : undefined}
      onClick={endsForEveryone ? onEndMeeting : onLeave}
    />
  );
}
