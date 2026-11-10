import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEYS } from "@/lib/constants";
import { useMediaDevices } from "./useMediaDevices";

afterEach(cleanup);

interface FakeTrack {
  kind: "audio" | "video";
  enabled: boolean;
  stop: () => void;
}

function fakeTrack(kind: "audio" | "video", stop = vi.fn()): FakeTrack {
  return { kind, enabled: true, stop };
}

function fakeStream(audio: FakeTrack[], video: FakeTrack[]) {
  const tracks: FakeTrack[] = [...audio, ...video];
  return {
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((t) => t.kind === "audio"),
    getVideoTracks: () => tracks.filter((t) => t.kind === "video"),
  };
}

/** jsdom ships no MediaStream; `mergeTrack` publishes a fresh one per capture. */
class FakeMediaStream {
  private tracks: unknown[];
  constructor(tracks: unknown[] = []) {
    this.tracks = [...tracks];
  }
  getTracks(): unknown[] {
    return [...this.tracks];
  }
  getAudioTracks(): unknown[] {
    return this.tracks.filter((t) => (t as FakeTrack).kind === "audio");
  }
  getVideoTracks(): unknown[] {
    return this.tracks.filter((t) => (t as FakeTrack).kind === "video");
  }
  addTrack(track: unknown): void {
    if (!this.tracks.includes(track)) this.tracks.push(track);
  }
  removeTrack(track: unknown): void {
    this.tracks = this.tracks.filter((t) => t !== track);
  }
}

function device(
  deviceId: string,
  kind: MediaDeviceKind,
  label: string
): MediaDeviceInfo {
  return {
    deviceId,
    kind,
    label,
    groupId: "group-1",
    toJSON: () => ({ deviceId, kind, label, groupId: "group-1" }),
  };
}

const MIC_A = device("mic-a", "audioinput", "Built-in Mic");
const MIC_B = device("mic-b", "audioinput", "Headset Mic");
const CAM_A = device("cam-a", "videoinput", "Built-in Cam");
const SPEAKER = device("out-a", "audiooutput", "Speakers");

const listeners = new Map<string, Set<EventListener>>();
let devices: MediaDeviceInfo[] = [MIC_A, MIC_B, CAM_A, SPEAKER];
let getUserMedia: ReturnType<typeof vi.fn>;

function installMediaDevices(): void {
  getUserMedia = vi.fn(async (constraints: MediaStreamConstraints) => {
    const wantAudio = Boolean(constraints.audio);
    const wantVideo = Boolean(constraints.video);
    return fakeStream(
      wantAudio ? [fakeTrack("audio")] : [],
      wantVideo ? [fakeTrack("video")] : []
    ) as unknown as MediaStream;
  });

  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia,
      enumerateDevices: vi.fn(async () => devices),
      addEventListener: vi.fn((type: string, handler: EventListener) => {
        const set = listeners.get(type) ?? new Set<EventListener>();
        set.add(handler);
        listeners.set(type, set);
      }),
      removeEventListener: vi.fn((type: string, handler: EventListener) => {
        listeners.get(type)?.delete(handler);
      }),
    },
  });
}

function emitDeviceChange(): void {
  for (const handler of listeners.get("devicechange") ?? []) {
    handler(new Event("devicechange"));
  }
}

function namedError(name: string): Error {
  const error = new Error(name.toLowerCase());
  error.name = name;
  return error;
}

beforeEach(() => {
  devices = [MIC_A, MIC_B, CAM_A, SPEAKER];
  listeners.clear();
  window.sessionStorage.clear();
  (globalThis as { MediaStream?: unknown }).MediaStream = FakeMediaStream;
  installMediaDevices();
});

