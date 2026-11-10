import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HostBadge, ParticipantStatus } from "./ParticipantStatus";

afterEach(cleanup);

describe("ParticipantStatus", () => {
  it("announces a muted microphone and shows the name", () => {
    render(<ParticipantStatus name="Asha (You)" isMuted isVideoOn />);
    expect(screen.getByText("Asha (You)")).toBeTruthy();
    expect(screen.getByLabelText("Asha (You) is muted")).toBeTruthy();
  });

  it("announces a live microphone", () => {
    render(<ParticipantStatus name="Rahul" isMuted={false} isVideoOn />);
    expect(screen.getByLabelText("Rahul microphone is on")).toBeTruthy();
  });

  it("announces camera off with text, not only an icon", () => {
    render(<ParticipantStatus name="Rahul" isMuted={false} isVideoOn={false} />);
    expect(screen.getByLabelText("Rahul camera is off")).toBeTruthy();
  });
});

describe("HostBadge", () => {
  it("labels the host", () => {
    render(<HostBadge />);
    expect(screen.getByText("Host")).toBeTruthy();
  });
});
