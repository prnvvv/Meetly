import { STORAGE_KEYS } from "@/lib/constants";

export interface MeetingConfig {
  /** Host preferences from the setup screen. Stored, not yet enforced by the server. */
  settings: Record<string, boolean>;
  /** Friends picked on the setup screen. No invitation is sent automatically. */
  invitedFriendIds: string[];
}

/** Remembers the setup choices for a meeting so the room can honour them later. */
export function saveMeetingConfig(meetingId: string, config: MeetingConfig): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEYS.meetingConfig(meetingId), JSON.stringify(config));
  } catch {
    /* storage disabled — the choices simply are not remembered */
  }
}
