import type { ParticipantPatch, ParticipantSummary } from "./participant";

/** Client -> server messages (mirrors backend `app/schemas/websocket.py`). */

export interface JoinMessage {
  type: "join";
  meeting_id: string;
  participant_id?: number | null;
  display_name: string;
  password?: string;
  /** Clerk session token; the server resolves identity and host role from it. */
  token?: string;
}

export interface LeaveMessage {
  type: "leave";
  participant_id: number;
}

export interface SignalPayloadMessage {
  type: "offer" | "answer" | "ice_candidate";
  sender_id: number;
  target_id: number;
  payload: Record<string, unknown> | RTCIceCandidateInit;
}

export interface MeetingStateRequest {
  type: "meeting_state";
  participant_id: number;
}

export interface MediaStateMessage {
  type: "media_state";
  participant_id: number;
  is_muted: boolean;
  is_video_on: boolean;
}

export interface MuteParticipantMessage {
  type: "mute_participant";
  participant_id: number;
  target_id: number;
  is_muted: boolean;
}

export interface RemoveParticipantMessage {
  type: "remove_participant";
  participant_id: number;
  target_id: number;
}

export interface EndMeetingMessage {
  type: "end_meeting";
  participant_id: number;
}

export interface ReactionMessage {
  type: "reaction";
  participant_id: number;
  emoji: string;
}

export interface PingMessage {
  type: "ping";
}

export type ClientMessage =
  | JoinMessage
  | LeaveMessage
  | SignalPayloadMessage
  | MeetingStateRequest
  | MediaStateMessage
  | MuteParticipantMessage
  | RemoveParticipantMessage
  | EndMeetingMessage
  | ReactionMessage
  | PingMessage;

/** Server -> client messages (mirrors `app/websocket/handler.py`). */

export interface JoinedMessage {
  type: "joined";
  meeting_id: string;
  participant_id: number;
  participants: ParticipantSummary[];
}

export interface ParticipantJoinedMessage {
  type: "participant_joined";
  participant: ParticipantSummary;
}

export interface ParticipantLeftMessage {
  type: "participant_left";
  participant_id: number;
}

export interface ParticipantUpdatedMessage {
  type: "participant_updated";
  participant: ParticipantPatch;
}

export interface MeetingStateMessage {
  type: "meeting_state";
  meeting_id: string;
  participant_id: number;
  is_host: boolean;
  participants: ParticipantSummary[];
  connected_participant_ids: number[];
}

export interface HostActionMessage {
  type: "host_action";
  action: "mute" | "unmute" | "removed";
  target_id: number;
}

export interface MeetingEndedMessage {
  type: "meeting_ended";
  meeting_id: string;
}

/** Transient emoji from another participant; never persisted. */
export interface ReactionEventMessage {
  type: "reaction";
  participant_id: number;
  emoji: string;
}

export interface ErrorMessage {
  type: "error";
  code: WsErrorCode;
  message: string;
}

export interface PongMessage {
  type: "pong";
}

/** You are in the waiting room; nothing about the room itself is sent to you. */
export interface WaitingMessage {
  type: "waiting";
  meeting: { title: string; host_name: string | null };
}

/** The host let you in: send `join` again to enter the room. */
export interface AdmittedMessage {
  type: "admitted";
}

export interface RejectedMessage {
  type: "rejected";
}

export interface WaitingEntry {
  id: number;
  display_name: string;
  /** Verified @username (from the account, not typed by the guest). */
  username: string | null;
  requested_at: string;
}

/** Host only: the current waiting list. */
export interface WaitingRoomUpdatedMessage {
  type: "waiting_room_updated";
  enabled: boolean;
  entries: WaitingEntry[];
}

export type ServerMessage =
  | JoinedMessage
  | ParticipantJoinedMessage
  | ParticipantLeftMessage
  | ParticipantUpdatedMessage
  | SignalPayloadMessage
  | MeetingStateMessage
  | HostActionMessage
  | MeetingEndedMessage
  | ReactionEventMessage
  | ErrorMessage
  | PongMessage
  | WaitingMessage
  | AdmittedMessage
  | RejectedMessage
  | WaitingRoomUpdatedMessage;

export type WsErrorCode =
  | "MEETING_NOT_FOUND"
  | "MEETING_ENDED"
  | "NOT_A_PARTICIPANT"
  | "NOT_HOST"
  | "TARGET_NOT_FOUND"
  | "INVALID_MESSAGE"
  | "UNAUTHORIZED_ACTION"
  | "NOT_ADMITTED"
  | "INTERNAL_ERROR";

/** Friendly copy for contract error codes. Never leak raw server text. */
export function wsErrorCopy(code: WsErrorCode): string {
  switch (code) {
    case "MEETING_NOT_FOUND":
      return "We could not find that meeting. Check the link and try again.";
    case "MEETING_ENDED":
      return "This meeting has ended.";
    case "NOT_A_PARTICIPANT":
      return "You are not part of this meeting.";
    case "NOT_HOST":
      return "Only the host can do that.";
    case "TARGET_NOT_FOUND":
      return "That participant is no longer in the meeting.";
    case "INVALID_MESSAGE":
      return "The meeting service rejected a message. Please rejoin.";
    case "UNAUTHORIZED_ACTION":
      return "That action is not allowed right now.";
    case "NOT_ADMITTED":
      return "The host did not let you into this meeting.";
    case "INTERNAL_ERROR":
    default:
      return "Something went wrong on the meeting server.";
  }
}
