import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/common/ToastProvider";
import { JoinForm } from "@/components/dashboard/JoinForm";
import { joinMeeting } from "@/services/meetingService";

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

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: null, loading: false, failed: false }),
}));

vi.mock("@/services/meetingService", () => ({
  joinMeeting: vi.fn(),
}));

beforeEach(() => push.mockReset());
afterEach(cleanup);

function renderForm() {
  return render(
    <ToastProvider>
      <JoinForm />
    </ToastProvider>
  );
}

function fill(displayName: string, meetingId: string) {
  fireEvent.change(screen.getByLabelText("Meeting code or invite link"), {
    target: { value: meetingId },
  });
  fireEvent.change(screen.getByLabelText(/Your name/), {
    target: { value: displayName },
  });
}

describe("JoinForm", () => {
  it("blocks submission without a meeting ID", async () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: /Join Meeting/ }));

    expect(
      await screen.findByText("Enter a meeting ID or invite link.")
    ).toBeTruthy();
    expect(vi.mocked(joinMeeting)).not.toHaveBeenCalled();
  });

  it("joins with a raw meeting ID and remembers the display name", async () => {
    vi.mocked(joinMeeting).mockResolvedValue(undefined as never);
    renderForm();

    fill("Priya", "839452761");
    fireEvent.click(screen.getByRole("button", { name: /Join Meeting/ }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/meetings/839452761"));
    expect(vi.mocked(joinMeeting)).toHaveBeenCalledWith("839452761", {
      display_name: "Priya",
    });
    expect(window.sessionStorage.getItem("scalarmeet.display_name")).toBe(
      "Priya"
    );
  });

  it("extracts the meeting ID from a pasted invite link", async () => {
    vi.mocked(joinMeeting).mockResolvedValue(undefined as never);
    renderForm();

    fill("Ann", "https://scalar.app/meetings/810288678?pwd=secret");
    fireEvent.click(screen.getByRole("button", { name: /Join Meeting/ }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/meetings/810288678"));
    expect(vi.mocked(joinMeeting)).toHaveBeenCalledWith("810288678", {
      display_name: "Ann",
    });
  });
});
