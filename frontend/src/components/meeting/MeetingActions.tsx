import { CopyIcon, VideoIcon } from "@/components/icons";

interface MeetingActionsProps {
  busy: "start" | "copy" | null;
  onStart: () => void;
  onCopyLink: () => void;
}

/** The two bottom actions: equal size, independent, anchored to the card bottom. */
export function MeetingActions({ busy, onStart, onCopyLink }: MeetingActionsProps) {
  const disabled = busy !== null;
  return (
    <div className="nm-actions">
      <button type="button" className="btn btn--primary btn--lg" onClick={onStart} disabled={disabled}>
        <VideoIcon size={18} />
        {busy === "start" ? "Starting…" : "Start Meeting"}
      </button>
      <button type="button" className="btn btn--secondary btn--lg" onClick={onCopyLink} disabled={disabled}>
        <CopyIcon size={18} />
        {busy === "copy" ? "Copying…" : "Copy Invite Link"}
      </button>
    </div>
  );
}
