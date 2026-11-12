import { expect, test, type Page } from "@playwright/test";
import { api, signedInSession, testUsers } from "../support/clerk";

/** Friends, blocking, notifications and invitations with three real accounts (A host, B guest, C third). */

async function me(page: Page): Promise<{ id: number; username: string }> {
  const r = await api(page, "GET", "/api/users/me");
  expect(r.status).toBe(200);
  const prof = await api(page, "GET", "/api/users/me/profile");
  expect(prof.status).toBe(200);
  return { id: r.body.id, username: prof.body.username };
}

/** Put the three accounts back to "strangers" so a re-run starts from a known state. */
async function reset(pages: Page[], ids: number[]) {
  for (const [i, p] of pages.entries()) {
    for (const other of ids.filter((_, j) => j !== i)) {
      await api(p, "DELETE", `/api/friends/${other}`);
      await api(p, "DELETE", `/api/users/${other}/block`);
    }
    const out = (await api(p, "GET", "/api/friends/requests/outgoing")).body as any[];
    for (const r of out) await api(p, "DELETE", `/api/friends/requests/${r.id}`);
    const inc = (await api(p, "GET", "/api/friends/requests/incoming")).body as any[];
    for (const r of inc) await api(p, "POST", `/api/friends/requests/${r.id}/reject`);
  }
}

test.setTimeout(900_000); // each API call costs 1-6 s from this laptop to the cloud database

