/** All backend URLs are derived from these constants. Never inline hosts. */

export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"
).replace(/\/+$/, "");

export const STUN_SERVER =
  process.env.NEXT_PUBLIC_STUN_SERVER ?? "stun:stun.l.google.com:19302";

export const REST = {
  me: "/api/users/me",
  meetings: "/api/meetings",
  meeting: (meetingId: string) => `/api/meetings/${encodeURIComponent(meetingId)}`,
  meetingJoin: (meetingId: string) =>
    `/api/meetings/${encodeURIComponent(meetingId)}/join`,
  meetingParticipants: (meetingId: string) =>
    `/api/meetings/${encodeURIComponent(meetingId)}/participants`,
  participant: (participantId: number) =>
    `/api/participants/${encodeURIComponent(String(participantId))}`,
  schedulesUpcoming: "/api/schedules/upcoming",
  schedulesRecent: "/api/schedules/recent",
  schedules: "/api/schedules",
  schedulesRange: "/api/schedules/range",
  schedule: (meetingId: string) =>
    `/api/schedules/${encodeURIComponent(meetingId)}`,
} as const;

/** `http://host:8000` -> `ws://host:8000`, `https://` -> `wss://`. */
export function toWebSocketUrl(path: string): string {
  const base = API_BASE_URL.replace(/^http/, "ws");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

export const MEETING_WS_PATH = (meetingId: string) =>
  `/ws/meetings/${encodeURIComponent(meetingId)}`;

export const REQUEST_TIMEOUT_MS = 12_000;

/**
 * Public meeting IDs are exactly nine digits with no leading zero
 * (`backend/app/utils/meeting_id.py`). `MEETING_ID_MAX_INPUT` is only the
 * widest string we will accept while typing before validating.
 */
export const MEETING_ID_LENGTH = 9;
export const MEETING_ID_MAX_INPUT = 32;
export const MAX_TITLE_LENGTH = 255;
export const MAX_DESCRIPTION_LENGTH = 5000;
export const MAX_DURATION_MINUTES = 1440;
export const MAX_DISPLAY_NAME_LENGTH = 100;

export const STORAGE_KEYS = {
  displayName: "scalarmeet.display_name",
  participantId: (meetingId: string) => `scalarmeet.participant.${meetingId}`,
  audioInput: "scalarmeet.audio_input",
  videoInput: "scalarmeet.video_input",
  audioOutput: "scalarmeet.audio_output",
  /** Room layout + view preferences, shared across meetings. */
  roomPrefs: "scalarmeet.room_prefs",
  /** Pinned participant, per meeting (pin is a local-only view choice). */
  pinnedParticipant: (meetingId: string) => `scalarmeet.pinned.${meetingId}`,
  /** Optional meeting password remembered for the current session. */
  meetingPassword: (meetingId: string) => `scalarmeet.password.${meetingId}`,
} as const;

/** Reaction picker set — transient, never stored as participant state. */
export const REACTION_EMOJIS = [
  "👍",
  "❤️",
  "😂",
  "👏",
  "🎉",
  "😮",
  "😢",
  "✋",
] as const;

export const APP_NAME = "Meetly";
