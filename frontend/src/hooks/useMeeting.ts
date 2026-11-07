"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toUserMessage } from "@/lib/api-client";
import { STORAGE_KEYS } from "@/lib/constants";
import { clampDisplayName } from "@/lib/validators";
import { joinMeeting } from "@/services/meetingService";
import { useMediaDevices } from "@/hooks/useMediaDevices";
import { useWebRTC } from "@/hooks/useWebRTC";
import { useWebSocket } from "@/hooks/useWebSocket";
import type { Meeting } from "@/types/meeting";
import type { ParticipantSummary } from "@/types/participant";
import type { ClientMessage, ServerMessage } from "@/types/realtime";
import { wsErrorCopy } from "@/types/realtime";

export type MeetingPhase =
  | "preparing"
  | "joining"
  | "joined"
  | "rejected"
  | "failed"
  | "ended"
  | "removed"
  | "left";

interface UseMeetingOptions {
  meeting: Meeting | null;
  meetingId: string;
  displayName: string;
  password?: string;
}

export interface MeetingDeviceSettings {
  audioInputDevices: MediaDeviceInfo[];
  videoInputDevices: MediaDeviceInfo[];
  audioOutputDevices: MediaDeviceInfo[];
  selectedAudioInputId: string | null;
  selectedVideoInputId: string | null;
  selectedAudioOutputId: string | null;
  canSelectSpeaker: boolean;
  refreshDevices: () => Promise<void>;
  setAudioInput: (deviceId: string) => void;
  setVideoInput: (deviceId: string) => void;
  setAudioOutput: (deviceId: string) => void;
}

export interface MeetingSession {
  phase: MeetingPhase;
  /** Failure copy for `rejected` / `failed` phases. */
  failure: string | null;
  connection: "connecting" | "connected" | "reconnecting" | "disconnected";
  isHost: boolean;
  selfId: number | null;
  participants: ParticipantSummary[];
  localStream: MediaStream | null;
  /** Remote participants' live streams, keyed by participant id. */
  remoteStreams: Record<number, MediaStream>;
  isMuted: boolean;
  isVideoOn: boolean;
  /** True once the user explicitly joined audio (microphone live). */
  audioJoined: boolean;
  /** False when the microphone could not be acquired (missing or blocked). */
  audioAvailable: boolean;
  /** False when the camera could not be acquired (missing or blocked). */
  videoAvailable: boolean;
  /** Ephemeral reactions currently floating over participant tiles. */
  reactions: MeetingReaction[];
  mediaError: string | null;
  devices: MeetingDeviceSettings;
  toggleMute: () => void;
  toggleVideo: () => void;
  /** Broadcast a transient emoji; it is never stored as participant state. */
  sendReaction: (emoji: string) => void;
  /** Host-only; a no-op for anyone the server did not mark as host. */
  muteParticipant: (targetId: number, muted: boolean) => void;
  removeParticipant: (targetId: number) => void;
  muteAll: () => void;
  endMeeting: () => void;
  leave: () => void;
  retry: () => void;
  reconnect: () => void;
}

/** One transient reaction rendered above a tile for a few seconds. */
export interface MeetingReaction {
  id: string;
  participantId: number;
  emoji: string;
}

/** Reactions disappear from the tile after this long. */
const REACTION_TTL_MS = 4_000;

/**
 * Owns the meeting session: REST validation, the signaling socket, local
 * media and the WebRTC mesh. The server is authoritative for host status,
 * membership and meeting state — this hook never invents them.
 */
