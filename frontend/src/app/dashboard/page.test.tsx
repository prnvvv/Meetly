import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/common/ToastProvider";
import type { Meeting } from "@/types/meeting";
import DashboardPage from "./page";

const dashboardData = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useDashboardData", () => ({
  PREVIEW_LIMIT: 3,
  useDashboardData: dashboardData,
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: { id: "u1", name: "Priya Sharma", email: "p@example.com" } }),
}));

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

vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));

vi.mock("@clerk/nextjs", () => ({
  SignInButton: ({ children }: { children: React.ReactNode }) => children,
  SignUpButton: ({ children }: { children: React.ReactNode }) => children,
  Show: ({ when, children }: { when: string; children: React.ReactNode }) =>
    when === "signed-in" ? children : null,
  UserButton: () => null,
}));

function meetings(count: number, upcoming: boolean): Meeting[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    meeting_id: `${upcoming ? 2 : 3}0000000${i}`,
    host_id: 1,
    title: `${upcoming ? "Upcoming" : "Past"} ${i + 1}`,
    description: null,
    start_time: new Date(Date.now() + (upcoming ? 1 : -1) * (i + 1) * 3_600_000).toISOString(),
    end_time: null,
    duration: 30,
    status: upcoming ? ("scheduled" as const) : ("ended" as const),
    meeting_link: "",
    created_at: new Date().toISOString(),
  }));
}

// The real app mounts ToastProvider in the root layout.
function renderPage() {
  return render(
    <ToastProvider>
      <DashboardPage />
    </ToastProvider>
  );
}

const list = (items: Meeting[]) => ({ items, loading: false, error: null });

beforeEach(() => dashboardData.mockReset());
afterEach(cleanup);

describe("DashboardPage", () => {
  it("greets the signed-in user by first name", async () => {
    dashboardData.mockReturnValue({ upcoming: list([]), recent: list([]), refresh: vi.fn() });
    renderPage();

    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(
        /^Good (morning|afternoon|evening), Priya$/
      )
    );
  });

  it("never renders more than three rows per panel, however many meetings come back", () => {
    dashboardData.mockReturnValue({
      upcoming: list(meetings(40, true)),
      recent: list(meetings(40, false)),
      refresh: vi.fn(),
    });
    renderPage();

    const upcoming = screen.getByRole("region", { name: "Upcoming Meetings" });
    const recent = screen.getByRole("region", { name: "Recent Meetings" });
    expect(within(upcoming).getAllByRole("listitem")).toHaveLength(3);
    expect(within(recent).getAllByRole("listitem")).toHaveLength(3);
    expect(screen.queryByText("Upcoming 4")).toBeNull();
    expect(screen.queryByText("Past 4")).toBeNull();
  });

  it("fills a panel that has fewer meetings with a real shortcut row", () => {
    dashboardData.mockReturnValue({
      upcoming: list(meetings(1, true)),
      recent: list(meetings(2, false)),
      refresh: vi.fn(),
    });
    renderPage();

    expect(screen.getByRole("link", { name: "Schedule another meeting" }).getAttribute("href")).toBe(
      "/schedule"
    );
    expect(screen.getByRole("link", { name: "Start a new meeting" }).getAttribute("href")).toBe(
      "/new-meeting"
    );
  });

  it("shows designed empty states with the specified copy and actions", () => {
    dashboardData.mockReturnValue({ upcoming: list([]), recent: list([]), refresh: vi.fn() });
    renderPage();

    const upcoming = screen.getByRole("region", { name: "Upcoming Meetings" });
    expect(within(upcoming).getByRole("heading", { name: "No upcoming meetings" })).toBeTruthy();
    expect(
      within(upcoming).getByText(
        "Your schedule is clear. Create a meeting or schedule one to get started."
      )
    ).toBeTruthy();
    expect(
      within(upcoming).getByRole("link", { name: "Schedule a Meeting" }).getAttribute("href")
    ).toBe("/schedule");

    const recent = screen.getByRole("region", { name: "Recent Meetings" });
    expect(within(recent).getByRole("heading", { name: "No recent meetings" })).toBeTruthy();
    expect(
      within(recent).getByText("Your hosted and attended meetings will appear here.")
    ).toBeTruthy();
    expect(within(recent).getByRole("link", { name: "New Meeting" }).getAttribute("href")).toBe(
      "/new-meeting"
    );
  });

  it("points each View all link at the right Meetings tab", () => {
    dashboardData.mockReturnValue({ upcoming: list([]), recent: list([]), refresh: vi.fn() });
    renderPage();

    const hrefs = screen.getAllByRole("link", { name: "View all" }).map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/meetings", "/meetings?tab=recent"]);
  });

  it("shows an error state with a retry, not a blank panel, when loading fails", () => {
    dashboardData.mockReturnValue({
      upcoming: { items: [], loading: false, error: "Cannot reach the meeting service." },
      recent: list([]),
      refresh: vi.fn(),
    });
    renderPage();

    const upcoming = screen.getByRole("region", { name: "Upcoming Meetings" });
    expect(within(upcoming).getByText("Cannot reach the meeting service.")).toBeTruthy();
    expect(within(upcoming).getByRole("button", { name: /try again/i })).toBeTruthy();
  });
});
