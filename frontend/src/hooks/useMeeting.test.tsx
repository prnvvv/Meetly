import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEYS } from "@/lib/constants";
import { useMeeting } from "./useMeeting";
import type { Meeting } from "@/types/meeting";
import type { ClientMessage, ServerMessage } from "@/types/realtime";

const MEETING_ID = "810288678";

const joinMeeting = vi.hoisted(() => vi.fn());
const setMuted = vi.hoisted(() => vi.fn());
const setVideoOn = vi.hoisted(() => vi.fn());
const stopMedia = vi.hoisted(() => vi.fn());
const acquire = vi.hoisted(() => vi.fn());
const joinAudio = vi.hoisted(() => vi.fn());
const mediaFlags = vi.hoisted(() => ({ audioJoined: false, isVideoOn: false }));
const syncPeers = vi.hoisted(() => vi.fn());
const resetPeers = vi.hoisted(() => vi.fn());
const closePeer = vi.hoisted(() => vi.fn());
const handleSignal = vi.hoisted(() => vi.fn());

/** Captures the handlers so a test can drive the socket from both sides. */
const socketHolders = vi.hoisted(() => ({
  current: [] as Array<{
    onMessage: (message: ServerMessage) => void;
    onStatus: (status: "connecting" | "connected" | "reconnecting" | "disconnected") => void;
    sent: ClientMessage[];
    closed: boolean;
    reconnects: number;
  }>,
}));

vi.mock("@/services/meetingService", () => ({ joinMeeting }));
vi.mock("@/services/iceService", () => ({ loadIceServers: vi.fn().mockResolvedValue({ turn: false }) }));

vi.mock("@/hooks/useMediaDevices", () => ({
  useMediaDevices: () => ({
    stream: null,
    audioJoined: mediaFlags.audioJoined,
    isMuted: true,
    isVideoOn: mediaFlags.isVideoOn,
    error: null,
    audioInputDevices: [],
    videoInputDevices: [],
    audioOutputDevices: [],
    selectedAudioInputId: null,
    selectedVideoInputId: null,
    selectedAudioOutputId: null,
    canSelectSpeaker: false,
    acquire,
    joinAudio,
    refreshDevices: vi.fn(),
    setAudioInput: vi.fn(),
    setVideoInput: setVideoOn,
    setAudioOutput: vi.fn(),
    setMuted,
    setVideoOn,
    stop: stopMedia,
  }),
}));

vi.mock("@/hooks/useWebRTC", () => ({
  useWebRTC: () => ({
    remoteStreams: {},
    syncPeers,
    handleSignal,
    closePeer,
    resetPeers,
  }),
}));

vi.mock("@/lib/websocket", () => ({
  MeetingSocket: class {
    constructor(
      readonly meetingId: string,
      readonly handlers: {
        onMessage: (message: ServerMessage) => void;
        onStatus: (status: "connecting" | "connected" | "reconnecting" | "disconnected") => void;
      }
    ) {
      socketHolders.current.push({
        ...handlers,
        sent: [],
        closed: false,
        reconnects: 0,
      });
    }
    connect() {}
    close() {
      const socket = socketHolders.current.at(-1);
      if (socket) socket.closed = true;
    }
    reconnect() {
      const socket = socketHolders.current.at(-1);
      if (socket) socket.reconnects += 1;
    }
    send(message: ClientMessage) {
      socketHolders.current.at(-1)?.sent.push(message);
    }
  },
}));

const MEETING = {
  id: 1,
  meeting_id: MEETING_ID,
  host_id: 1,
  title: "Team Meeting",
  description: "",
  start_time: "2026-10-07T10:00:00Z",
  end_time: "2026-10-07T11:00:00Z",
  duration: 60,
  status: "active",
  meeting_link: "",
  created_at: "2026-10-07T09:00:00Z",
} as Meeting;

function renderSession(displayName = "John") {
  return renderHook(() =>
    useMeeting({ meeting: MEETING, meetingId: MEETING_ID, displayName })
  );
}

function latestSocket() {
  return socketHolders.current.at(-1)!;
}

/** Moves the socket to connected and lets the join effect run. */
async function connect() {
  await act(async () => {
    latestSocket().onStatus("connected");
  });
}

