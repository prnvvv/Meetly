import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/common/ToastProvider";
import type { Profile } from "@/types/profile";
import { ProfilePage } from "./ProfilePage";

const svc = vi.hoisted(() => ({
  getMyProfile: vi.fn(),
  updateMyProfile: vi.fn(),
  uploadMyAvatar: vi.fn(),
  removeMyAvatar: vi.fn(),
  checkUsername: vi.fn(),
}));

vi.mock("@/services/profileService", () => svc);
vi.mock("next/navigation", () => ({
  usePathname: () => "/profile",
  useRouter: () => ({ push: () => undefined, replace: () => undefined, prefetch: () => undefined }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@clerk/nextjs", () => ({
  SignInButton: ({ children }: { children: React.ReactNode }) => children,
  SignUpButton: ({ children }: { children: React.ReactNode }) => children,
  Show: () => null,
  UserButton: Object.assign(() => null, { MenuItems: () => null, Link: () => null }),
  useAuth: () => ({ isSignedIn: false }),
  useUser: () => ({ user: null, isLoaded: true }),
}));

function profile(over: Partial<Profile> = {}): Profile {
  return {
    user_id: 1,
    username: "ada",
    display_name: "Ada Lovelace",
    avatar_url: null,
    limited: false,
    is_self: true,
    bio: "Analyst",
    location: null,
    designation: null,
    organization: null,
    website: null,
    social_links: {},
    created_at: "2026-01-02T00:00:00Z",
    stats: { meetings_hosted: 3, meetings_attended: 5, minutes_hosted: 125 },
    visibility: "public",
    show_meeting_stats: false,
    updated_at: null,
    ...over,
  };
}

function renderPage() {
  return render(
    <ToastProvider>
      <ProfilePage />
    </ToastProvider>
  );
}

describe("ProfilePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    svc.getMyProfile.mockResolvedValue(profile());
  });
  afterEach(cleanup);

  it("loads the profile from the API and shows stats", async () => {
    renderPage();
    expect(await screen.findByDisplayValue("Ada Lovelace")).toBeTruthy();
    expect(screen.getByText("@ada")).toBeTruthy();
    expect(screen.getByText("2h 5m")).toBeTruthy();
  });

  it("shows an error state with retry when loading fails", async () => {
    svc.getMyProfile.mockRejectedValueOnce(new Error("boom"));
    renderPage();
    expect(await screen.findByText("Could not load your profile")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByDisplayValue("Ada Lovelace")).toBeTruthy();
  });

  it("saves only after an edit and sends trimmed values", async () => {
    svc.updateMyProfile.mockResolvedValue(profile({ bio: "New bio" }));
    renderPage();
    const save = await screen.findByRole("button", { name: "Save changes" });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Bio"), { target: { value: "  New bio  " } });
    expect((save as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(svc.updateMyProfile).toHaveBeenCalledTimes(1));
    expect(svc.updateMyProfile.mock.calls[0][0]).toMatchObject({ bio: "New bio", username: "ada" });
  });

  it("blocks an invalid username without calling the API", async () => {
    renderPage();
    const input = await screen.findByLabelText("Username");
    fireEvent.change(input, { target: { value: "1bad name" } });
    expect(await screen.findByText(/3-30 letters/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(svc.updateMyProfile).not.toHaveBeenCalled();
    expect(svc.checkUsername).not.toHaveBeenCalled();
  });

  it("surfaces a taken username reported by the server", async () => {
    svc.checkUsername.mockResolvedValue({ username: "grace", available: false, reason: "That username is taken" });
    renderPage();
    fireEvent.change(await screen.findByLabelText("Username"), { target: { value: "grace" } });
    expect(await screen.findByText("That username is taken")).toBeTruthy();
  });

  it("changes visibility through the backend", async () => {
    svc.updateMyProfile.mockResolvedValue(profile({ visibility: "private" }));
    renderPage();
    fireEvent.change(await screen.findByLabelText("Who can see your profile"), { target: { value: "private" } });
    await waitFor(() => expect(svc.updateMyProfile).toHaveBeenCalledWith({ visibility: "private" }));
  });

  it("rejects non-image files before uploading", async () => {
    renderPage();
    await screen.findByDisplayValue("Ada Lovelace");
    const input = screen.getByLabelText("Upload profile photo") as HTMLInputElement;
    const file = new File(["x"], "evil.svg", { type: "image/svg+xml" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(await screen.findByText("Use a PNG, JPEG or WebP image.")).toBeTruthy();
    expect(svc.uploadMyAvatar).not.toHaveBeenCalled();
  });
});