test("friend requests, notifications, removal and blocking persist and are enforced by the backend", async ({ browser }) => {
  const u = testUsers();
  const A = await signedInSession(browser, u.host.id);
  const B = await signedInSession(browser, u.guest.id);
  const C = await signedInSession(browser, u.third.id);
  const [a, b, c] = [await me(A.page), await me(B.page), await me(C.page)];
  await reset([A.page, B.page, C.page], [a.id, b.id, c.id]);

  // Search finds the other person by username, with no email in the card.
  const found = await api(A.page, "GET", `/api/users/search?q=${b.username}`);
  const card = (found.body.items as any[]).find((p) => p.user_id === b.id);
  expect(card?.relationship).toBe("none");
  expect(JSON.stringify(found.body)).not.toContain("@");

  // Rules the UI never offers but the backend must hold.
  expect((await api(A.page, "POST", "/api/friends/requests", { user_id: a.id })).status).toBeGreaterThanOrEqual(400); // self
  expect((await api(A.page, "POST", "/api/friends/requests", { user_id: 999999999 })).status).toBeGreaterThanOrEqual(400); // unknown

  // A -> B request; a repeat does not create a second one.
  const sent = await api(A.page, "POST", "/api/friends/requests", { user_id: b.id });
  expect(sent.status).toBeLessThan(300);
  await api(A.page, "POST", "/api/friends/requests", { user_id: b.id });
  const incoming = (await api(B.page, "GET", "/api/friends/requests/incoming")).body as any[];
  expect(incoming.filter((r) => r.person.user_id === a.id)).toHaveLength(1);
  expect(((await api(A.page, "GET", "/api/friends/requests/outgoing")).body as any[]).some((r) => r.person.user_id === b.id)).toBe(true);

  // Only the receiver may accept; a third account cannot touch the request.
  const rid = incoming.find((r) => r.person.user_id === a.id).id;
  expect((await api(C.page, "POST", `/api/friends/requests/${rid}/accept`)).status).toBeGreaterThanOrEqual(400);
  expect((await api(A.page, "POST", `/api/friends/requests/${rid}/accept`)).status).toBeGreaterThanOrEqual(400); // the sender cannot self-accept

  // B sees the notification as unread, and the bell in the real UI says so.
  let notes = (await api(B.page, "GET", "/api/notifications")).body;
  expect(notes.items.some((n: any) => n.actor?.user_id === a.id && n.read === false)).toBe(true);
  await B.page.reload();
  await expect(B.page.getByRole("button", { name: /Notifications, \d+ unread/ })).toBeVisible({ timeout: 30_000 });

  // B accepts through the real Friends panel.
  await B.page.getByRole("button", { name: "Friends", exact: true }).click();
  await B.page.getByRole("tab", { name: /Requests/ }).click();
  await B.page.getByRole("button", { name: "Accept" }).first().click();
  await expect
    .poll(async () => ((await api(B.page, "GET", "/api/friends")).body.items as any[]).some((p) => p.user_id === a.id), { timeout: 20_000 })
    .toBe(true);
  expect(((await api(A.page, "GET", "/api/friends")).body.items as any[]).some((p) => p.user_id === b.id)).toBe(true);
  // C is not exposed to the friendship.
  expect(((await api(C.page, "GET", "/api/friends")).body.items as any[]).length).toBe(0);

  // A is told the request was accepted. Read state is per notification, persists and is per recipient.
  notes = (await api(A.page, "GET", "/api/notifications")).body;
  const accepted = notes.items.find((n: any) => n.actor?.user_id === b.id);
  expect(accepted).toBeTruthy();
  const before = notes.items.filter((n: any) => !n.read).length;
  expect((await api(A.page, "PATCH", `/api/notifications/${accepted.id}/read`)).status).toBe(204);
  const afterOne = ((await api(A.page, "GET", "/api/notifications")).body.items as any[]).filter((n) => !n.read).length;
  expect(afterOne).toBe(before - 1);
  expect((await api(B.page, "PATCH", `/api/notifications/${accepted.id}/read`)).status).toBeGreaterThanOrEqual(400); // not B's notification
  await api(A.page, "POST", "/api/notifications/read-all");
  expect(((await api(A.page, "GET", "/api/notifications")).body.items as any[]).every((n) => n.read)).toBe(true);

  // Remove, then reject, then cancel.
  expect((await api(A.page, "DELETE", `/api/friends/${b.id}`)).status).toBe(204);
  expect(((await api(B.page, "GET", "/api/friends")).body.items as any[]).length).toBe(0);
  const again = await api(A.page, "POST", "/api/friends/requests", { user_id: b.id });
  expect(again.status).toBeLessThan(300);
  const r2 = ((await api(B.page, "GET", "/api/friends/requests/incoming")).body as any[])[0];
  expect((await api(B.page, "POST", `/api/friends/requests/${r2.id}/reject`)).status).toBeLessThan(300);
  expect(((await api(B.page, "GET", "/api/friends")).body.items as any[]).length).toBe(0);
  // A rejected request starts a 7-day cooldown: the sender cannot ask again straight away (429).
  expect((await api(A.page, "POST", "/api/friends/requests", { user_id: b.id })).status).toBe(429);
  // Cancel: a pending request can be withdrawn by its sender (A -> C), and then disappears for C.
  const toC = await api(A.page, "POST", "/api/friends/requests", { user_id: c.id });
  expect(toC.status).toBeLessThan(300);
  expect((await api(B.page, "DELETE", `/api/friends/requests/${toC.body.request_id}`)).status).toBeGreaterThanOrEqual(400); // not B's request
  expect((await api(A.page, "DELETE", `/api/friends/requests/${toC.body.request_id}`)).status).toBeLessThan(300);
  expect(((await api(C.page, "GET", "/api/friends/requests/incoming")).body as any[]).length).toBe(0);

  // Blocking: B blocks A (no pending request left between them). A can no longer request, and the block is listed only for B.
  expect((await api(B.page, "POST", `/api/users/${a.id}/block`)).status).toBeLessThan(300);
  expect(((await api(B.page, "GET", "/api/blocks")).body.items as any[]).some((p) => p.user_id === a.id)).toBe(true);
  expect(((await api(A.page, "GET", "/api/blocks")).body.items as any[]).length).toBe(0);
  const blockedReq = await api(A.page, "POST", "/api/friends/requests", { user_id: b.id });
  expect(blockedReq.status).toBeGreaterThanOrEqual(400);
  expect(((await api(B.page, "GET", "/api/friends/requests/incoming")).body as any[]).length).toBe(0);
  // ...and B cannot befriend the person they blocked without unblocking first.
  expect((await api(B.page, "POST", "/api/friends/requests", { user_id: a.id })).status).toBeGreaterThanOrEqual(400);
  // Unblock restores the ability.
  expect((await api(B.page, "DELETE", `/api/users/${a.id}/block`)).status).toBe(204);
  // (A and B are in the 7-day cooldown from the rejection above, so the request after unblocking is C's.)
  expect((await api(C.page, "POST", "/api/friends/requests", { user_id: a.id })).status).toBeLessThan(300);
  await reset([A.page, B.page, C.page], [a.id, b.id, c.id]);
});