function emit(message: ServerMessage) {
  act(() => {
    latestSocket().onMessage(message);
  });
}

function sentOfType(type: ClientMessage["type"]): ClientMessage[] {
  return latestSocket()
    .sent.filter((message) => message.type === type)
    .filter((message): message is Extract<ClientMessage, { type: typeof type }> =>
      message.type === type
    );
}

beforeEach(() => {
  window.sessionStorage.clear();
  socketHolders.current = [];
  mediaFlags.audioJoined = false;
  mediaFlags.isVideoOn = false;
  joinMeeting.mockReset().mockResolvedValue(undefined);
  acquire.mockReset().mockResolvedValue(undefined);
  joinAudio.mockReset().mockResolvedValue(true);
  setMuted.mockReset();
  setVideoOn.mockReset();
  stopMedia.mockReset();
  syncPeers.mockReset();
  resetPeers.mockReset();
  closePeer.mockReset();
  handleSignal.mockReset().mockResolvedValue(undefined);
});

afterEach(cleanup);

describe("useMeeting join flow", () => {
  it("validates over REST, then opens the socket", async () => {
    const { result } = renderSession();

    expect(joinMeeting).toHaveBeenCalledWith(MEETING_ID, { display_name: "John" });
    await waitFor(() => expect(acquire).toHaveBeenCalled());
    expect(result.current.phase).toBe("joining");

    await connect();
    expect(result.current.connection).toBe("connected");
  });

  it("sends exactly one join per connection", async () => {
    renderSession();
    await waitFor(() => expect(acquire).toHaveBeenCalled());
    await connect();

    emit({
      type: "joined",
      meeting_id: MEETING_ID,
      participant_id: 4,
      participants: [],
    });

    // The phase change must not re-announce us to the server.
    expect(sentOfType("join")).toHaveLength(1);
  });

  it("stores the participant id for reconnects", async () => {
    renderSession();
    await waitFor(() => expect(acquire).toHaveBeenCalled());
    await connect();
    emit({
      type: "joined",
      meeting_id: MEETING_ID,
      participant_id: 4,
      participants: [],
    });

    expect(window.sessionStorage.getItem(STORAGE_KEYS.participantId(MEETING_ID))).toBe(
      "4"
    );
  });

  it("reuses the stored participant id when rejoining", async () => {
    window.sessionStorage.setItem(STORAGE_KEYS.participantId(MEETING_ID), "9");
    renderSession();
    await waitFor(() => expect(acquire).toHaveBeenCalled());
    await connect();

    expect(sentOfType("join")[0]).toMatchObject({
      type: "join",
      meeting_id: MEETING_ID,
      participant_id: 9,
    });
  });

  it("sends a null participant id on a first visit", async () => {
    renderSession();
    await waitFor(() => expect(acquire).toHaveBeenCalled());
    await connect();

    expect(sentOfType("join")[0]).toMatchObject({ participant_id: null });
  });

  it("reports media state once joined", async () => {
    renderSession();
    await waitFor(() => expect(acquire).toHaveBeenCalled());
    await connect();
    emit({
      type: "joined",
      meeting_id: MEETING_ID,
      participant_id: 4,
      participants: [],
    });

    expect(sentOfType("media_state")).toHaveLength(1);
    expect(sentOfType("meeting_state")).toHaveLength(1);
  });
});

