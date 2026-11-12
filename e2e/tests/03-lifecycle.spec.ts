import { expect, test, type Page } from "@playwright/test";
import { api, signedInSession, testUsers, type Session } from "../support/clerk";

const connected = (page: Page) => expect(page.getByText("Connected", { exact: true })).toBeVisible({ timeout: 60_000 });
const roster = async (host: Session, id: string) => (await api(host.page, "GET", `/api/meetings/${id}/participants`)).body as any[];

async function newMeeting(host: Session, waitingRoom: boolean): Promise<string> {
  const created = await api(host.page, "POST", "/api/meetings", { title: "E2E lifecycle" });
  expect(created.status).toBe(201);
  const id: string = created.body.meeting_id;
  if (waitingRoom) expect((await api(host.page, "PATCH", `/api/meetings/${id}/waiting-room`, { enabled: true })).status).toBe(200);
  return id;
}

test("waiting room: a rejected guest is refused and never becomes a participant", async ({ browser }) => {
  const users = testUsers();
  const host = await signedInSession(browser, users.host.id, { media: true });
  const guest = await signedInSession(browser, users.guest.id, { media: true });
  const id = await newMeeting(host, true);

  await host.page.goto(`/meetings/${id}`);
  await connected(host.page);
  await guest.page.goto(`/meetings/${id}`);
  await expect(guest.page.getByRole("heading", { name: /Waiting for the host/ })).toBeVisible({ timeout: 60_000 });

  await host.page.getByRole("toolbar", { name: "Meeting controls" }).getByRole("button", { name: "Show participants" }).click();
  await host.page.getByRole("button", { name: "Reject E2E Guest" }).click({ timeout: 30_000 });
  await expect(guest.page.getByText(/did not let you in/i)).toBeVisible({ timeout: 30_000 });

  expect(JSON.stringify(await roster(host, id))).not.toContain("E2E Guest");
  expect((await api(guest.page, "GET", `/api/meetings/${id}/participants`)).status).toBe(403);

  // Reloading does not get a rejected guest in either.
  await guest.page.reload();
  await expect(guest.page.getByRole("heading", { name: /Waiting for the host/ })).toBeHidden({ timeout: 30_000 });
  expect(JSON.stringify(await roster(host, id))).not.toContain("E2E Guest");

  await host.context.close();
  await guest.context.close();
});

test("lifecycle: join, reconnect, leave, host ends the meeting; history is recorded", async ({ browser }) => {
  const users = testUsers();
  const host = await signedInSession(browser, users.host.id, { media: true });
  const guest = await signedInSession(browser, users.guest.id, { media: true });
  const id = await newMeeting(host, false);

  await host.page.goto(`/meetings/${id}`);
  await connected(host.page);
  await guest.page.goto(`/meetings/${id}`);
  await connected(guest.page);
  await expect.poll(async () => (await roster(host, id)).length, { timeout: 30_000 }).toBe(2);

  // Joined people have a recorded join time.
  for (const p of await roster(host, id)) expect(p.joined_at).not.toBeNull();

  // Reconnect: reloading the guest tab keeps one participant row, still present.
  await guest.page.reload();
  await connected(guest.page);
  await expect
    .poll(async () => (await roster(host, id)).find((p) => p.display_name === "E2E Guest")?.left_at, { timeout: 20_000, message: "guest present again after reload" })
    .toBeNull();
  expect((await roster(host, id)).filter((p) => p.display_name === "E2E Guest")).toHaveLength(1);

  // Guest leaves: the backend records it.
  await guest.page.getByRole("button", { name: "Leave meeting" }).click();
  await expect
    .poll(async () => (await roster(host, id)).find((p) => p.display_name === "E2E Guest")?.left_at ?? null, { timeout: 30_000 })
    .not.toBeNull();

  // Host ends the meeting for everyone: backend status becomes ended, history closed.
  await host.page.getByRole("button", { name: "End meeting for everyone" }).click();
  const confirm = host.page.getByRole("button", { name: /End meeting/i }).last();
  if (await confirm.isVisible().catch(() => false)) await confirm.click().catch(() => {});
  await expect
    .poll(async () => (await api(host.page, "GET", `/api/meetings/${id}`)).body.status, { timeout: 30_000 })
    .toBe("ended");

  const recent = await api(host.page, "GET", "/api/schedules/recent");
  expect(recent.status).toBe(200);
  expect(JSON.stringify(recent.body)).toContain(id);

  // An ended meeting cannot be joined any more.
  await guest.page.goto(`/meetings/${id}`);
  await expect(guest.page.getByText(/ended/i).first()).toBeVisible({ timeout: 45_000 });

  await host.context.close();
  await guest.context.close();
});
