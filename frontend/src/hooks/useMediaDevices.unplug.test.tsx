import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMediaDevices } from "./useMediaDevices";

afterEach(cleanup);

/** A track that can announce `ended` the way a browser does when the device is unplugged. */
class EndableTrack {
  enabled = true;
  private handlers: (() => void)[] = [];
  constructor(public kind: "audio" | "video") {}
  stop = vi.fn();
  addEventListener(type: string, handler: () => void) {
    if (type === "ended") this.handlers.push(handler);
  }
  end() {
    this.handlers.forEach((h) => h());
  }
}

class FakeMediaStream {
  private tracks: EndableTrack[];
  constructor(tracks: EndableTrack[] = []) {
    this.tracks = [...tracks];
  }
  getTracks() {
    return [...this.tracks];
  }
  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === "audio");
  }
  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === "video");
  }
}

let made: EndableTrack[] = [];

beforeEach(() => {
  made = [];
  window.sessionStorage.clear();
  (globalThis as { MediaStream?: unknown }).MediaStream = FakeMediaStream;
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async (c: MediaStreamConstraints) => {
        const track = new EndableTrack(c.video ? "video" : "audio");
        made.push(track);
        return new FakeMediaStream([track]);
      }),
      enumerateDevices: vi.fn(async () => []),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  });
});

describe("a device disconnected during the meeting", () => {
  it("turns the camera off, says so, and lets the user turn it on again", async () => {
    const { result } = renderHook(() => useMediaDevices());
    await act(async () => {
      await result.current.setVideoOn(true);
    });
    expect(result.current.isVideoOn).toBe(true);

    act(() => made[0].end()); // the camera is unplugged

    expect(result.current.isVideoOn).toBe(false);
    expect(result.current.error).toMatch(/camera was disconnected/i);
    expect(result.current.stream?.getVideoTracks()).toHaveLength(0);

    await act(async () => {
      await result.current.setVideoOn(true); // plugged back in
    });
    expect(result.current.isVideoOn).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("leaves audio, and says so, when the microphone disappears", async () => {
    const { result } = renderHook(() => useMediaDevices());
    await act(async () => {
      await result.current.joinAudio();
    });
    expect(result.current.audioJoined).toBe(true);

    act(() => made[0].end());

    expect(result.current.audioJoined).toBe(false);
    expect(result.current.isMuted).toBe(true);
    expect(result.current.error).toMatch(/microphone was disconnected/i);
  });

  it("ignores the end of a track that was already replaced by another device", async () => {
    const { result } = renderHook(() => useMediaDevices());
    await act(async () => {
      await result.current.setVideoOn(true);
    });
    const first = made[0];
    await act(async () => {
      result.current.setVideoInput("other-cam");
    });
    expect(made.length).toBeGreaterThan(1);
    act(() => first.end()); // the old camera ends after the swap: nothing to report
    expect(result.current.isVideoOn).toBe(true);
    expect(result.current.error).toBeNull();
  });
});
