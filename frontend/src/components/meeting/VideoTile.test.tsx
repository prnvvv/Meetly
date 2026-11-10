import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VideoTile } from "./VideoTile";

afterEach(cleanup);

describe("VideoTile", () => {
  it("shows the participant name and an illustrated avatar, not initials", () => {
    render(<VideoTile name="Priya Sharma" />);
    expect(screen.getByText("Priya Sharma")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Priya Sharma avatar" })).toBeTruthy();
    expect(screen.queryByText("PS")).toBeNull();
  });

  it("marks muted participants for screen readers", () => {
    render(<VideoTile name="Rahul Verma" isMuted />);
    expect(screen.getByLabelText("Rahul Verma is muted")).toBeTruthy();
  });

  it("does not render a mute status when unmuted", () => {
    render(<VideoTile name="Rahul Verma" />);
    expect(screen.queryAllByLabelText(/is muted/)).toHaveLength(0);
    expect(screen.getByLabelText("Rahul Verma microphone is on")).toBeTruthy();
  });

  it("shows a host badge only for hosts", () => {
    const { rerender } = render(<VideoTile name="Host User" isHost />);
    expect(screen.getByText("Host")).toBeTruthy();

    rerender(<VideoTile name="Guest User" />);
    expect(screen.queryByText("Host")).toBeNull();
  });

  it("replaces the placeholder with custom children", () => {
    render(
      <VideoTile name="Priya Sharma">
        <video data-testid="tile-video" />
      </VideoTile>
    );
    expect(screen.getByTestId("tile-video")).toBeTruthy();
    expect(screen.queryByRole("img", { name: /avatar/ })).toBeNull();
  });

  it("attaches a live stream to the video element", () => {
    const stream = { id: "remote-stream" } as unknown as MediaStream;
    render(<VideoTile name="Rahul Verma" stream={stream} />);

    const video = document.querySelector("video");
    expect(video).toBeTruthy();
    expect(video?.srcObject).toBe(stream);
    expect(screen.queryByRole("img", { name: /avatar/ })).toBeNull();
  });

  it("keeps the local video muted to avoid echo", () => {
    const stream = { id: "local-stream" } as unknown as MediaStream;
    render(<VideoTile name="You" stream={stream} videoMuted />);
    expect(document.querySelector("video")?.muted).toBe(true);
  });

  it("falls back to the avatar when the camera is off", () => {
    const stream = { id: "remote-stream" } as unknown as MediaStream;
    render(<VideoTile name="Rahul Verma" stream={stream} isVideoOn={false} />);

    expect(document.querySelector("video")).toBeNull();
    expect(screen.getByRole("img", { name: "Rahul Verma avatar" })).toBeTruthy();
    expect(screen.getByLabelText("Rahul Verma camera is off")).toBeTruthy();
  });

  it("does not flag the camera as off while video is live", () => {
    const stream = { id: "remote-stream" } as unknown as MediaStream;
    render(<VideoTile name="Rahul Verma" stream={stream} isVideoOn />);
    expect(screen.queryByLabelText(/camera is off/)).toBeNull();
  });

  it("detaches the stream once the camera is switched off", () => {
    const stream = { id: "remote-stream" } as unknown as MediaStream;
    const { rerender } = render(<VideoTile name="Rahul" stream={stream} />);
    expect(document.querySelector("video")?.srcObject).toBe(stream);

    rerender(<VideoTile name="Rahul" stream={stream} isVideoOn={false} />);
    expect(document.querySelector("video")).toBeNull();
  });

  describe("camera framing", () => {
    function sizeVideo(width: number, height: number) {
      const video = document.querySelector("video") as HTMLVideoElement;
      Object.defineProperty(video, "videoWidth", { configurable: true, value: width });
      Object.defineProperty(video, "videoHeight", { configurable: true, value: height });
      act(() => {
        video.dispatchEvent(new Event("loadedmetadata"));
      });
    }

    it("takes the camera's own aspect ratio", () => {
      const stream = { id: "s" } as unknown as MediaStream;
      render(<VideoTile name="Rahul" stream={stream} />);
      sizeVideo(1280, 720);
      const tile = document.querySelector(".tile") as HTMLElement;
      expect(tile.classList.contains("tile--adaptive")).toBe(true);
      expect(Number(tile.style.getPropertyValue("--tile-ar"))).toBeCloseTo(16 / 9, 3);
    });

    it("handles portrait cameras", () => {
      const stream = { id: "s" } as unknown as MediaStream;
      render(<VideoTile name="Rahul" stream={stream} />);
      sizeVideo(480, 640);
      const tile = document.querySelector(".tile") as HTMLElement;
      expect(Number(tile.style.getPropertyValue("--tile-ar"))).toBeCloseTo(0.75, 3);
    });

    it("reports its real aspect ratio to the grid and clears it when video stops", () => {
      const onAspectChange = vi.fn();
      const stream = { id: "s" } as unknown as MediaStream;
      const { rerender } = render(
        <VideoTile name="Rahul" stream={stream} onAspectChange={onAspectChange} />
      );
      sizeVideo(1280, 720);
      expect(onAspectChange).toHaveBeenLastCalledWith(expect.closeTo(16 / 9, 3));
      rerender(
        <VideoTile name="Rahul" stream={stream} isVideoOn={false} onAspectChange={onAspectChange} />
      );
      expect(onAspectChange).toHaveBeenLastCalledWith(null);
    });

    it("follows a resolution change from the same stream", () => {
      const stream = { id: "s" } as unknown as MediaStream;
      render(<VideoTile name="Rahul" stream={stream} />);
      sizeVideo(640, 480);
      const tile = document.querySelector(".tile") as HTMLElement;
      expect(Number(tile.style.getPropertyValue("--tile-ar"))).toBeCloseTo(4 / 3, 3);
      sizeVideo(1920, 1080);
      expect(Number(tile.style.getPropertyValue("--tile-ar"))).toBeCloseTo(16 / 9, 3);
    });

    it("ignores the 2x2 placeholder Chrome reports for a dead track", () => {
      const stream = { id: "s" } as unknown as MediaStream;
      render(<VideoTile name="Rahul" stream={stream} />);
      sizeVideo(2, 2);
      expect(document.querySelector(".tile--adaptive")).toBeNull();
    });

    it("falls back to the avatar when the video track ends", () => {
      let ended: () => void = () => undefined;
      const track = {
        readyState: "live",
        addEventListener: (_: string, cb: () => void) => { ended = cb; },
        removeEventListener: () => undefined,
      };
      const stream = { id: "s", getVideoTracks: () => [track] } as unknown as MediaStream;
      render(<VideoTile name="Rahul" stream={stream} />);
      expect(document.querySelector("video")).toBeTruthy();
      act(() => ended());
      expect(document.querySelector("video")).toBeNull();
      expect(screen.getByRole("img", { name: "Rahul avatar" })).toBeTruthy();
    });

    it("keeps camera-off tiles landscape when a fallback aspect is given", () => {
      render(<VideoTile name="Rahul" isVideoOn={false} fallbackAspect={16 / 9} />);
      const tile = document.querySelector(".tile") as HTMLElement;
      expect(tile.classList.contains("tile--adaptive")).toBe(true);
      expect(Number(tile.style.getPropertyValue("--tile-ar"))).toBeCloseTo(16 / 9, 3);
    });

    it("lets a lone camera-off tile fill the canvas", () => {
      render(<VideoTile name="Rahul" isVideoOn={false} />);
      expect(document.querySelector(".tile--adaptive")).toBeNull();
    });

    it("applies no zoom transform to the video", () => {
      const stream = { id: "s" } as unknown as MediaStream;
      render(<VideoTile name="Rahul" stream={stream} />);
      const video = document.querySelector("video") as HTMLVideoElement;
      expect(video.style.transform).toBe("");
    });
  });
});