export function useMeeting({
  meeting,
  meetingId,
  displayName,
  password,
}: UseMeetingOptions): MeetingSession {
  const [phase, setPhase] = useState<MeetingPhase>("preparing");
  const [failure, setFailure] = useState<string | null>(null);
  const [selfId, setSelfId] = useState<number | null>(null);
  const [isHost, setIsHost] = useState(false);
  const [participants, setParticipants] = useState<ParticipantSummary[]>([]);

  const phaseRef = useRef(phase);
  const nameRef = useRef(displayName);
  const selfIdRef = useRef(selfId);
  const joinedStatusRef = useRef<string | null>(null);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  useEffect(() => {
    selfIdRef.current = selfId;
  }, [selfId]);

  const media = useMediaDevices();

  // `media` is a fresh object every render; these callbacks are stable, so
  // depend on them instead of on the wrapper.
  const {
    stop: stopMedia,
    setMuted: setMediaMuted,
    acquire: acquireMedia,
    joinAudio,
  } = media;

  const sendRef = useRef<(message: ClientMessage) => void>(() => undefined);
  const send = useCallback((message: ClientMessage) => {
    sendRef.current(message);
  }, []);

  const [reactions, setReactions] = useState<MeetingReaction[]>([]);
  const reactionTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const rtc = useWebRTC({
    selfId,
    localStream: media.stream,
    send,
  });
  const rtcRef = useRef(rtc);
  useEffect(() => {
    rtcRef.current = rtc;
  }, [rtc]);

  /** Drop a reaction after its TTL; timers are cleared on unmount. */
  const pushReaction = useCallback((participantId: number, emoji: string) => {
    const id = `${participantId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setReactions((current) => [...current, { id, participantId, emoji }]);
    const timer = setTimeout(() => {
      reactionTimersRef.current.delete(id);
      setReactions((current) => current.filter((reaction) => reaction.id !== id));
    }, REACTION_TTL_MS);
    reactionTimersRef.current.set(id, timer);
  }, []);

  useEffect(() => {
    const timers = reactionTimersRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  // Terminal states must not leave a stale participant id behind, otherwise a
  // later visit would try to re-bind a row that no longer exists.
  const forgetParticipant = useCallback(() => {
    try {
      window.sessionStorage.removeItem(STORAGE_KEYS.participantId(meetingId));
    } catch {
      /* storage disabled — nothing to clear */
    }
    setSelfId(null);
  }, [meetingId]);

  const handleServerError = useCallback(
    (code: Parameters<typeof wsErrorCopy>[0]) => {
      if (code === "MEETING_ENDED") {
        setPhase("ended");
        forgetParticipant();
        stopMedia();
        return;
      }
      if (code === "MEETING_NOT_FOUND") {
        setFailure(wsErrorCopy(code));
        setPhase("rejected");
        forgetParticipant();
        return;
      }
      const beforeJoin =
        phaseRef.current === "preparing" ||
        phaseRef.current === "joining";
      if (
        beforeJoin ||
        code === "NOT_A_PARTICIPANT" ||
        code === "UNAUTHORIZED_ACTION" ||
        code === "INTERNAL_ERROR"
      ) {
        setFailure(wsErrorCopy(code));
        setPhase("failed");
        forgetParticipant();
      }
      // NOT_HOST / TARGET_NOT_FOUND / INVALID_MESSAGE are action-scoped
      // failures; the room stays usable.
    },
    [stopMedia, forgetParticipant]
  );

  const handleMessage = useCallback(
    (message: ServerMessage) => {
      switch (message.type) {
        case "joined": {
          window.sessionStorage.setItem(
            STORAGE_KEYS.participantId(meetingId),
            String(message.participant_id)
          );
          setSelfId(message.participant_id);
          setParticipants(message.participants);
          setPhase("joined");
          rtcRef.current.resetPeers();
          send({
            type: "meeting_state",
            participant_id: message.participant_id,
          });
          break;
        }
        case "participant_joined":
          setParticipants((list) => {
            if (list.some((p) => p.id === message.participant.id)) return list;
            return [...list, message.participant];
          });
          rtcRef.current.syncPeers([message.participant.id]);
          break;
        case "participant_left":
          setParticipants((list) =>
            list.filter((p) => p.id !== message.participant_id)
          );
          rtcRef.current.closePeer(message.participant_id);
          break;
        case "participant_updated":
          setParticipants((list) =>
            list.map((p) =>
              p.id === message.participant.id
                ? { ...p, ...message.participant }
                : p
            )
          );
          break;
        case "meeting_state":
          setParticipants(message.participants);
          setIsHost(message.is_host);
          rtcRef.current.syncPeers(message.connected_participant_ids);
          break;
        case "offer":
        case "answer":
        case "ice_candidate":
          void rtcRef.current.handleSignal(message).catch(() => undefined);
          break;
        case "host_action": {
          if (message.target_id !== selfIdRef.current) break;
          if (message.action === "mute") setMediaMuted(true);
          else if (message.action === "unmute") setMediaMuted(false);
          else {
            setFailure(null);
            setPhase("removed");
            forgetParticipant();
            stopMedia();
          }
          break;
        }
        case "meeting_ended":
          setFailure(null);
          setPhase("ended");
          forgetParticipant();
          stopMedia();
          break;
        case "reaction":
          pushReaction(message.participant_id, message.emoji);
          break;
        case "error":
          handleServerError(message.code);
          break;
        case "pong":
        default:
          break;
      }
    },
    [
      meetingId,
      send,
      handleServerError,
      stopMedia,
      setMediaMuted,
      forgetParticipant,
      pushReaction,
    ]
  );

  const ws = useWebSocket({
    meetingId,
    enabled: phase === "joining" || phase === "joined",
    onMessage: handleMessage,
  });

  useEffect(() => {
    sendRef.current = ws.send;
  }, [ws.send]);

  // Phase 1: validate over REST, acquire media, then enable the socket.
  useEffect(() => {
    if (!meeting || phase !== "preparing") return;
    let active = true;
    nameRef.current = displayName;
    void (async () => {
      try {
        await joinMeeting(meetingId, {
          display_name: clampDisplayName(displayName),
          password: password?.trim() || undefined,
        });
      } catch (cause: unknown) {
        if (!active) return;
        setFailure(toUserMessage(cause));
        const status = (cause as { status?: number }).status;
        setPhase(status === 404 || status === 409 ? "rejected" : "failed");
        return;
      }
      await acquireMedia();
      if (!active) return;
      setPhase("joining");
    })();
    return () => {
      active = false;
    };
  }, [meeting, phase, meetingId, displayName, password, acquireMedia]);

  // Phase 2: every time the socket opens (first connect or after a
  // reconnect), join and re-bind our participant row. Exactly one `join` per
  // connection — a phase change must not re-announce us to the server.
  useEffect(() => {
    const joining = phase === "joining" || phase === "joined";
    if (ws.status !== "connected" || !joining) {
      joinedStatusRef.current = null;
      return;
    }
    if (joinedStatusRef.current === ws.status) return;
    joinedStatusRef.current = ws.status;
    const stored = window.sessionStorage.getItem(
      STORAGE_KEYS.participantId(meetingId)
    );
    const participantId = stored ? Number(stored) : null;
    send({
      type: "join",
      meeting_id: meetingId,
      participant_id: participantId && participantId > 0 ? participantId : null,
      display_name: clampDisplayName(nameRef.current),
      password: password?.trim() || undefined,
    });
  }, [ws.status, phase, meetingId, password, send]);

  // Report actual media state whenever it changes or the room is rejoined.
  useEffect(() => {
    if (phase !== "joined" || ws.status !== "connected" || selfId === null) {
      return;
    }
    send({
      type: "media_state",
      participant_id: selfId,
      is_muted: media.isMuted,
      is_video_on: media.isVideoOn,
    });
  }, [phase, ws.status, selfId, media.isMuted, media.isVideoOn, send]);

  const toggleMute = useCallback(() => {
    // Join Audio: the first click on the audio control requests
    // microphone permission; only afterwards does it mute/unmute.
    if (!media.audioJoined) {
      void joinAudio();
      return;
    }
    media.setMuted(!media.isMuted);
  }, [media, joinAudio]);

  const toggleVideo = useCallback(() => {
    // Camera starts off; the first click requests permission (Start Video).
    void media.setVideoOn(!media.isVideoOn);
  }, [media]);

  // Host actions. The server still validates `is_host`; guarding here only
  // avoids emitting messages the server would reject.
  const muteParticipant = useCallback(
    (targetId: number, muted: boolean) => {
      const me = selfIdRef.current;
      if (!isHost || me === null || phase !== "joined") return;
      if (targetId === me) return;
      send({
        type: "mute_participant",
        participant_id: me,
        target_id: targetId,
        is_muted: muted,
      });
    },
    [isHost, phase, send]
  );

  const removeParticipant = useCallback(
    (targetId: number) => {
      const me = selfIdRef.current;
      if (!isHost || me === null || phase !== "joined") return;
      if (targetId === me) return;
      send({
        type: "remove_participant",
        participant_id: me,
        target_id: targetId,
      });
    },
    [isHost, phase, send]
  );

  const muteAll = useCallback(() => {
    const me = selfIdRef.current;
    if (!isHost || me === null || phase !== "joined") return;
    for (const participant of participants) {
      if (participant.id === me || participant.is_muted) continue;
      send({
        type: "mute_participant",
        participant_id: me,
        target_id: participant.id,
        is_muted: true,
      });
    }
  }, [isHost, participants, phase, send]);

  const endMeeting = useCallback(() => {
    const me = selfIdRef.current;
    if (!isHost || me === null || phase !== "joined") return;
    send({ type: "end_meeting", participant_id: me });
  }, [isHost, phase, send]);

  const sendReaction = useCallback(
    (emoji: string) => {
      const me = selfIdRef.current;
      if (me === null || phase !== "joined" || ws.status !== "connected") return;
      const trimmed = emoji.trim().slice(0, 16);
      if (!trimmed) return;
      // Render locally right away; the server echoes to everyone else only.
      pushReaction(me, trimmed);
      send({ type: "reaction", participant_id: me, emoji: trimmed });
    },
    [phase, ws.status, send, pushReaction]
  );

  const leave = useCallback(() => {
    if (selfId !== null && (phase === "joining" || phase === "joined")) {
      send({ type: "leave", participant_id: selfId });
    }
    setPhase("left");
    forgetParticipant();
    stopMedia();
  }, [selfId, phase, send, stopMedia, forgetParticipant]);

  const retry = useCallback(() => {
    setFailure(null);
    setSelfId(null);
    setIsHost(false);
    setParticipants([]);
    setPhase("preparing");
  }, []);

  useEffect(() => stopMedia, [stopMedia]);

  return {
    phase,
    failure,
    connection: ws.status,
    isHost,
    selfId,
    participants,
    localStream: media.stream,
    remoteStreams: rtc.remoteStreams,
    isMuted: media.isMuted,
    isVideoOn: media.isVideoOn,
    audioJoined: media.audioJoined,
    audioAvailable: media.audioAvailable ?? true,
    videoAvailable: media.videoAvailable ?? true,
    reactions,
    mediaError: media.error,
    devices: {
      audioInputDevices: media.audioInputDevices,
      videoInputDevices: media.videoInputDevices,
      audioOutputDevices: media.audioOutputDevices,
      selectedAudioInputId: media.selectedAudioInputId,
      selectedVideoInputId: media.selectedVideoInputId,
      selectedAudioOutputId: media.selectedAudioOutputId,
      canSelectSpeaker: media.canSelectSpeaker,
      refreshDevices: media.refreshDevices,
      setAudioInput: media.setAudioInput,
      setVideoInput: media.setVideoInput,
      setAudioOutput: media.setAudioOutput,
    },
    toggleMute,
    toggleVideo,
    sendReaction,
    muteParticipant,
    removeParticipant,
    muteAll,
    endMeeting,
    leave,
    retry,
    reconnect: ws.reconnect,
  };
}
