import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/common/ToastProvider";
import type { WaitingRoomControls } from "@/hooks/useMeeting";
import { WaitingRoomPanel } from "./WaitingRoomPanel";

function controls(over: Partial<WaitingRoomControls> = {}): WaitingRoomControls {
  return {
    enabled: true,
    entries: [
      { id: 1, display_name: "Gina", username: "gina", requested_at: new Date().toISOString() },
      { id: 2, display_name: "Gus", username: null, requested_at: new Date().toISOString() },
    ],
    admit: vi.fn().mockResolvedValue(undefined),
    reject: vi.fn().mockResolvedValue(undefined),
    admitAll: vi.fn().mockResolvedValue(undefined),
    setEnabled: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

const renderPanel = (c: WaitingRoomControls) =>
  render(
    <ToastProvider>
      <WaitingRoomPanel controls={c} />
    </ToastProvider>
  );

describe("WaitingRoomPanel", () => {
  afterEach(cleanup);

  it("lists who is waiting with their verified username", () => {
    renderPanel(controls());
    expect(screen.getByText("Gina")).toBeTruthy();
    expect(screen.getByText(/@gina/)).toBeTruthy();
    expect(screen.getByText("Gus")).toBeTruthy();
  });

  it("admits, rejects and admits everyone through the controls", async () => {
    const c = controls();
    renderPanel(c);
    fireEvent.click(screen.getByRole("button", { name: "Admit Gina" }));
    await waitFor(() => expect(c.admit).toHaveBeenCalledWith(1));
    fireEvent.click(screen.getByRole("button", { name: "Reject Gus" }));
    await waitFor(() => expect(c.reject).toHaveBeenCalledWith(2));
    fireEvent.click(screen.getByRole("button", { name: /Admit all \(2\)/ }));
    await waitFor(() => expect(c.admitAll).toHaveBeenCalled());
  });

  it("shows an empty state when nobody waits", () => {
    renderPanel(controls({ entries: [] }));
    expect(screen.getByText("No one is waiting.")).toBeTruthy();
  });

  it("toggles the waiting room and explains the off state", async () => {
    const c = controls({ enabled: false, entries: [] });
    renderPanel(c);
    expect(screen.getByText(/joins directly/)).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: "Waiting room" }));
    await waitFor(() => expect(c.setEnabled).toHaveBeenCalledWith(true));
  });

  it("reports a failed decision instead of silently doing nothing", async () => {
    const c = controls({
      admit: vi.fn().mockRejectedValue(new Error("Only the host can manage the waiting room")),
    });
    renderPanel(c);
    fireEvent.click(screen.getByRole("button", { name: "Admit Gina" }));
    expect(await screen.findByText(/Could not admit: Only the host/)).toBeTruthy();
  });
});
