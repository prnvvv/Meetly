import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { api, signedInSession, testUsers } from "../support/clerk";

/**
 * Responsive audit at 360 / 768 / 1280 px. For every page it records:
 *  - horizontal overflow of the document (a failure),
 *  - elements that stick out of the viewport horizontally (reported),
 *  - a screenshot under e2e/screens/<width>/ (git-ignored) for visual review.
 * Nothing here changes the app: it only measures.
 */
const WIDTHS = [
  { name: "mobile", width: 360, height: 740 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 800 },
];
const OUT = path.resolve(__dirname, "..", "screens");
const report: string[] = [];

async function audit(page: Page, label: string, width: number, height: number) {
  await page.waitForTimeout(700);
  const result = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const docOverflow = document.documentElement.scrollWidth - vw;
    const offenders: string[] = [];
    document.querySelectorAll<HTMLElement>("body *").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      const cs = getComputedStyle(el);
      if (cs.position === "fixed" && r.right <= vw + 1 && r.left >= -1) return;
      if (r.right > vw + 1 || r.left < -1) {
        // Skip anything inside a horizontally scrollable or clipped ancestor (carousels, marquees).
        let p: HTMLElement | null = el.parentElement;
        while (p && p !== document.body) {
          const o = getComputedStyle(p);
          if (/(auto|scroll|hidden|clip)/.test(o.overflowX)) return;
          p = p.parentElement;
        }
        const id = el.id ? `#${el.id}` : "";
        const cls = typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : "";
        offenders.push(`${el.tagName.toLowerCase()}${id}${cls} [${Math.round(r.left)}..${Math.round(r.right)}]`);
      }
    });
    return { docOverflow, offenders: offenders.slice(0, 6) };
  });
  fs.mkdirSync(path.join(OUT, String(width)), { recursive: true });
  await page.screenshot({ path: path.join(OUT, String(width), `${label}.png`), fullPage: false });
  const bad = result.docOverflow > 1;
  report.push(`${bad ? "FAIL" : "ok  "} ${width}px ${label}: docOverflow=${result.docOverflow}${result.offenders.length ? " offenders: " + result.offenders.join(" | ") : ""}`);
  return result;
}

for (const vp of WIDTHS) {
  test(`responsive ${vp.name} ${vp.width}px: no horizontal page overflow on any page`, async ({ browser }) => {
    test.setTimeout(240_000);
    const users = testUsers();
    const failures: string[] = [];
    const check = async (page: Page, label: string) => {
      const r = await audit(page, label, vp.width, vp.height);
      if (r.docOverflow > 1) failures.push(`${label}: page scrolls sideways by ${r.docOverflow}px`);
    };

    // Signed-out pages.
    const anon = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const ap = await anon.newPage();
    for (const [label, url] of [["landing", "/"], ["sign-in", "/sign-in"], ["sign-up", "/sign-up"]] as const) {
      await ap.goto(url);
      await ap.waitForLoadState("networkidle").catch(() => {});
      await check(ap, label);
    }
    await anon.close();

    // Signed-in pages.
    const host = await signedInSession(browser, users.host.id, { media: true });
    const guest = await signedInSession(browser, users.guest.id, { media: true });
    for (const s of [host, guest]) await s.page.setViewportSize({ width: vp.width, height: vp.height });
    const hp = host.page;
    for (const [label, url] of [
      ["dashboard", "/dashboard"],
      ["new-meeting", "/new-meeting"],
      ["schedule", "/schedule"],
      ["join", "/join"],
      ["profile", "/profile"],
      ["settings", "/settings"],
    ] as const) {
      await hp.goto(url);
      await hp.waitForLoadState("networkidle").catch(() => {});
      await check(hp, label);
    }

    // Overlays: Friends drawer and the notification panel.
    await hp.goto("/dashboard");
    await hp.getByRole("button", { name: "Friends", exact: true }).click().catch(() => {});
    await check(hp, "friends-drawer");
    await hp.keyboard.press("Escape");
    await hp.getByRole("button", { name: /^Notifications/ }).click().catch(() => {});
    await check(hp, "notifications-panel");
    await hp.keyboard.press("Escape");

    // Meeting: waiting room (guest) and the live room (host).
    const created = await api(hp, "POST", "/api/meetings", { title: "E2E responsive" });
    const id: string = created.body.meeting_id;
    await api(hp, "PATCH", `/api/meetings/${id}/waiting-room`, { enabled: true });
    await hp.goto(`/meetings/${id}`);
    await expect(hp.getByText("Connected", { exact: true })).toBeVisible({ timeout: 60_000 });
    await check(hp, "room-host-alone");
    await guest.page.goto(`/meetings/${id}`);
    await expect(guest.page.getByRole("heading", { name: /Waiting for the host/ })).toBeVisible({ timeout: 60_000 });
    await check(guest.page, "waiting-room");
    await hp.getByRole("toolbar", { name: "Meeting controls" }).getByRole("button", { name: "Show participants" }).click().catch(() => {});
    await hp.getByRole("button", { name: "Admit E2E Guest" }).click({ timeout: 30_000 }).catch(() => {});
    await expect(guest.page.getByText("Connected", { exact: true })).toBeVisible({ timeout: 60_000 });
    for (const s of [host, guest]) {
      await s.page.getByRole("button", { name: "Join Audio" }).click().catch(() => {});
      await s.page.getByRole("button", { name: "Turn camera on" }).click().catch(() => {});
    }
    await hp.waitForTimeout(3000);
    await check(hp, "room-two-participants-panel");
    await check(guest.page, "room-guest");

    await api(hp, "DELETE", `/api/meetings/${id}`);
    fs.writeFileSync(path.join(OUT, `report-${vp.width}.txt`), report.join("\n"));
    expect(failures, failures.join("\n")).toEqual([]);
  });
}
