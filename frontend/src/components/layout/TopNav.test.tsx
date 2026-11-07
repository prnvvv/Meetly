import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";

vi.mock("next/navigation", () => ({
  usePathname: () => "/meetings",
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
  UserButton: () => <span data-testid="user-button" />,
}));

afterEach(cleanup);

describe("AppShell top navigation", () => {
  it("shows the primary links and marks the current page", () => {
    render(<AppShell>content</AppShell>);
    const primary = screen.getByRole("navigation", { name: "Primary" });

    for (const label of ["Home", "Meetings", "Schedule", "Join"]) {
      expect(within(primary).getByRole("link", { name: label })).toBeTruthy();
    }
    expect(
      within(primary).getByRole("link", { name: "Meetings" }).getAttribute("aria-current")
    ).toBe("page");
    expect(
      within(primary).getByRole("link", { name: "Home" }).getAttribute("aria-current")
    ).toBeNull();
  });

  it("offers a New meeting action and the signed-in controls", () => {
    render(<AppShell>content</AppShell>);

    const cta = screen
      .getAllByRole("link", { name: /New meeting/ })
      .find((a) => a.getAttribute("href") === "/new-meeting");
    expect(cta).toBeTruthy();
    // one icon link in the bar and one in the mobile menu panel
    const settings = screen.getAllByRole("link", { name: "Settings" });
    expect(settings.length).toBe(2);
    expect(settings.every((a) => a.getAttribute("href") === "/settings")).toBe(true);
    expect(screen.getByTestId("user-button")).toBeTruthy();
  });

  it("has no buttons that lead nowhere (the old Help and Notifications icons)", () => {
    render(<AppShell>content</AppShell>);

    expect(screen.queryByRole("button", { name: "Help" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Notifications" })).toBeNull();
  });

  it("toggles the mobile menu and reports its state to assistive tech", () => {
    render(<AppShell>content</AppShell>);
    const toggle = screen.getByRole("button", { name: "Open navigation menu" });

    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);

    const opened = screen.getByRole("button", { name: "Close navigation menu" });
    expect(opened.getAttribute("aria-expanded")).toBe("true");
    expect(
      screen.getByRole("navigation", { name: "Menu" }).querySelectorAll("a").length
    ).toBe(5);
  });
});