describe("useMeeting server events", () => {
  async function joinedSession() {
    const view = renderSession();
    await waitFor(() => expect(acquire).toHaveBeenCalled());
    await connect();
    emit({
      type: "joined",
      meeting_id: MEETING_ID,
      participant_id: 4,
      participants: [],
    });
    return view;
  }

  it("adds and removes participants", async () => {
    const { result } = await joinedSession();

    emit({
      type: "participant_joined",
      participant: {
        id: 7,
        display_name: "Ann",
        is_host: false,
        is_muted: false,
        is_video_on: true,
      },
    });
    expect(result.current.participants.map((p) => p.id)).toContain(7);
    expect(syncPeers).toHaveBeenCalledWith([7]);

    emit({ type: "participant_left", participant_id: 7 });
    expect(result.current.participants.map((p) => p.id)).not.toContain(7);
    expect(closePeer).toHaveBeenCalledWith(7);
  });

  it("never lists the same participant twice", async () => {
    const { result } = await joinedSession();
    const announcement = {
      type: "participant_joined" as const,
      participant: {
        id: 7,
        display_name: "Ann",
        is_host: false,
        is_muted: false,
        is_video_on: true,
      },
    };
    emit(announcement);
    emit(announcement);

    expect(result.current.participants.filter((p) => p.id === 7)).toHaveLength(1);
  });

  it("applies a partial participant update", async () => {
    const { result } = await joinedSession();
    emit({
      type: "participant_joined",
      participant: {
        id: 7,
        display_name: "Ann",
        is_host: false,
        is_muted: false,
        is_video_on: true,
      },
    });

    emit({ type: "participant_updated", participant: { id: 7, is_muted: true } });
    expect(result.current.participants.find((p) => p.id === 7)?.is_muted).toBe(true);
  });

  it("takes host status from the server, never from the client", async () => {
    const { result } = await joinedSession();
    expect(result.current.isHost).toBe(false);

    emit({
      type: "meeting_state",
      meeting_id: MEETING_ID,
      participant_id: 4,
      is_host: true,
      participants: [],
      connected_participant_ids: [4],
    });
    expect(result.current.isHost).toBe(true);
  });

  it("routes signaling to the WebRTC layer", async () => {
    await joinedSession();
    emit({
      type: "offer",
      sender_id: 1,
      target_id: 4,
      payload: { type: "offer", sdp: "v=0" },
    });
    expect(handleSignal).toHaveBeenCalledTimes(1);
  });
});

describe("useMeeting host actions", () => {
  async function hostSession() {
    const view = renderSession();
    await waitFor(() => expect(acquire).toHaveBeenCalled());
    await connect();
    emit({
      type: "joined",
      meeting_id: MEETING_ID,
      participant_id: 1,
      participants: [],
    });
    emit({
      type: "meeting_state",
      meeting_id: MEETING_ID,
      participant_id: 1,
      is_host: true,
      participants: [],
      connected_participant_ids: [1],
    });
    return view;
  }

  it("mutes a single participant", async () => {
    const { result } = await hostSession();
    act(() => result.current.muteParticipant(7, true));
    expect(sentOfType("mute_participant")[0]).toMatchObject({
      participant_id: 1,
      target_id: 7,
      is_muted: true,
    });
  });

  it("mutes everyone but the host", async () => {
    const { result } = renderSession();
    await waitFor(() => expect(acquire).toHaveBeenCalled());
    await connect();
    emit({
      type: "joined",
      meeting_id: MEETING_ID,
      participant_id: 1,
      participants: [
        { id: 1, display_name: "Host", is_host: true, is_muted: false, is_video_on: true },
        { id: 7, display_name: "Ann", is_host: false, is_muted: false, is_video_on: true },
        { id: 8, display_name: "Bo", is_host: false, is_muted: true, is_video_on: true },
      ],
    });
    emit({
      type: "meeting_state",
      meeting_id: MEETING_ID,
      participant_id: 1,
      is_host: true,
      participants: [
        { id: 1, display_name: "Host", is_host: true, is_muted: false, is_video_on: true },
        { id: 7, display_name: "Ann", is_host: false, is_muted: false, is_video_on: true },
        { id: 8, display_name: "Bo", is_host: false, is_muted: true, is_video_on: true },
      ],
      connected_participant_ids: [1, 7, 8],
    });

    act(() => result.current.muteAll());

    const muted = sentOfType("mute_participant");
    // Only the unmuted non-host participant; never the host, never the muted.
    expect(muted).toHaveLength(1);
    expect(muted[0]).toMatchObject({ target_id: 7, is_muted: true });
  });

  it("removes a participant and ends the meeting", async () => {
    const { result } = await hostSession();

    act(() => result.current.removeParticipant(7));
    expect(sentOfType("remove_participant")[0]).toMatchObject({ target_id: 7 });

    act(() => result.current.endMeeting());
    expect(sentOfType("end_meeting")[0]).toMatchObject({ participant_id: 1 });
  });

  it("never targets the host themself", async () => {
    const { result } = await hostSession();
    act(() => result.current.muteParticipant(1, true));
    act(() => result.current.removeParticipant(1));
    expect(sentOfType("mute_participant")).toHaveLength(0);
    expect(sentOfType("remove_participant")).toHaveLength(0);
  });

  it("sends nothing when the local user is not the host", async () => {
    const { result } = renderSession();
    await waitFor(() => expect(acquire).toHaveBeenCalled());
    await connect();
    emit({
      type: "joined",
      meeting_id: MEETING_ID,
      participant_id: 4,
      participants: [],
    });
    expect(result.current.isHost).toBe(false);

    act(() => result.current.muteParticipant(7, true));
    act(() => result.current.removeParticipant(7));
    act(() => result.current.muteAll());
    act(() => result.current.endMeeting());

    expect(sentOfType("mute_participant")).toHaveLength(0);
    expect(sentOfType("remove_participant")).toHaveLength(0);
    expect(sentOfType("end_meeting")).toHaveLength(0);
  });
});

