import { expect, test } from "@playwright/test";
import { api, signedInSession, testUsers } from "../support/clerk";

test("two real Clerk sessions map to two different backend users and survive a refresh", async ({ browser }) => {
  const users = testUsers();
  const host = await signedInSession(browser, users.host.id);
  const guest = await signedInSession(browser, users.guest.id);

  const h = await api(host.page, "GET", "/api/users/me");
  const g = await api(guest.page, "GET", "/api/users/me");
  expect(h.status).toBe(200);
  expect(g.status).toBe(200);
  expect(h.body.id).not.toBe(g.body.id);

  // Session persistence: reload keeps the user signed in on a protected page.
  await host.page.goto("/dashboard");
  await host.page.reload();
  await expect(host.page).toHaveURL(/\/dashboard/);
  const again = await api(host.page, "GET", "/api/users/me");
  expect(again.body.id).toBe(h.body.id);

  // Without a token the API refuses.
  const anon = await fetch("http://localhost:8000/api/users/me");
  expect(anon.status).toBe(401);

  await host.context.close();
  await guest.context.close();
});
