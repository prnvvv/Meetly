import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/common/ToastProvider";
import { ScheduleForm } from "@/components/dashboard/ScheduleForm";
import { scheduleMeeting } from "@/services/scheduleService";

const push = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    useRouter: () => ({ push }),
  };
});

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
  it("blocks submission when the topic is empty", async () => {
    renderForm();
    submit();

    expect(
      await screen.findByText("Give your meeting a title.")
    ).toBeTruthy();
    expect(vi.mocked(scheduleMeeting)).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("posts the schedule and navigates to the meetings list", async () => {
    vi.mocked(scheduleMeeting).mockResolvedValue(undefined as never);
    renderForm();

    fireEvent.change(screen.getByLabelText("Topic"), {
      target: { value: "Sprint retro" },
    });
    submit();

    await waitFor(() => expect(push).toHaveBeenCalledWith("/meetings"));
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

    fireEvent.change(screen.getByLabelText("Topic"), {
      target: { value: "Sprint retro" },
    });
    submit();

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });
});
