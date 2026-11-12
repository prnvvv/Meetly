import { expect, test, type Page } from "@playwright/test";
import { api, mediaSample, signedInSession, testUsers, type Session } from "../support/clerk";

const connected = (page: Page) => expect(page.getByText("Connected", { exact: true })).toBeVisible({ timeout: 60_000 });

async function newMeeting(host: Session, waitingRoom: boolean): Promise<string> {
  const created = await api(host.page, "POST", "/api/meetings", { title: "E2E room" });
  expect(created.status).toBe(201);
  const id: string = created.body.meeting_id;
  if (waitingRoom) {
    const wr = await api(host.page, "PATCH", `/api/meetings/${id}/waiting-room`, { enabled: true });
    expect(wr.status).toBe(200);
  }
  return id;
}

test("waiting room: guest waits, host admits, audio and video really flow both ways", async ({ browser }) => {
  const users = testUsers();
  const host = await signedInSession(browser, users.host.id, { media: true });
  const guest = await signedInSession(browser, users.guest.id, { media: true });
  const id = await newMeeting(host, true);

  await host.page.goto(`/meetings/${id}`);
  await connected(host.page);

  // Guest is held in the waiting room, with no participant row in the database.
  await guest.page.goto(`/meetings/${id}`);
  await expect(guest.page.getByRole("heading", { name: /Waiting for the host/ })).toBeVisible({ timeout: 60_000 });
  let roster = await api(host.page, "GET", `/api/meetings/${id}/participants`);
  expect(JSON.stringify(roster.body)).not.toContain("E2E Guest");

  // The guest cannot read the room while waiting (backend authorization).
  const peek = await api(guest.page, "GET", `/api/meetings/${id}/participants`);
  expect(peek.status).toBe(403);

  // Host sees the request instantly (WebSocket push) and admits.
  await host.page.getByRole("toolbar", { name: "Meeting controls" }).getByRole("button", { name: "Show participants" }).click();
  await host.page.getByRole("button", { name: "Admit E2E Guest" }).click({ timeout: 30_000 });
  await expect(guest.page.getByRole("heading", { name: /Waiting for the host/ })).toBeHidden({ timeout: 30_000 });
  await connected(guest.page);

  await expect
    .poll(async () => JSON.stringify((await api(host.page, "GET", `/api/meetings/${id}/participants`)).body), { timeout: 30_000 })
    .toContain("E2E Guest");

  // Everyone turns on mic and camera.
  for (const s of [host, guest]) {
    await s.page.getByRole("button", { name: "Join Audio" }).click();
    await s.page.getByRole("button", { name: "Turn camera on" }).click();
  }

  // Real media: inbound audio/video bytes and decoded frames must keep growing on BOTH sides.
  for (const [name, s] of [["host", host], ["guest", guest]] as const) {
    await expect.poll(async () => (await mediaSample(s.page)).connections, { timeout: 60_000, message: `${name} peer connection` }).toBeGreaterThan(0);
    const a = await mediaSample(s.page);
    await s.page.waitForTimeout(4000);
    const b = await mediaSample(s.page);
    console.log(name, "audio bytes", a.audioBytes, "->", b.audioBytes, "| video bytes", a.videoBytes, "->", b.videoBytes, "| frames", a.framesDecoded, "->", b.framesDecoded, "| pair", b.pairTypes.join(","));
    expect(b.audioBytes, `${name} inbound audio`).toBeGreaterThan(a.audioBytes);
    expect(b.videoBytes, `${name} inbound video`).toBeGreaterThan(a.videoBytes);
    expect(b.framesDecoded, `${name} decoded frames`).toBeGreaterThan(a.framesDecoded);
  }

  await host.context.close();
  await guest.context.close();
});