describe("useMeeting terminal states", () => {
  async function joinedSession() {
    const view = renderSession();
    await waitFor(() => expect(acquire).toHaveBeenCalled());
    await connect();
    emit({
      type: "joined",
      meeting_id: MEETING_ID,
      participant_id: 4,
      participants: [],
    });
    return view;
  }

  it("reacts to a host mute and unmute", async () => {
    await joinedSession();
    emit({ type: "host_action", action: "mute", target_id: 4 });
    expect(setMuted).toHaveBeenLastCalledWith(true);

    emit({ type: "host_action", action: "unmute", target_id: 4 });
    expect(setMuted).toHaveBeenLastCalledWith(false);
  });

  it("ignores a host action aimed at someone else", async () => {
    await joinedSession();
    setMuted.mockClear();
    emit({ type: "host_action", action: "mute", target_id: 99 });
    expect(setMuted).not.toHaveBeenCalled();
  });

  it("shows the removed screen and clears the stored id", async () => {
    const { result } = await joinedSession();
    emit({ type: "host_action", action: "removed", target_id: 4 });

    expect(result.current.phase).toBe("removed");
    expect(stopMedia).toHaveBeenCalled();
    expect(window.sessionStorage.getItem(STORAGE_KEYS.participantId(MEETING_ID))).toBeNull();
  });

  it("ends the meeting and clears the stored id", async () => {
    const { result } = await joinedSession();
    emit({ type: "meeting_ended", meeting_id: MEETING_ID });

    expect(result.current.phase).toBe("ended");
    expect(stopMedia).toHaveBeenCalled();
    expect(window.sessionStorage.getItem(STORAGE_KEYS.participantId(MEETING_ID))).toBeNull();
  });

  it("surfaces a friendly message for MEETING_NOT_FOUND", async () => {
    const { result } = renderSession();
    await waitFor(() => expect(acquire).toHaveBeenCalled());
    await connect();
    emit({ type: "error", code: "MEETING_NOT_FOUND", message: "raw backend text" });

    expect(result.current.phase).toBe("rejected");
    expect(result.current.failure).toBe(
      "We could not find that meeting. Check the link and try again."
    );
    expect(result.current.failure).not.toContain("raw backend text");
  });

  it("surfaces a friendly message for MEETING_ENDED", async () => {
    const { result } = await joinedSession();
    emit({ type: "error", code: "MEETING_ENDED", message: "raw" });
    expect(result.current.phase).toBe("ended");
  });

  it("keeps the room usable for an action-scoped NOT_HOST error", async () => {
    const { result } = await joinedSession();
    emit({ type: "error", code: "NOT_HOST", message: "raw" });
    expect(result.current.phase).toBe("joined");
  });

  it("sends leave and clears state", async () => {
    const { result } = await joinedSession();
    act(() => result.current.leave());

    expect(sentOfType("leave")[0]).toMatchObject({ participant_id: 4 });
    expect(result.current.phase).toBe("left");
    expect(stopMedia).toHaveBeenCalled();
    expect(window.sessionStorage.getItem(STORAGE_KEYS.participantId(MEETING_ID))).toBeNull();
  });

  it("resets for a retry", async () => {
    const { result } = renderSession();
    await waitFor(() => expect(acquire).toHaveBeenCalled());
    await connect();
    emit({
      type: "joined",
      meeting_id: MEETING_ID,
      participant_id: 4,
      participants: [],
    });

    act(() => result.current.retry());
    expect(result.current.phase).toBe("preparing");
    expect(result.current.selfId).toBeNull();
    expect(result.current.failure).toBeNull();
  });
});

