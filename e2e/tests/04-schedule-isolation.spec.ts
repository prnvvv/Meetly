import { expect, test } from "@playwright/test";
import { api, signedInSession, testUsers } from "../support/clerk";

const TITLE = "E2E weekly sync";

test("scheduling through the UI stores the right UTC time, repeats, password and can be edited and cancelled", async ({ browser }) => {
  const users = testUsers();
  const host = await signedInSession(browser, users.host.id);
  const guest = await signedInSession(browser, users.guest.id);
  const { page } = host;
  // Clear leftovers of an interrupted earlier run so the counts below are exact.
  for (const old of ((await api(page, "GET", "/api/schedules/upcoming")).body as any[]).filter((m) => m.title.startsWith(TITLE))) {
    await api(page, "DELETE", `/api/meetings/${old.meeting_id}`);
  }

  await page.goto("/schedule");
  await page.locator("#schedule-title").fill(TITLE);
  await page.locator("#schedule-description").fill("created by the e2e suite");
  await page.locator("#schedule-date").fill("2027-03-10");
  await page.locator("#schedule-time").fill("10:00");
  await page.locator("#schedule-timezone").selectOption("Asia/Kolkata");
  await page.getByRole("radio", { name: "45 min" }).click();
  await page.locator("#schedule-password").fill("s3cret-pass");
  await page.locator("#schedule-repeat").selectOption("weekly");
  await page.locator("#schedule-occurrences").selectOption("3");
  await page.getByRole("button", { name: /^Schedule/ }).last().click();

  await expect
    .poll(async () => ((await api(page, "GET", "/api/schedules/upcoming")).body as any[]).filter((m) => m.title === TITLE).length, { timeout: 45_000 })
    .toBe(3);

  const mine = ((await api(page, "GET", "/api/schedules/upcoming")).body as any[])
    .filter((m) => m.title === TITLE)
    .sort((a, b) => a.start_time.localeCompare(b.start_time));
  // 10:00 in Asia/Kolkata (UTC+5:30) is 04:30Z; weekly repeats keep the wall-clock time.
  expect(mine.map((m) => m.start_time.slice(0, 19))).toEqual(["2027-03-10T04:30:00", "2027-03-17T04:30:00", "2027-03-24T04:30:00"]);
  expect(mine.every((m) => m.status === "scheduled" && m.duration === 45)).toBe(true);
  expect(new Set(mine.map((m) => m.meeting_id)).size).toBe(3); // unique ids
  expect(JSON.stringify(mine)).not.toContain("s3cret-pass"); // never returned in clear
  expect(JSON.stringify(mine)).not.toContain("password_hash");

  // A scheduled meeting cannot be joined before it starts (409), whatever the password.
  const first = mine[0].meeting_id;
  expect((await api(guest.page, "POST", `/api/meetings/${first}/join`, { display_name: "E2E Guest", password: "s3cret-pass" })).status).toBe(409);

  // Passwords are enforced by the backend (stored hashed): wrong -> refused, right -> allowed.
  const locked = await api(page, "POST", "/api/meetings", { title: "E2E locked", password: "open-sesame" });
  expect(locked.status).toBe(201);
  expect(JSON.stringify(locked.body)).not.toContain("open-sesame");
  const lockedId = locked.body.meeting_id;
  const wrong = await api(guest.page, "POST", `/api/meetings/${lockedId}/join`, { display_name: "E2E Guest", password: "nope" });
  expect([401, 403]).toContain(wrong.status);
  const missingPw = await api(guest.page, "POST", `/api/meetings/${lockedId}/join`, { display_name: "E2E Guest" });
  expect([401, 403]).toContain(missingPw.status);
  const right = await api(guest.page, "POST", `/api/meetings/${lockedId}/join`, { display_name: "E2E Guest", password: "open-sesame" });
  expect(right.status).toBeLessThan(300);
  await api(page, "DELETE", `/api/meetings/${lockedId}`);

  // Isolation: the other account does not see these in its own schedule, and cannot change them.
  const theirs = (await api(guest.page, "GET", "/api/schedules/upcoming")).body as any[];
  expect(theirs.filter((m) => m.title === TITLE)).toHaveLength(0);
  expect((await api(guest.page, "PATCH", `/api/schedules/${first}`, { title: "hijacked" })).status).toBeGreaterThanOrEqual(400);
  expect((await api(guest.page, "DELETE", `/api/meetings/${first}`)).status).toBeGreaterThanOrEqual(400);
  expect((await api(guest.page, "PATCH", `/api/meetings/${first}/waiting-room`, { enabled: true })).status).toBe(403);

  // Edit (host): new title persists.
  const edit = await api(page, "PATCH", `/api/schedules/${first}`, { title: `${TITLE} (edited)` });
  expect(edit.status).toBe(200);
  expect((await api(page, "GET", `/api/meetings/${first}`)).body.title).toBe(`${TITLE} (edited)`);

  // Cancel (host): status becomes cancelled and it leaves the upcoming list; cancelled meetings cannot be joined.
  for (const m of mine) expect((await api(page, "DELETE", `/api/meetings/${m.meeting_id}`)).status).toBeLessThan(300);
  expect((await api(page, "GET", `/api/meetings/${first}`)).body.status).toBe("cancelled");
  const ids = new Set(mine.map((m) => m.meeting_id));
  const after = ((await api(page, "GET", "/api/schedules/upcoming")).body as any[]).filter((m) => ids.has(m.meeting_id));
  expect(after).toHaveLength(0);
  const joinCancelled = await api(guest.page, "POST", `/api/meetings/${first}/join`, { display_name: "E2E Guest", password: "s3cret-pass" });
  expect(joinCancelled.status).toBeGreaterThanOrEqual(400);

  await host.context.close();
  await guest.context.close();
});

test("invalid ids and unauthenticated access are refused with clear errors", async ({ browser }) => {
  const guest = await signedInSession(browser, testUsers().guest.id);
  const bad = await api(guest.page, "GET", "/api/meetings/not-a-real-id");
  expect([400, 404, 422]).toContain(bad.status);
  const missing = await api(guest.page, "GET", "/api/meetings/999999999");
  expect(missing.status).toBe(404);
  expect((await fetch("http://localhost:8000/api/schedules/upcoming")).status).toBe(401);
  await guest.page.goto("/meetings/999999999");
  await expect(guest.page.getByText(/not found|could not find|doesn.t exist/i).first()).toBeVisible({ timeout: 45_000 });
  await guest.context.close();
});