describe("useMediaDevices", () => {
  it("groups the enumerated devices by kind", async () => {
    const { result } = renderHook(() => useMediaDevices());

    await act(async () => undefined);

    expect(result.current.audioInputDevices.map((d) => d.deviceId)).toEqual([
      "mic-a",
      "mic-b",
    ]);
    expect(result.current.videoInputDevices.map((d) => d.deviceId)).toEqual([
      "cam-a",
    ]);
    expect(result.current.audioOutputDevices.map((d) => d.deviceId)).toEqual([
      "out-a",
    ]);
  });

  it("restores the device preference saved earlier in the tab", () => {
    window.sessionStorage.setItem(STORAGE_KEYS.audioInput, "mic-b");
    window.sessionStorage.setItem(STORAGE_KEYS.videoInput, "cam-a");

    const { result } = renderHook(() => useMediaDevices());

    expect(result.current.selectedAudioInputId).toBe("mic-b");
    expect(result.current.selectedVideoInputId).toBe("cam-a");
  });

  it("starts with microphone and camera off and never prompts on mount", async () => {
    const { result } = renderHook(() => useMediaDevices());

    await act(async () => undefined);

    expect(getUserMedia).not.toHaveBeenCalled();
    expect(result.current.audioJoined).toBe(false);
    expect(result.current.isMuted).toBe(true);
    expect(result.current.isVideoOn).toBe(false);
    expect(result.current.stream).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("acquire only refreshes device names and never prompts for media", async () => {
    const { result } = renderHook(() => useMediaDevices());
    await act(async () => undefined);

    await act(async () => {
      await result.current.acquire();
    });

    expect(getUserMedia).not.toHaveBeenCalled();
    expect(result.current.stream).toBeNull();
  });

  it("joinAudio requests the microphone and joins unmuted", async () => {
    window.sessionStorage.setItem(STORAGE_KEYS.audioInput, "mic-b");
    const { result } = renderHook(() => useMediaDevices());

    let joined = false;
    await act(async () => {
      joined = await result.current.joinAudio();
    });

    expect(joined).toBe(true);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(getUserMedia.mock.calls[0][0]).toEqual({
      audio: { deviceId: { exact: "mic-b" } },
    });
    expect(result.current.audioJoined).toBe(true);
    expect(result.current.isMuted).toBe(false);
    expect(result.current.stream?.getAudioTracks()).toHaveLength(1);
    expect(result.current.error).toBeNull();
  });

  it("joinAudio is idempotent", async () => {
    const { result } = renderHook(() => useMediaDevices());

    await act(async () => {
      await result.current.joinAudio();
      await result.current.joinAudio();
    });

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(result.current.audioJoined).toBe(true);
  });

  it("joinAudio explains blocked permission without leaking the exception", async () => {
    const { result } = renderHook(() => useMediaDevices());
    getUserMedia.mockImplementationOnce(async () => {
      throw namedError("NotAllowedError");
    });

    let joined = true;
    await act(async () => {
      joined = await result.current.joinAudio();
    });

    expect(joined).toBe(false);
    expect(result.current.audioJoined).toBe(false);
    expect(result.current.audioAvailable).toBe(false);
    expect(result.current.stream).toBeNull();
    expect(result.current.error).toContain("Microphone access was blocked");
    expect(result.current.error).not.toContain("NotAllowedError");
  });

  it("joinAudio explains a missing microphone", async () => {
    const { result } = renderHook(() => useMediaDevices());
    getUserMedia.mockImplementationOnce(async () => {
      throw namedError("NotFoundError");
    });

    await act(async () => {
      await result.current.joinAudio();
    });

    expect(result.current.audioJoined).toBe(false);
    expect(result.current.error).toContain("No microphone was found");
  });

  it("joinAudio reports a device that another application is using", async () => {
    const { result } = renderHook(() => useMediaDevices());
    getUserMedia.mockImplementationOnce(async () => {
      throw namedError("NotReadableError");
    });

    await act(async () => {
      await result.current.joinAudio();
    });

    expect(result.current.error).toContain("another application");
  });

  it("setMuted before joining audio is a no-op", async () => {
    const { result } = renderHook(() => useMediaDevices());

    act(() => {
      result.current.setMuted(false);
      result.current.setMuted(true);
    });

    expect(getUserMedia).not.toHaveBeenCalled();
    expect(result.current.isMuted).toBe(true);
  });

  it("mute toggles the live microphone without a new prompt", async () => {
    const { result } = renderHook(() => useMediaDevices());
    await act(async () => {
      await result.current.joinAudio();
    });

    act(() => result.current.setMuted(true));
    expect(result.current.stream?.getAudioTracks()[0].enabled).toBe(false);
    expect(result.current.isMuted).toBe(true);

    act(() => result.current.setMuted(false));
    expect(result.current.stream?.getAudioTracks()[0].enabled).toBe(true);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it("passes caller-supplied camera constraints, and stays {video:true} without them", async () => {
    const ideal = { width: { ideal: 960 }, height: { ideal: 540 } };
    const { result } = renderHook(() => useMediaDevices({ videoConstraints: ideal }));
    await act(async () => undefined);
    await act(async () => {
      await result.current.setVideoOn(true);
    });
    expect(getUserMedia.mock.calls[0][0]).toEqual({ video: ideal });
  });

  it("exposes a pending flag while the camera request is in flight", async () => {
    let release: (stream: unknown) => void = () => undefined;
    getUserMedia.mockImplementationOnce(
      () => new Promise((resolve) => { release = resolve; })
    );
    const { result } = renderHook(() => useMediaDevices());
    await act(async () => undefined);
    expect(result.current.videoPending).toBe(false);

    let done: Promise<void> = Promise.resolve();
    act(() => {
      done = result.current.setVideoOn(true);
    });
    expect(result.current.videoPending).toBe(true);
    expect(result.current.isVideoOn).toBe(false); // never optimistic

    await act(async () => {
      release(fakeStream([], [fakeTrack("video")]));
      await done;
    });
    expect(result.current.videoPending).toBe(false);
    expect(result.current.isVideoOn).toBe(true);
  });

  it("setVideoOn starts the camera on demand and reuses the track", async () => {
    const { result } = renderHook(() => useMediaDevices());
    await act(async () => undefined);
    expect(getUserMedia).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.setVideoOn(true);
    });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(getUserMedia.mock.calls[0][0]).toEqual({ video: true });
    expect(result.current.isVideoOn).toBe(true);
    expect(result.current.stream?.getVideoTracks()).toHaveLength(1);

    act(() => {
      void result.current.setVideoOn(false);
    });
    expect(result.current.stream?.getVideoTracks()[0].enabled).toBe(false);
    expect(result.current.isVideoOn).toBe(false);

    // Coming back on reuses the captured track — no second permission prompt.
    await act(async () => {
      await result.current.setVideoOn(true);
    });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(result.current.isVideoOn).toBe(true);
    expect(result.current.stream?.getVideoTracks()[0].enabled).toBe(true);
  });

  it("setVideoOn explains a blocked camera without leaking the exception", async () => {
    const { result } = renderHook(() => useMediaDevices());
    getUserMedia.mockImplementationOnce(async () => {
      throw namedError("NotAllowedError");
    });

    await act(async () => {
      await result.current.setVideoOn(true);
    });

    expect(result.current.isVideoOn).toBe(false);
    expect(result.current.videoAvailable).toBe(false);
    expect(result.current.stream).toBeNull();
    expect(result.current.audioJoined).toBe(false);
    expect(result.current.error).toContain("Camera access was blocked");
    expect(result.current.error).not.toContain("NotAllowedError");
  });

  it("keeps the mute choice when swapping the microphone", async () => {
    const { result } = renderHook(() => useMediaDevices());
    await act(async () => {
      await result.current.joinAudio();
    });

    const previousStop = result.current.stream
      ?.getAudioTracks()[0].stop as ReturnType<typeof vi.fn>;

    act(() => result.current.setMuted(true));
    await act(async () => {
      result.current.setAudioInput("mic-b");
    });

    expect(window.sessionStorage.getItem(STORAGE_KEYS.audioInput)).toBe("mic-b");
    expect(result.current.selectedAudioInputId).toBe("mic-b");
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(getUserMedia.mock.calls[1][0]).toMatchObject({
      audio: { deviceId: { exact: "mic-b" } },
    });
    expect(previousStop).toHaveBeenCalledTimes(1);
    expect(result.current.isMuted).toBe(true);
    expect(result.current.stream?.getAudioTracks()[0].enabled).toBe(false);
  });

  it("applies a microphone chosen before joining audio", async () => {
    window.sessionStorage.setItem(STORAGE_KEYS.audioInput, "mic-b");
    const { result } = renderHook(() => useMediaDevices());

    act(() => result.current.setAudioInput("mic-a"));

    // Selecting before Join Audio only stores the preference.
    expect(getUserMedia).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.joinAudio();
    });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(getUserMedia.mock.calls[0][0]).toEqual({
      audio: { deviceId: { exact: "mic-a" } },
    });
  });

  it("swaps the camera and keeps the on state", async () => {
    const { result } = renderHook(() => useMediaDevices());
    await act(async () => {
      await result.current.setVideoOn(true);
    });
    const previousStop = result.current.stream
      ?.getVideoTracks()[0].stop as ReturnType<typeof vi.fn>;

    await act(async () => {
      result.current.setVideoInput("cam-a");
    });

    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(previousStop).toHaveBeenCalledTimes(1);
    expect(result.current.isVideoOn).toBe(true);
    expect(result.current.stream?.getVideoTracks()[0].enabled).toBe(true);
  });

  it("falls back to the default device when the stored one is gone", async () => {
    window.sessionStorage.setItem(STORAGE_KEYS.audioInput, "mic-gone");
    const { result } = renderHook(() => useMediaDevices());

    getUserMedia.mockImplementationOnce(async () => {
      throw namedError("OverconstrainedError");
    });

    await act(async () => {
      await result.current.joinAudio();
    });

    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(getUserMedia.mock.calls[1][0]).toEqual({ audio: true });
    expect(result.current.audioJoined).toBe(true);
    expect(result.current.error).toContain("no longer available");
  });

  it("re-enumerates once for a burst of device changes", async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useMediaDevices());
      await act(async () => undefined);
      expect(result.current.videoInputDevices).toHaveLength(1);

      devices = [
        MIC_A,
        MIC_B,
        CAM_A,
        SPEAKER,
        device("cam-b", "videoinput", "Webcam"),
      ];
      const enumerate = navigator.mediaDevices
        .enumerateDevices as unknown as ReturnType<typeof vi.fn>;
      const before = enumerate.mock.calls.length;

      await act(async () => {
        emitDeviceChange();
        emitDeviceChange();
        emitDeviceChange();
      });
      // Nothing is re-enumerated until the burst settles.
      expect(enumerate.mock.calls.length).toBe(before);

      await act(async () => {
        vi.advanceTimersByTime(300);
      });
      expect(enumerate.mock.calls.length).toBe(before + 1);
      expect(result.current.videoInputDevices.map((d) => d.deviceId)).toEqual([
        "cam-a",
        "cam-b",
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops every track and resets join state when the media is released", async () => {
    const stops: Array<ReturnType<typeof vi.fn>> = [];
    getUserMedia.mockImplementation(async (constraints: MediaStreamConstraints) => {
      const audio = constraints.audio ? [fakeTrack("audio", vi.fn())] : [];
      const video = constraints.video ? [fakeTrack("video", vi.fn())] : [];
      for (const track of [...audio, ...video]) {
        stops.push(track.stop as ReturnType<typeof vi.fn>);
      }
      return fakeStream(audio, video) as unknown as MediaStream;
    });

    const { result } = renderHook(() => useMediaDevices());
    await act(async () => {
      await result.current.joinAudio();
    });
    await act(async () => {
      await result.current.setVideoOn(true);
    });

    act(() => result.current.stop());

    expect(stops[0]).toHaveBeenCalledTimes(1);
    expect(stops[1]).toHaveBeenCalledTimes(1);
    expect(result.current.stream).toBeNull();
    expect(result.current.audioJoined).toBe(false);
    expect(result.current.isMuted).toBe(true);
    expect(result.current.isVideoOn).toBe(false);
  });

  it("does not offer speaker selection where setSinkId is unavailable", () => {
    const { result } = renderHook(() => useMediaDevices());
    expect(result.current.canSelectSpeaker).toBe(false);
  });
});
