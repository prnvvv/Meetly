import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ControlBar } from "./ControlBar";

afterEach(cleanup);

beforeEach(() => {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      enumerateDevices: vi.fn().mockResolvedValue([]),
    },
  });
});

const devices = {
  audioInputDevices: [] as MediaDeviceInfo[],
  videoInputDevices: [] as MediaDeviceInfo[],
  selectedAudioInputId: null,
  selectedVideoInputId: null,
  setAudioInput: vi.fn(),
  setVideoInput: vi.fn(),
};

function renderBar(overrides: Partial<Parameters<typeof ControlBar>[0]> = {}) {
  const handlers = {
    onToggleMute: vi.fn(),
    onToggleVideo: vi.fn(),
    onToggleParticipants: vi.fn(),
    onLeave: vi.fn(),
    onReact: vi.fn(),
    onSetLayout: vi.fn(),
    onOpenSettings: vi.fn(),
    onToggleFullscreen: vi.fn(),
    onCopyInvite: vi.fn(),
  };
  render(
    <ControlBar
      isMuted={false}
      isVideoOn
      audioJoined
      audioAvailable
      videoAvailable
      participantsOpen={false}
      isHost={false}
      layout="auto"
      isFullscreen={false}
      fullscreenSupported
      devices={devices}
      {...handlers}
      {...overrides}
    />
  );
  return handlers;
}

function toolbarLabels(): string[] {
  const toolbar = screen.getByRole("toolbar", { name: "Meeting controls" });
  return Array.from(toolbar.querySelectorAll("button")).map((button) => {
    const label =
      button.getAttribute("aria-label") ??
      button.textContent?.trim() ??
      "";
    return label;
  });
}