test("inviting friends to instant and scheduled meetings respects friendship, blocks, ownership and the schedule", async ({ browser }) => {
  const u = testUsers();
  const A = await signedInSession(browser, u.host.id);
  const B = await signedInSession(browser, u.guest.id);
  const C = await signedInSession(browser, u.third.id);
  const [a, b, c] = [await me(A.page), await me(B.page), await me(C.page)];
  await reset([A.page, B.page, C.page], [a.id, b.id, c.id]);

  // Make A and B friends (A asks, B accepts).
  // (B asks, A accepts: A -> B is still in the cooldown left by the first test's rejection.)
  const sent = await api(B.page, "POST", "/api/friends/requests", { user_id: a.id });
  expect(sent.status).toBeLessThan(300);
  expect((await api(A.page, "POST", `/api/friends/requests/${sent.body.request_id}/accept`)).status).toBeLessThan(300);

  // Instant meeting.
  const meeting = await api(A.page, "POST", "/api/meetings", { title: "E2E invite room" });
  expect(meeting.status).toBe(201);
  const mid = meeting.body.meeting_id;

  // Friend is invited, a non-friend is refused ("unavailable"), nobody is told why.
  const inv = await api(A.page, "POST", `/api/meetings/${mid}/invitations`, { user_ids: [b.id, c.id] });
  expect(inv.status).toBeLessThan(300);
  const byUser = Object.fromEntries((inv.body.results as any[]).map((r) => [r.user_id, r.result]));
  expect(byUser[b.id]).toBe("invited");
  expect(byUser[c.id]).toBe("unavailable");

  // Only B has the invitation, with a notification; C sees nothing about the meeting.
  const mine = (await api(B.page, "GET", "/api/invitations")).body as any[];
  const row = mine.find((i) => i.meeting?.meeting_id === mid);
  expect(row).toBeTruthy();
  expect(((await api(C.page, "GET", "/api/invitations")).body as any[]).some((i) => i.meeting?.meeting_id === mid)).toBe(false);
  expect((await api(C.page, "GET", `/api/meetings/${mid}/invitations`)).status).toBeGreaterThanOrEqual(400);
  // A guest cannot invite others to a meeting they do not host.
  expect((await api(C.page, "POST", `/api/meetings/${mid}/invitations`, { user_ids: [a.id] })).status).toBeGreaterThanOrEqual(400);
  // The invitee cannot cancel or accept on behalf of someone else.
  expect((await api(C.page, "POST", `/api/invitations/${row.id}/accept`)).status).toBeGreaterThanOrEqual(400);

  // B accepts and can join an active instant meeting (through the waiting room rules the API applies).
  const acc = await api(B.page, "POST", `/api/invitations/${row.id}/accept`);
  expect(acc.status).toBeLessThan(300);
  expect(acc.body.joinable_now).toBe(true);
  const join = await api(B.page, "POST", `/api/meetings/${mid}/join`, { display_name: "E2E Guest" });
  expect(join.status).toBeLessThan(300);

  // A scheduled (future) meeting: invite works, accept works, joining before the start is refused.
  const start = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString();
  const sched = await api(A.page, "POST", "/api/schedules", { title: "E2E invite scheduled", start_time: start, duration: 30 });
  expect(sched.status).toBeLessThan(300);
  const sid = sched.body.meeting_id ?? sched.body[0]?.meeting_id;
  const sinv = await api(A.page, "POST", `/api/meetings/${sid}/invitations`, { user_ids: [b.id] });
  expect(sinv.status).toBeLessThan(300);
  const srow = ((await api(B.page, "GET", "/api/invitations")).body as any[]).find((i) => i.meeting?.meeting_id === sid);
  expect(srow).toBeTruthy();
  const sacc = await api(B.page, "POST", `/api/invitations/${srow.id}/accept`);
  expect(sacc.body.joinable_now).toBe(false);
  expect((await api(B.page, "POST", `/api/meetings/${sid}/join`, { display_name: "E2E Guest" })).status).toBe(409);

  // Blocking ends the ability to invite: after B blocks A, A cannot invite B again.
  await api(B.page, "POST", `/api/users/${a.id}/block`);
  const m2 = await api(A.page, "POST", "/api/meetings", { title: "E2E invite room 2" });
  const blockedInv = await api(A.page, "POST", `/api/meetings/${m2.body.meeting_id}/invitations`, { user_ids: [b.id] });
  const blockedRes = (blockedInv.body?.results ?? []).map((r: any) => r.result);
  expect(blockedInv.status >= 400 || blockedRes.every((r: string) => r === "unavailable")).toBe(true);
  expect(((await api(B.page, "GET", "/api/invitations")).body as any[]).some((i) => i.meeting?.meeting_id === m2.body.meeting_id)).toBe(false);

  // Clean up everything this test created.
  for (const id of [mid, sid, m2.body.meeting_id]) await api(A.page, "DELETE", `/api/meetings/${id}`);
  await reset([A.page, B.page, C.page], [a.id, b.id, c.id]);
});
