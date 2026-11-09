import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/common/ToastProvider";
import { ScheduleForm } from "@/components/dashboard/ScheduleForm";
import { scheduleMeeting } from "@/services/scheduleService";

const push = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push }),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/services/scheduleService", () => ({
  scheduleMeeting: vi.fn(),
}));

beforeEach(() => push.mockReset());
afterEach(cleanup);

function renderForm() {
  return render(
    <ToastProvider>
      <ScheduleForm />
    </ToastProvider>
  );
}

function submit() {
  fireEvent.click(screen.getByRole("button", { name: /Schedule Meeting/ }));
}

describe("ScheduleForm", () => {
  it("schedules an untitled meeting under a default name", async () => {
    vi.mocked(scheduleMeeting).mockClear();
    vi.mocked(scheduleMeeting).mockResolvedValue({ meeting_id: "839452761" } as never);
    renderForm();
    submit();

    await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard"));
    expect(vi.mocked(scheduleMeeting)).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Scheduled Meeting" })
    );
  });

  it("posts the schedule and returns to the dashboard", async () => {
    vi.mocked(scheduleMeeting).mockResolvedValue({ meeting_id: "839452761" } as never);
    renderForm();

    fireEvent.change(screen.getByLabelText(/^Meeting topic/), {
      target: { value: "Sprint retro" },
    });
    submit();

    await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard"));
    expect(vi.mocked(scheduleMeeting)).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Sprint retro",
        duration: 30,
        start_time: expect.any(String),
      })
    );
  });

  it("surfaces API failures without navigating", async () => {
    vi.mocked(scheduleMeeting).mockRejectedValueOnce(
      new Error("That action conflicts with the current meeting state.")
    );
    renderForm();

    fireEvent.change(screen.getByLabelText(/^Meeting topic/), {
      target: { value: "Sprint retro" },
    });
    submit();

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });

  it("sends the optional password and the chosen duration preset", async () => {
    vi.mocked(scheduleMeeting).mockResolvedValue({ meeting_id: "839452761" } as never);
    renderForm();

    fireEvent.change(screen.getByLabelText(/^Meeting topic/), { target: { value: "Review" } });
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: "secret123" } });
    fireEvent.click(screen.getByRole("radio", { name: "90 min" }));
    submit();

    await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard"));
    expect(vi.mocked(scheduleMeeting)).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Review", duration: 90, password: "secret123" })
    );
  });

  it("creates one meeting per occurrence when repeating", async () => {
    vi.mocked(scheduleMeeting).mockClear();
    vi.mocked(scheduleMeeting).mockResolvedValue({ meeting_id: "839452761" } as never);
    renderForm();

    fireEvent.change(screen.getByLabelText(/^Meeting topic/), { target: { value: "Standup" } });
    fireEvent.change(screen.getByLabelText("Repeat"), { target: { value: "weekly" } });
    fireEvent.change(screen.getByLabelText("Times"), { target: { value: "3" } });
    submit();

    await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard"));
    const calls = vi.mocked(scheduleMeeting).mock.calls.map(([payload]) => new Date(payload.start_time).getTime());
    expect(calls).toHaveLength(3);
    expect(calls[1] - calls[0]).toBeGreaterThanOrEqual(6 * 24 * 3600 * 1000);
  });

  it("rejects a start time in the past", async () => {
    vi.mocked(scheduleMeeting).mockClear();
    renderForm();

    fireEvent.change(screen.getByLabelText(/^Meeting topic/), { target: { value: "Old" } });
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2020-01-01" } });
    submit();

    expect(await screen.findByText("Pick a start time in the future.")).toBeTruthy();
    expect(vi.mocked(scheduleMeeting)).not.toHaveBeenCalled();
  });
});