describe("useMeeting failures", () => {
  it("rejects a meeting that is not found", async () => {
    joinMeeting.mockRejectedValue({ status: 404 });
    const { result } = renderSession();

    await waitFor(() => expect(result.current.phase).toBe("rejected"));
    expect(joinMeeting).toHaveBeenCalled();
  });

  it("reports a conflict when the meeting already ended", async () => {
    joinMeeting.mockRejectedValue({ status: 409 });
    const { result } = renderSession();

    await waitFor(() => expect(result.current.phase).toBe("rejected"));
  });

  it("reports a generic failure for a server error", async () => {
    joinMeeting.mockRejectedValue({ status: 500 });
    const { result } = renderSession();

    await waitFor(() => expect(result.current.phase).toBe("failed"));
    expect(result.current.failure).toBeTruthy();
    expect(result.current.failure).not.toContain("500");
  });

  it("clamps an over-long display name before joining", async () => {
    // A name above the server's 100-char cap that reaches the socket would be
    // stored, and then GET /participants would 500 for the whole room.
    renderSession("x".repeat(140));
    await waitFor(() => expect(acquire).toHaveBeenCalled());
    await connect();

    const join = sentOfType("join")[0] as Extract<
      ClientMessage,
      { type: "join" }
    >;
    expect(join.display_name).toHaveLength(100);
    expect(join.display_name.length).toBeLessThanOrEqual(100);
    expect(joinMeeting).toHaveBeenCalledWith(MEETING_ID, {
      display_name: "x".repeat(100),
    });
  });

  it("trims whitespace around the display name", async () => {
    renderSession("   Ann   ");
    await waitFor(() => expect(acquire).toHaveBeenCalled());
    await connect();

    expect(sentOfType("join")[0]).toMatchObject({ display_name: "Ann" });
  });

  it("exposes devices for the room settings panel", async () => {
    const { result } = renderSession();
    expect(result.current.devices).toBeTruthy();
    expect(result.current.devices.canSelectSpeaker).toBe(false);
    expect(typeof result.current.devices.setVideoInput).toBe("function");
  });

  it("forwards a reconnect request to the socket", async () => {
    const { result } = renderSession();
    await waitFor(() => expect(acquire).toHaveBeenCalled());
    await connect();

    act(() => result.current.reconnect());
    expect(latestSocket().reconnects).toBe(1);
  });
});

describe("useMeeting media controls", () => {
  async function joinedSession() {
    const view = renderSession();
    await waitFor(() => expect(acquire).toHaveBeenCalled());
    await connect();
    emit({
      type: "joined",
      meeting_id: MEETING_ID,
      participant_id: 4,
      participants: [],
    });
    return view;
  }

  it("requests the microphone first instead of muting", async () => {
    const { result } = await joinedSession();
    act(() => result.current.toggleMute());
    expect(joinAudio).toHaveBeenCalledTimes(1);
    expect(setMuted).not.toHaveBeenCalled();
  });

  it("mutes and unmutes once audio is joined", async () => {
    mediaFlags.audioJoined = true;
    const { result } = await joinedSession();
    act(() => result.current.toggleMute());
    expect(joinAudio).not.toHaveBeenCalled();
    // The mock session starts muted, so the first toggle unmutes.
    expect(setMuted).toHaveBeenCalledWith(false);
  });

  it("turns the camera on lazily through setVideoOn", async () => {
    const { result } = await joinedSession();
    act(() => result.current.toggleVideo());
    expect(setVideoOn).toHaveBeenCalledWith(true);
  });

  it("turns the camera off through setVideoOn", async () => {
    mediaFlags.isVideoOn = true;
    const { result } = await joinedSession();
    act(() => result.current.toggleVideo());
    expect(setVideoOn).toHaveBeenCalledWith(false);
  });
});
