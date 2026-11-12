import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WaitingRoomScreen } from "./WaitingRoomScreen";

describe("WaitingRoomScreen", () => {
  afterEach(cleanup);

  it("shows only the meeting title and host, and a Leave button", () => {
    const onLeave = vi.fn();
    render(
      <WaitingRoomScreen
        title="Design review"
        hostName="Hal"
        connection="connected"
        onLeave={onLeave}
        onReconnect={() => undefined}
      />
    );
    expect(screen.getByText("Design review")).toBeTruthy();
    expect(screen.getByText("Hal")).toBeTruthy();
    expect(screen.getByText(/as soon as the host lets you in/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Leave" }));
    expect(onLeave).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Reconnect" })).toBeNull();
  });

  it("offers Reconnect when the connection was lost", () => {
    const onReconnect = vi.fn();
    render(
      <WaitingRoomScreen
        title="T"
        hostName={null}
        connection="disconnected"
        onLeave={() => undefined}
        onReconnect={onReconnect}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
    expect(onReconnect).toHaveBeenCalled();
  });

  it("says when it is reconnecting", () => {
    render(
      <WaitingRoomScreen
        title="T"
        hostName="H"
        connection="reconnecting"
        onLeave={() => undefined}
        onReconnect={() => undefined}
      />
    );
    expect(screen.getByText("Reconnecting…")).toBeTruthy();
  });
});
