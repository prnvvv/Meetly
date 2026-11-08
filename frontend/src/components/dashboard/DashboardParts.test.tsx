import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/common/ToastProvider";
import type { Meeting } from "@/types/meeting";
import { ActionTiles } from "./ActionTiles";
import { MeetingPanel } from "./MeetingPanel";
import { AddRow, RecentRow, UpcomingRow } from "./MeetingRows";
import { PanelEmptyState } from "./PanelEmptyState";

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

afterEach(cleanup);

function meeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: 1,
    meeting_id: "123456789",
    host_id: 1,
    title: "Design review",
    description: null,
    start_time: new Date().toISOString(),
    end_time: null,
    duration: 30,
    status: "scheduled",
    meeting_link: "",
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function renderRow(node: React.ReactNode) {
  return render(
    <ToastProvider>
      <ul>{node}</ul>
    </ToastProvider>
  );
}

describe("ActionTiles", () => {
  it("renders three fully clickable cards that open the real workflows", () => {
    render(<ActionTiles />);
    const links = screen.getAllByRole("link");

    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      "/new-meeting",
      "/join",
      "/schedule",
    ]);
    expect(links.map((l) => l.textContent)).toEqual([
      expect.stringContaining("New Meeting"),
      expect.stringContaining("Join Meeting"),
      expect.stringContaining("Schedule Meeting"),
    ]);
    expect(screen.getByText("Start an instant meeting")).toBeTruthy();
    expect(screen.getByText("Enter a meeting ID")).toBeTruthy();
    expect(screen.getByText("Plan it for later")).toBeTruthy();
  });
});

describe("MeetingPanel", () => {
  it("has a titled heading and a View all link", () => {
    render(
      <MeetingPanel title="Upcoming Meetings" id="upcoming" viewAllHref="/meetings">
        <p>body</p>
      </MeetingPanel>
    );
    const region = screen.getByRole("region", { name: "Upcoming Meetings" });
    expect(within(region).getByRole("link", { name: "View all" }).getAttribute("href")).toBe(
      "/meetings"
    );
    expect(within(region).getByText("body")).toBeTruthy();
  });
});

describe("UpcomingRow", () => {
  it("shows the real title and time, joins the real meeting and has an overflow menu", () => {
    const start = new Date();
    start.setHours(start.getHours() + 1);
    renderRow(<UpcomingRow meeting={meeting({ start_time: start.toISOString(), duration: 30 })} />);

    expect(screen.getByText("Design review")).toBeTruthy();
    expect(screen.getByText(/^(Today|Tomorrow), .+ – .+/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Join Design review" }).getAttribute("href")).toBe(
      "/meetings/123456789"
    );
    expect(screen.getByRole("button", { name: "More options for Design review" })).toBeTruthy();
  });
});

describe("RecentRow", () => {
  it("labels yesterday with its duration and links the whole row to the meeting", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(12, 0, 0, 0);
    renderRow(
      <RecentRow meeting={meeting({ start_time: yesterday.toISOString(), duration: 45, status: "ended" })} />
    );

    expect(screen.getByText("Yesterday, 45 min")).toBeTruthy();
    const link = screen.getByRole("link", { name: "Open Design review" });
    expect(link.getAttribute("href")).toBe("/meetings/123456789");
  });

  it("omits the duration when the meeting has none", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(12, 0, 0, 0);
    renderRow(<RecentRow meeting={meeting({ start_time: yesterday.toISOString(), duration: null })} />);
    expect(screen.getByText("Yesterday")).toBeTruthy();
  });
});

describe("AddRow", () => {
  it("is a real shortcut link that fills an unused slot", () => {
    renderRow(<AddRow href="/schedule" label="Schedule another meeting" />);
    expect(
      screen.getByRole("link", { name: "Schedule another meeting" }).getAttribute("href")
    ).toBe("/schedule");
  });
});

describe("PanelEmptyState", () => {
  it("shows an illustration, a heading, an explanation and an action", () => {
    render(
      <PanelEmptyState
        illustration="/images/empty-upcoming.svg"
        title="No upcoming meetings"
        description="Your schedule is clear. Create a meeting or schedule one to get started."
        actionHref="/schedule"
        actionLabel="Schedule a Meeting"
      />
    );

    expect(screen.getByRole("heading", { name: "No upcoming meetings" })).toBeTruthy();
    expect(screen.getByText(/Your schedule is clear/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Schedule a Meeting" }).getAttribute("href")).toBe(
      "/schedule"
    );
    expect(document.querySelector("img")?.getAttribute("src")).toBe("/images/empty-upcoming.svg");
  });
});
