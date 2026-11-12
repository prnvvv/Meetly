import { expect, test, type Page } from "@playwright/test";
import { api, signedInSession, testUsers } from "../support/clerk";

test.setTimeout(600_000);

const connected = (page: Page) => expect(page.getByText("Connected", { exact: true })).toBeVisible({ timeout: 60_000 });
const roster = async (page: Page, id: string) => (await api(page, "GET", `/api/meetings/${id}/participants`)).body as any[];

test("host controls through the real UI; a guest cannot use them, even over a raw socket", async ({ browser }) => {
  const u = testUsers();
  const host = await signedInSession(browser, u.host.id, { media: true });
  const guest = await signedInSession(browser, u.guest.id, { media: true });
  const created = await api(host.page, "POST", "/api/meetings", { title: "E2E host controls" });
  const id: string = created.body.meeting_id;

  await host.page.goto(`/meetings/${id}`);
  await connected(host.page);
  await guest.page.goto(`/meetings/${id}`);
  await connected(guest.page);

  await expect.poll(async () => (await roster(host.page, id)).filter((p) => p.left_at === null).length, { timeout: 30_000 }).toBe(2);
  const rows = await roster(host.page, id);
  const hostRow = rows.find((p) => p.display_name === "E2E Host") ?? rows.find((p) => p.is_host);
  const guestRow = rows.find((p) => p.display_name === "E2E Guest");
  expect(hostRow?.is_host).toBe(true);
  expect(guestRow?.is_host).toBe(false);

  // Participant list shows both people on both screens.
  for (const s of [host, guest]) {
    await s.page.getByRole("toolbar", { name: "Meeting controls" }).getByRole("button", { name: "Show participants" }).click();
    await expect(s.page.getByText("E2E Guest").first()).toBeVisible({ timeout: 20_000 });
  }

  // Guest unmutes, camera on; the roster (what everybody syncs from) follows.
  await guest.page.getByRole("button", { name: "Join Audio" }).click();
  await guest.page.getByRole("button", { name: "Turn camera on" }).click();
  await expect.poll(async () => (await roster(host.page, id)).find((p) => p.id === guestRow.id)?.is_muted, { timeout: 30_000 }).toBe(false);
  await expect.poll(async () => (await roster(host.page, id)).find((p) => p.id === guestRow.id)?.is_video_on, { timeout: 30_000 }).toBe(true);

  // A guest has no host controls in the UI.
  await expect(guest.page.getByRole("button", { name: /Remove .* from the meeting/ })).toHaveCount(0);
  await expect(guest.page.getByRole("button", { name: "Mute all" })).toHaveCount(0);

  // Host mutes the guest through the UI; the change reaches the other participant's state.
  // Row actions appear on hover (always visible on touch layouts).
  await host.page.locator(".participant-row", { hasText: "E2E Guest" }).first().hover();
  await host.page.getByRole("button", { name: "Mute E2E Guest" }).first().click({ timeout: 30_000 });
  await expect.poll(async () => (await roster(host.page, id)).find((p) => p.id === guestRow.id)?.is_muted, { timeout: 30_000 }).toBe(true);

  // Raw socket as the guest: host-only actions are refused and nothing changes.
  const outcome = await guest.page.evaluate(
    async ({ meetingId, guestId, hostId }) => {
      const token: string = await (window as any).Clerk.session.getToken();
      const ws = new WebSocket(`ws://localhost:8000/ws/meetings/${meetingId}`);
      const seen: any[] = [];
      ws.onmessage = (e) => seen.push(JSON.parse(e.data));
      await new Promise((r) => (ws.onopen = r));
      ws.send(JSON.stringify({ type: "join", meeting_id: meetingId, participant_id: guestId, display_name: "E2E Guest", token }));
      await new Promise((r) => setTimeout(r, 3000));
      ws.send(JSON.stringify({ type: "remove_participant", participant_id: guestId, target_id: hostId }));
      ws.send(JSON.stringify({ type: "mute_participant", participant_id: guestId, target_id: hostId, is_muted: true }));
      ws.send(JSON.stringify({ type: "end_meeting", participant_id: guestId }));
      // Impersonating the host's participant id is refused as well.
      ws.send(JSON.stringify({ type: "remove_participant", participant_id: hostId, target_id: guestId }));
      await new Promise((r) => setTimeout(r, 3000));
      ws.close();
      return seen.filter((m) => m.type === "error").map((m) => m.code ?? m.error ?? JSON.stringify(m));
    },
    { meetingId: id, guestId: guestRow.id, hostId: hostRow.id }
  );
  expect(outcome.length).toBeGreaterThanOrEqual(3);
  expect(JSON.stringify(outcome)).toMatch(/NOT_HOST|not_host|UNAUTHORIZED/i);
  const after = await roster(host.page, id);
  expect(after.find((p) => p.id === hostRow.id)?.left_at).toBeNull(); // host still in the meeting
  expect((await api(host.page, "GET", `/api/meetings/${id}`)).body.status).toBe("active"); // not ended by the guest

  // Host removes the guest through the UI; the roster records it and the guest is out.
  await host.page.locator(".participant-row", { hasText: "E2E Guest" }).first().hover();
  await host.page.getByRole("button", { name: "Remove E2E Guest from the meeting" }).first().click({ timeout: 30_000 });
  const confirm = host.page.getByRole("button", { name: /^Remove$/ });
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
  await expect
    .poll(async () => (await roster(host.page, id)).find((p) => p.id === guestRow.id)?.left_at ?? null, { timeout: 30_000 })
    .not.toBeNull();
  await expect(guest.page.getByText("Connected", { exact: true })).toBeHidden({ timeout: 30_000 });

  await api(host.page, "DELETE", `/api/meetings/${id}`);
});
