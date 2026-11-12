import { chromium, expect, test, type Browser, type Page } from "@playwright/test";
import { api, signedInSession, testUsers } from "../support/clerk";

test.setTimeout(600_000);

/**
 * Real browser permission states. A dedicated Chromium is launched WITHOUT `--use-fake-ui-for-media-stream`
 * and WITH `--deny-permission-prompts`, so the browser itself refuses camera/microphone (a genuine
 * NotAllowedError); `grantPermissions` then flips the real permission state. A fake capture device
 * supplies frames once access is allowed. "Device missing" and "device unplugged" are SIMULATED at the
 * API boundary (getUserMedia rejects with NotFoundError / the track fires `ended`), because a headless
 * machine cannot physically remove hardware: they prove the app's handling, not a real unplug.
 */
async function strictBrowser(): Promise<Browser> {
  return chromium.launch({
    executablePath: process.env.E2E_CHROMIUM_PATH || undefined,
    args: ["--use-fake-device-for-media-stream", "--deny-permission-prompts"],
  });
}

const CAMERA_BLOCKED = /Camera access was blocked/;
const MIC_BLOCKED = /Microphone access was blocked/;

async function openRoom(page: Page, host: Page): Promise<string> {
  const created = await api(host, "POST", "/api/meetings", { title: "E2E permissions" });
  const id: string = created.body.meeting_id;
  await page.goto(`/meetings/${id}`);
  await expect(page.getByText("Connected", { exact: true })).toBeVisible({ timeout: 60_000 });
  return id;
}

test("camera and microphone denied: clear messages, the meeting keeps working, access can be granted afterwards", async () => {
  const browser = await strictBrowser();
  try {
    const u = testUsers();
    const s = await signedInSession(browser, u.host.id, { media: false });
    const id = await openRoom(s.page, s.page);

    // Both denied by the browser.
    await s.page.getByRole("button", { name: "Join Audio" }).click();
    await expect(s.page.getByText(MIC_BLOCKED).first()).toBeVisible({ timeout: 20_000 });
    await s.page.getByRole("button", { name: "Turn camera on" }).click();
    await expect(s.page.getByText(CAMERA_BLOCKED).first()).toBeVisible({ timeout: 20_000 });
    // Not stuck, not crashed: still connected, controls still clickable, leaving works.
    await expect(s.page.getByText("Connected", { exact: true })).toBeVisible();
    await expect(s.page.getByRole("button", { name: "Join Audio" })).toBeEnabled();
    await expect(s.page.getByRole("button", { name: "Turn camera on" })).toBeEnabled();

    // Only the camera allowed: microphone message stays, camera works.
    await s.context.grantPermissions(["camera"]);
    await s.page.getByRole("button", { name: "Turn camera on" }).click();
    await expect(s.page.getByRole("button", { name: "Turn camera off" })).toBeVisible({ timeout: 20_000 });
    await expect(s.page.getByText(CAMERA_BLOCKED)).toHaveCount(0);

    // Granted after having been denied: microphone now works too.
    await s.context.grantPermissions(["camera", "microphone"]);
    await s.page.getByRole("button", { name: "Join Audio" }).click();
    await expect(s.page.getByText(MIC_BLOCKED)).toHaveCount(0, { timeout: 20_000 });
    await expect(s.page.getByRole("button", { name: /Mute microphone|Mute/ }).first()).toBeVisible({ timeout: 20_000 });

    // Leaving still works.
    await s.page.getByRole("button", { name: "Leave meeting" }).click();
    await api(s.page, "DELETE", `/api/meetings/${id}`);
  } finally {
    await browser.close();
  }
});

test("device unavailable and device unplugged during the meeting do not crash or strand the user (simulated at the API boundary)", async () => {
  const browser = await strictBrowser();
  try {
    const u = testUsers();
    const s = await signedInSession(browser, u.host.id, { media: true });
    await s.context.addInitScript(() => {
      const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      (window as any).__noCamera = false;
      navigator.mediaDevices.getUserMedia = async (c?: MediaStreamConstraints) => {
        if ((window as any).__noCamera && c && c.video) throw new DOMException("no camera", "NotFoundError");
        const stream = await real(c);
        for (const t of stream.getTracks()) (window as any).__tracks = [...((window as any).__tracks ?? []), t];
        return stream;
      };
    });
    const id = await openRoom(s.page, s.page);
    await s.page.reload();
    await expect(s.page.getByText("Connected", { exact: true })).toBeVisible({ timeout: 60_000 });

    // Device unavailable: the camera request fails with NotFoundError.
    await s.page.evaluate(() => ((window as any).__noCamera = true));
    await s.page.getByRole("button", { name: "Turn camera on" }).click();
    await expect(s.page.getByText(/No camera was found/).first()).toBeVisible({ timeout: 20_000 });
    await expect(s.page.getByText("Connected", { exact: true })).toBeVisible();

    // Camera works once it is available again.
    await s.page.evaluate(() => ((window as any).__noCamera = false));
    await s.page.getByRole("button", { name: "Turn camera on" }).click();
    await expect(s.page.getByRole("button", { name: "Turn camera off" })).toBeVisible({ timeout: 20_000 });

    // Unplugged mid-meeting: the live video track ends. The room must still work, and must not keep
    // claiming the camera is on (to this user or to the other participants).
    await s.page.evaluate(() => {
      const tracks: MediaStreamTrack[] = ((window as any).__tracks ?? []).filter((t: MediaStreamTrack) => t.kind === "video" && t.readyState === "live");
      for (const t of tracks) {
        t.stop();
        t.dispatchEvent(new Event("ended"));
      }
    });
    await expect(s.page.getByText("Connected", { exact: true })).toBeVisible();
    await expect(s.page.getByRole("button", { name: "Turn camera on" })).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(async () => ((await api(s.page, "GET", `/api/meetings/${id}/participants`)).body as any[]).filter((p) => p.left_at === null).map((p) => p.is_video_on), { timeout: 30_000 })
      .toEqual([false]);

    await api(s.page, "DELETE", `/api/meetings/${id}`);
  } finally {
    await browser.close();
  }
});
