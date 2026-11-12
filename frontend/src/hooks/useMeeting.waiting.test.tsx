import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMeeting } from "./useMeeting";
import type { Meeting } from "@/types/meeting";
import type { ClientMessage, ServerMessage } from "@/types/realtime";

const MEETING_ID = "810288678";

const joinMeeting = vi.hoisted(() => vi.fn());
const acquire = vi.hoisted(() => vi.fn());
const waitingApi = vi.hoisted(() => ({
  admitGuest: vi.fn(),
  rejectGuest: vi.fn(),
  admitAllGuests: vi.fn(),
  setWaitingRoomEnabled: vi.fn(),
}));
const socketHolders = vi.hoisted(() => ({
  current: [] as Array<{
    onMessage: (message: ServerMessage) => void;
    onStatus: (status: "connecting" | "connected" | "reconnecting" | "disconnected") => void;
    sent: ClientMessage[];
  }>,
}));

vi.mock("@/services/meetingService", () => ({ joinMeeting }));
vi.mock("@/services/iceService", () => ({ loadIceServers: vi.fn().mockResolvedValue({ turn: false }) }));
vi.mock("@/services/waitingRoomService", () => waitingApi);
vi.mock("@/hooks/useMediaDevices", () => ({
  useMediaDevices: () => ({
    stream: null,
    audioJoined: false,
    isMuted: true,
    isVideoOn: false,
    error: null,
    audioInputDevices: [],
    videoInputDevices: [],
    audioOutputDevices: [],
    selectedAudioInputId: null,
    selectedVideoInputId: null,
    selectedAudioOutputId: null,
    canSelectSpeaker: false,
    acquire,
    joinAudio: vi.fn().mockResolvedValue(true),
    refreshDevices: vi.fn(),
    setAudioInput: vi.fn(),
    setVideoInput: vi.fn(),
    setAudioOutput: vi.fn(),
    setMuted: vi.fn(),
    setVideoOn: vi.fn(),
    stop: vi.fn(),
  }),
}));
vi.mock("@/hooks/useWebRTC", () => ({
  useWebRTC: () => ({
    remoteStreams: {},
    syncPeers: vi.fn(),
    handleSignal: vi.fn().mockResolvedValue(undefined),
    closePeer: vi.fn(),
    resetPeers: vi.fn(),
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
      socketHolders.current.push({ ...handlers, sent: [] });
    }
    connect() {}
    close() {}
    reconnect() {}
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
  waiting_room_enabled: true,
} as Meeting;

const socket = () => socketHolders.current.at(-1)!;
const sent = (type: ClientMessage["type"]) => socket().sent.filter((m) => m.type === type);

function emit(message: ServerMessage) {
  act(() => socket().onMessage(message));
}

async function connect() {
  await act(async () => socket().onStatus("connected"));
}

async function renderWaiting() {
  const hook = renderHook(() =>
    useMeeting({ meeting: MEETING, meetingId: MEETING_ID, displayName: "Gina" })
  );
  await waitFor(() => expect(acquire).toHaveBeenCalled());
  await connect();
  return hook;
}

beforeEach(() => {
  window.sessionStorage.clear();
  socketHolders.current = [];
  joinMeeting.mockReset().mockResolvedValue(undefined);
  acquire.mockReset().mockResolvedValue(undefined);
  Object.values(waitingApi).forEach((fn) => fn.mockReset());
});

afterEach(cleanup);

describe("useMeeting waiting room", () => {
  it("enters the waiting phase without a participant id", async () => {
    const { result } = await renderWaiting();
    emit({ type: "waiting", meeting: { title: "Team Meeting", host_name: "Hal" } });
    expect(result.current.phase).toBe("waiting");
    expect(result.current.waitingInfo).toEqual({ title: "Team Meeting", hostName: "Hal" });
    expect(result.current.selfId).toBeNull();
    expect(result.current.participants).toEqual([]);
  });

  it("sends join again on the same connection when admitted, then joins", async () => {
    const { result } = await renderWaiting();
    emit({ type: "waiting", meeting: { title: "Team Meeting", host_name: null } });
    expect(sent("join")).toHaveLength(1);
    emit({ type: "admitted" });
    await waitFor(() => expect(sent("join")).toHaveLength(2));
    expect(result.current.phase).toBe("joining");
    emit({ type: "joined", meeting_id: MEETING_ID, participant_id: 9, participants: [] });
    expect(result.current.phase).toBe("joined");
    expect(sent("join")).toHaveLength(2);
  });

  it("shows a clear failure when rejected", async () => {
    const { result } = await renderWaiting();
    emit({ type: "waiting", meeting: { title: "T", host_name: null } });
    emit({ type: "rejected" });
    expect(result.current.phase).toBe("rejected");
    expect(result.current.failure).toMatch(/did not let you in/);
  });

  it("treats NOT_ADMITTED as a join failure", async () => {
    const { result } = await renderWaiting();
    emit({ type: "error", code: "NOT_ADMITTED", message: "x" });
    expect(result.current.phase).toBe("failed");
    expect(result.current.failure).toMatch(/did not let you in/);
  });

  it("re-announces itself after a reconnect while waiting", async () => {
    const { result } = await renderWaiting();
    emit({ type: "waiting", meeting: { title: "T", host_name: null } });
    await act(async () => socket().onStatus("reconnecting"));
    await connect();
    await waitFor(() => expect(sent("join")).toHaveLength(2));
    expect(result.current.phase).toBe("waiting");
  });

  it("tells the server when a waiting guest leaves", async () => {
    const { result } = await renderWaiting();
    emit({ type: "waiting", meeting: { title: "T", host_name: null } });
    act(() => result.current.leave());
    expect(sent("leave")).toHaveLength(1);
    expect(result.current.phase).toBe("left");
  });

  it("keeps the host list from server pushes and calls the API for decisions", async () => {
    waitingApi.admitGuest.mockResolvedValue({ id: 5, state: "ADMITTED", changed: true });
    waitingApi.setWaitingRoomEnabled.mockResolvedValue({
      enabled: false,
      admission_mode: "host_approval",
      entries: [],
    });
    const { result } = await renderWaiting();
    emit({
      type: "waiting_room_updated",
      enabled: true,
      entries: [
        { id: 5, display_name: "Gina", username: "gina", requested_at: "2026-01-01T00:00:00Z" },
        { id: 6, display_name: "Gus", username: null, requested_at: "2026-01-01T00:00:01Z" },
      ],
    });
    expect(result.current.waitingRoom.enabled).toBe(true);
    expect(result.current.waitingRoom.entries.map((e) => e.display_name)).toEqual(["Gina", "Gus"]);

    await act(async () => result.current.waitingRoom.admit(5));
    expect(waitingApi.admitGuest).toHaveBeenCalledWith(MEETING_ID, 5);
    expect(result.current.waitingRoom.entries.map((e) => e.id)).toEqual([6]);

    await act(async () => result.current.waitingRoom.setEnabled(false));
    expect(waitingApi.setWaitingRoomEnabled).toHaveBeenCalledWith(MEETING_ID, false);
    expect(result.current.waitingRoom.enabled).toBe(false);
  });

  it("falls back to the meeting record until the server says otherwise", async () => {
    const { result } = await renderWaiting();
    expect(result.current.waitingRoom.enabled).toBe(true);
  });
});
