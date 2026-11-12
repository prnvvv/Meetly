import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/common/ToastProvider";
import { AppShell } from "./AppShell";

const renderShell = () =>
  render(
    <ToastProvider>
      <AppShell>content</AppShell>
    </ToastProvider>
  );

vi.mock("next/navigation", () => ({
  usePathname: () => "/schedule",
  useRouter: () => ({ push: () => undefined, replace: () => undefined, prefetch: () => undefined }),
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

vi.mock("@clerk/nextjs", () => ({
  SignInButton: ({ children }: { children: React.ReactNode }) => children,
  SignUpButton: ({ children }: { children: React.ReactNode }) => children,
  Show: ({ when, children }: { when: string; children: React.ReactNode }) =>
    when === "signed-in" ? children : null,
  UserButton: Object.assign(() => <span data-testid="user-button" />, {
    MenuItems: () => null,
    Link: () => null,
  }),
  useAuth: () => ({ isSignedIn: true }),
}));

vi.mock("@/services/socialService", () => ({
  listNotifications: vi.fn().mockResolvedValue({ items: [], unread_count: 0, next_before_id: null }),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
  listFriendsPage: vi.fn().mockResolvedValue({ items: [], has_more: false }),
  incomingRequests: vi.fn().mockResolvedValue([]),
  outgoingRequests: vi.fn().mockResolvedValue([]),
  listBlocked: vi.fn().mockResolvedValue({ items: [], has_more: false }),
}));

afterEach(cleanup);

describe("AppShell top navigation", () => {
  it("shows the primary links and marks the current page", () => {
    renderShell();
    const primary = screen.getByRole("navigation", { name: "Primary" });

    for (const label of ["Home", "Schedule", "Join"]) {
      expect(within(primary).getByRole("link", { name: label })).toBeTruthy();
    }
    expect(
      within(primary).getByRole("link", { name: "Schedule" }).getAttribute("aria-current")
    ).toBe("page");
    expect(
      within(primary).getByRole("link", { name: "Home" }).getAttribute("aria-current")
    ).toBeNull();
  });

  it("offers a New meeting action and the signed-in controls", () => {
    renderShell();

    const cta = screen
      .getAllByRole("link", { name: /New Meeting/ })
      .find((a) => a.getAttribute("href") === "/new-meeting");
    expect(cta).toBeTruthy();
    // one icon link in the bar and one in the mobile menu panel
    const settings = screen.getAllByRole("link", { name: "Settings" });
    expect(settings.length).toBe(2);
    expect(settings.every((a) => a.getAttribute("href") === "/settings")).toBe(true);
    expect(screen.getByTestId("user-button")).toBeTruthy();
  });

  it("has no dead buttons: Help is gone, Friends and Notifications open real panels", async () => {
    renderShell();

    expect(screen.queryByRole("button", { name: "Help" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    expect(await screen.findByText("You are all caught up.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Friends" }));
    expect(await screen.findByRole("dialog", { name: "Friends" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Find people" })).toBeTruthy();
  });

  it("toggles the mobile menu and reports its state to assistive tech", () => {
    renderShell();
    const toggle = screen.getByRole("button", { name: "Open navigation menu" });

    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);

    const opened = screen.getByRole("button", { name: "Close navigation menu" });
    expect(opened.getAttribute("aria-expanded")).toBe("true");
    expect(
      screen.getByRole("navigation", { name: "Menu" }).querySelectorAll("a").length
    ).toBe(4);
  });
});
