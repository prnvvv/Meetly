import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/common/ToastProvider";
import { STORAGE_KEYS } from "@/lib/constants";
import SettingsPage from "./page";

const getCurrentUser = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
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

vi.mock("@/services/api", () => ({
  getCurrentUser,
}));

vi.mock("@clerk/nextjs", () => ({
  SignInButton: ({ children }: { children: React.ReactNode }) => children,
  SignUpButton: ({ children }: { children: React.ReactNode }) => children,
  Show: ({ when, children }: { when: string; children: React.ReactNode }) =>
    when === "signed-out" ? children : null,
  UserButton: Object.assign(() => null, { MenuItems: () => null, Link: () => null }),
  useUser: () => ({ user: null, isLoaded: true }),
}));

beforeEach(() => {
  window.sessionStorage.clear();
  getCurrentUser.mockReset();
  getCurrentUser.mockResolvedValue({
    id: 1,
    name: "Demo User",
    email: "demo@example.com",
  });
});

afterEach(cleanup);

function renderPage() {
  return render(
    <ToastProvider>
      <SettingsPage />
    </ToastProvider>
  );
}

describe("settings page", () => {
  it("renders each settings section", () => {
    renderPage();
    expect(screen.getByRole("heading", { name: "Settings", level: 1 })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Account" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Meeting display name" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Audio and video" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /About/ })).toBeTruthy();
  });

  it("starts from the display name saved earlier in the tab", () => {
    window.sessionStorage.setItem(STORAGE_KEYS.displayName, "Priya");
    renderPage();
    expect(
      (screen.getByLabelText("Display name") as HTMLInputElement).value
    ).toBe("Priya");
  });

  it("persists the display name when the form is submitted", () => {
    renderPage();
    const input = screen.getByLabelText("Display name");

    fireEvent.change(input, { target: { value: "  Priya  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save display name" }));

    expect(window.sessionStorage.getItem(STORAGE_KEYS.displayName)).toBe("Priya");
    expect(screen.getByText("Display name saved")).toBeTruthy();
  });

  it("refuses an empty display name with an accessible error", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Save display name" }));

    const error = screen.getByText(
      "Enter the name other participants will see."
    );
    expect(error).toBeTruthy();
    expect(screen.getByLabelText("Display name").getAttribute("aria-invalid")).toBe(
      "true"
    );
    expect(window.sessionStorage.getItem(STORAGE_KEYS.displayName)).toBeNull();
  });

  it("rejects a display name longer than the backend allows", () => {
    renderPage();
    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "x".repeat(101) },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save display name" }));

    expect(
      screen.getByText("Keep your name under 100 characters.")
    ).toBeTruthy();
    expect(window.sessionStorage.getItem(STORAGE_KEYS.displayName)).toBeNull();
  });

  it("shows who the demo user is", () => {
    renderPage();
    expect(screen.getByText("Demo User")).toBeTruthy();
    expect(screen.getByText(/Using the demo account/)).toBeTruthy();
    expect(screen.getByText("demo@example.com")).toBeTruthy();
  });

  it("explains that no camera or microphone is available yet", () => {
    renderPage();
    expect(
      screen.getByText(/No devices detected yet/)
    ).toBeTruthy();
  });
});