describe("ControlBar", () => {
  it("toggles mute and reflects the muted state", () => {
    const { onToggleMute } = renderBar();
    const mute = screen.getByRole("button", { name: "Mute microphone" });
    expect(mute.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(mute);
    expect(onToggleMute).toHaveBeenCalledTimes(1);
  });

  it("shows unmute controls while muted", () => {
    renderBar({ isMuted: true, isVideoOn: false });
    expect(screen.getByRole("button", { name: "Unmute microphone" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Turn camera on" })).toBeTruthy();
  });

  it("shows Join Audio before audio is joined and routes the click to join", () => {
    const { onToggleMute } = renderBar({ audioJoined: false, isMuted: true });
    const join = screen.getByRole("button", { name: "Join Audio" });
    expect(join.textContent).toContain("Join Audio");
    expect(join.getAttribute("aria-pressed")).toBeNull();

    fireEvent.click(join);
    expect(onToggleMute).toHaveBeenCalledTimes(1);
  });

  it("shows Start Video while the camera is off", () => {
    renderBar({ isVideoOn: false });
    expect(screen.getByText("Start Video")).toBeTruthy();
    expect(screen.queryByText("Stop Video")).toBeNull();
  });

  it("shows Stop Video while the camera is on", () => {
    renderBar({ isVideoOn: true });
    expect(screen.getByText("Stop Video")).toBeTruthy();
  });

  it("leaves the meeting when End is clicked", () => {
    const { onLeave } = renderBar();
    fireEvent.click(screen.getByRole("button", { name: "Leave meeting" }));
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it("marks mic and camera as active only when they are really live", () => {
    renderBar({ isMuted: false, isVideoOn: true });
    const mic = screen.getByRole("button", { name: "Mute microphone" });
    const camera = screen.getByRole("button", { name: "Turn camera off" });
    expect(mic.className).toContain("control--active");
    expect(camera.className).toContain("control--active");
  });

  it("shows mic and camera as off when muted or stopped", () => {
    renderBar({ isMuted: true, isVideoOn: false });
    expect(
      screen.getByRole("button", { name: "Unmute microphone" }).className
    ).toContain("control--off");
    expect(
      screen.getByRole("button", { name: "Turn camera on" }).className
    ).toContain("control--off");
  });

  it("never shows the camera as on when the device is unavailable", () => {
    renderBar({ isVideoOn: true, videoAvailable: false });
    const camera = screen.getByRole("button", { name: "Turn camera off" });
    expect(camera.className).toContain("control--off");
    expect(camera.className).toContain("control--unavailable");
    expect(screen.getByText("Start Video")).toBeTruthy();
  });

  it("lets the host end the meeting for everyone instead of just leaving", () => {
    const onEndMeeting = vi.fn();
    const { onLeave } = renderBar({ isHost: true, onEndMeeting });
    fireEvent.click(
      screen.getByRole("button", { name: "End meeting for everyone" })
    );
    expect(onEndMeeting).toHaveBeenCalledTimes(1);
    expect(onLeave).not.toHaveBeenCalled();
  });

  it("shows a busy state while camera or mic permission is pending", () => {
    renderBar({ isVideoOn: false, videoPending: true, audioPending: true });
    const camera = screen.getByRole("button", { name: "Turn camera on" });
    const mic = screen.getByRole("button", { name: "Mute microphone" });
    expect(camera.getAttribute("aria-busy")).toBe("true");
    expect(mic.getAttribute("aria-busy")).toBe("true");
  });

  it("is not busy by default", () => {
    renderBar();
    expect(
      screen.getByRole("button", { name: "Turn camera off" }).getAttribute("aria-busy")
    ).toBeNull();
  });

  it("toggles the participants panel", () => {
    const { onToggleParticipants } = renderBar();
    fireEvent.click(screen.getByRole("button", { name: "Show participants" }));
    expect(onToggleParticipants).toHaveBeenCalledTimes(1);
  });

  it("orders controls: Audio, Video, Participants, React, More, End", () => {
    renderBar();
    const labels = toolbarLabels();
    const expected = [
      "Mute microphone",
      "Turn camera off",
      "Show participants",
      "Open reactions",
      "Open more options",
      "Leave meeting",
    ];
    let cursor = -1;
    for (const label of expected) {
      const index = labels.indexOf(label);
      expect(index).toBeGreaterThan(cursor);
      cursor = index;
    }
  });

  it("never renders a Chat control", () => {
    renderBar();
    expect(screen.queryByRole("button", { name: /chat/i })).toBeNull();
    expect(screen.queryByText("Chat")).toBeNull();
  });

  it("hides host tools unless the server says we are host", () => {
    renderBar({ isHost: false });
    expect(screen.queryByRole("button", { name: "Open host tools" })).toBeNull();
  });

  it("shows host tools for the host and opens the host menu", () => {
    renderBar({ isHost: true });
    const hostTools = screen.getByRole("button", { name: "Open host tools" });
    expect(toolbarLabels().indexOf("Open host tools")).toBeGreaterThan(
      toolbarLabels().indexOf("Open reactions")
    );

    fireEvent.click(hostTools);
    expect(screen.getByText("Mute everyone")).toBeTruthy();
    expect(screen.getByText("End meeting for all")).toBeTruthy();
  });

  it("opens reactions and reports the chosen emoji", () => {
    const { onReact } = renderBar();
    fireEvent.click(screen.getByRole("button", { name: "Open reactions" }));
    const emoji = screen.getAllByRole("button").find((button) =>
      (button.getAttribute("aria-label") ?? "").includes("React with")
    );
    expect(emoji).toBeTruthy();
    fireEvent.click(emoji as HTMLElement);
    expect(onReact).toHaveBeenCalledTimes(1);
  });

  it("opens audio settings from the audio menu", () => {
    const { onOpenSettings } = renderBar();
    fireEvent.click(screen.getByRole("button", { name: "Audio options" }));
    fireEvent.click(screen.getByText("Audio settings…"));
    expect(onOpenSettings).toHaveBeenCalledWith("audio");
  });

  it("reports the chosen layout from the More menu", () => {
    const { onSetLayout } = renderBar();
    fireEvent.click(screen.getByRole("button", { name: "Open more options" }));
    fireEvent.click(screen.getByText("Speaker view"));
    expect(onSetLayout).toHaveBeenCalledWith("speaker");
  });

  it("opens settings from the More menu", () => {
    const { onOpenSettings } = renderBar();
    fireEvent.click(screen.getByRole("button", { name: "Open more options" }));
    fireEvent.click(screen.getByText("Settings…"));
    expect(onOpenSettings).toHaveBeenCalledWith("general");
  });
});
