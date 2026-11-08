import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/common/ToastProvider";
import { CalendarWorkspace } from "@/components/dashboard/CalendarWorkspace";
import type { Meeting } from "@/types/meeting";

const push = vi.fn();
const getMeetingsInRange = vi.fn();
const updateScheduledMeeting = vi.fn();
const scheduleMeeting = vi.fn();
const endMeeting = vi.fn();
const createMeeting = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/services/scheduleService", () => ({
  getMeetingsInRange: (...args: unknown[]) => getMeetingsInRange(...args),
  updateScheduledMeeting: (...args: unknown[]) => updateScheduledMeeting(...args),
  scheduleMeeting: (...args: unknown[]) => scheduleMeeting(...args),
}));
vi.mock("@/services/meetingService", () => ({
  endMeeting: (...args: unknown[]) => endMeeting(...args),
  createMeeting: (...args: unknown[]) => createMeeting(...args),
}));
vi.mock("@/services/participantService", () => ({
  getParticipants: () =>
    Promise.resolve([
      { id: 1, display_name: "Ada" },
      { id: 2, display_name: "Linus" },
      { id: 3, display_name: "Grace" },
    ]),
}));

function meeting(overrides: Partial<Meeting> = {}): Meeting {
  const start = new Date();
  start.setHours(23, 0, 0, 0);
  return {
    id: 1,
    meeting_id: "123456789",
    host_id: 1,
    title: "Design sync",
    description: null,
    start_time: start.toISOString(),
    end_time: null,
    duration: 30,
    status: "scheduled",
    meeting_link: "",
    created_at: start.toISOString(),
    ...overrides,
  };
}

function renderWorkspace() {
  return render(
    <ToastProvider>
      <CalendarWorkspace reloadKey={0} onChanged={() => undefined} />
    </ToastProvider>
  );
}

/** Click today's cell: the day dialog is where the meetings and actions live. */
async function openToday() {
  const cell = await waitFor(() => {
    const el = document.querySelector<HTMLElement>('[aria-current="date"]');
    if (!el) throw new Error("today not rendered yet");
    return el;
  });
  fireEvent.click(cell);
}

const topDialog = () => screen.getAllByRole("dialog").at(-1)!;

beforeEach(() => {
  getMeetingsInRange.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CalendarWorkspace", () => {
  it("renders a six-week grid with weekday headers and today marked", async () => {
    renderWorkspace();
    await waitFor(() => expect(getMeetingsInRange).toHaveBeenCalled());
    expect(screen.getAllByRole("gridcell")).toHaveLength(42);
    await waitFor(() =>
      expect(document.querySelector('[aria-current="date"]')).not.toBeNull()
    );
  });

  it("requests a new range when navigating months", async () => {
    renderWorkspace();
    await waitFor(() => expect(getMeetingsInRange).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    await waitFor(() => expect(getMeetingsInRange).toHaveBeenCalledTimes(2));
    const [first] = getMeetingsInRange.mock.calls[0] as [Date, Date];
    const [second] = getMeetingsInRange.mock.calls[1] as [Date, Date];
    expect(second.getTime()).toBeGreaterThan(first.getTime());
  });

  it("opens a dialog (not a side panel) when a day is clicked, and closes it again", async () => {
    renderWorkspace();
    expect(screen.queryByRole("dialog")).toBeNull();
    await openToday();
    expect(await screen.findByText("Nothing planned")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Schedule here/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("lists the selected day's meetings with time, status, participants and ID", async () => {
    getMeetingsInRange.mockResolvedValue([meeting()]);
    renderWorkspace();
    await openToday();
    expect(await screen.findByText("Design sync")).toBeTruthy();
    expect(screen.getByText("Scheduled")).toBeTruthy();
    expect(screen.getByText("ID 123456789")).toBeTruthy();
    expect(await screen.findByText("Ada, Linus +1")).toBeTruthy();
  });

  it("opens the edit dialog and saves through the PATCH service", async () => {
    getMeetingsInRange.mockResolvedValue([meeting()]);
    updateScheduledMeeting.mockResolvedValue(meeting({ title: "Renamed" }));
    renderWorkspace();
    await openToday();
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const dialog = topDialog();
    const title = within(dialog).getByLabelText("Topic");
    fireEvent.change(title, { target: { value: "Renamed" } });
    fireEvent.change(within(dialog).getByLabelText("Date"), {
      target: { value: "2099-01-01" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(updateScheduledMeeting).toHaveBeenCalled());
    const [id, payload] = updateScheduledMeeting.mock.calls[0] as [string, { title: string }];
    expect(id).toBe("123456789");
    expect(payload.title).toBe("Renamed");
  });

  it("asks for confirmation before cancelling and only then calls the API", async () => {
    getMeetingsInRange.mockResolvedValue([meeting()]);
    endMeeting.mockResolvedValue(meeting({ status: "cancelled" }));
    renderWorkspace();
    await openToday();
    fireEvent.click(await screen.findByRole("button", { name: "Cancel Design sync" }));
    expect(endMeeting).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel meeting" }));
    await waitFor(() => expect(endMeeting).toHaveBeenCalledWith("123456789"));
  });

  it("starts an instant meeting and routes into the room", async () => {
    createMeeting.mockResolvedValue(meeting({ meeting_id: "987654321", status: "active" }));
    renderWorkspace();
    await openToday();
    fireEvent.click(await screen.findByRole("button", { name: /Instant meeting/ }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/meetings/987654321"));
  });

  it("schedules from the calendar for the selected date", async () => {
    scheduleMeeting.mockResolvedValue(meeting());
    renderWorkspace();
    await openToday();
    fireEvent.click(await screen.findByRole("button", { name: /Schedule here/ }));
    const dialog = topDialog();
    fireEvent.change(within(dialog).getByLabelText("Topic"), { target: { value: "Retro" } });
    fireEvent.change(within(dialog).getByLabelText("Date"), { target: { value: "2099-01-01" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Schedule" }));
    await waitFor(() => expect(scheduleMeeting).toHaveBeenCalled());
    expect((scheduleMeeting.mock.calls[0][0] as { title: string }).title).toBe("Retro");
  });
});
