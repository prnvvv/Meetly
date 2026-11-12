import fs from "node:fs";
import path from "node:path";
import type { Browser, BrowserContext, Page } from "@playwright/test";

const ROOT = path.resolve(__dirname, "..", "..");
export const API = process.env.E2E_API_URL ?? "http://localhost:8000";

function secret(): string {
  const text = fs.readFileSync(path.join(ROOT, "frontend", ".env.local"), "utf8");
  const line = text.split(/\r?\n/).find((l) => l.startsWith("CLERK_SECRET_KEY="));
  const key = line?.split("=", 2)[1]?.trim().replace(/^"|"$/g, "") ?? "";
  if (!key.startsWith("sk_test_")) throw new Error("refusing to run: not a development Clerk key");
  return key;
}

export function testUsers(): Record<"host" | "guest" | "third", { id: string; username: string }> {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "e2e", ".e2e-users.json"), "utf8"));
}

async function signInToken(userId: string): Promise<string> {
  const res = await fetch("https://api.clerk.com/v1/sign_in_tokens", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret()}`,
      "Content-Type": "application/json",
      "User-Agent": "meetly-e2e/1.0",
    },
    body: JSON.stringify({ user_id: userId, expires_in_seconds: 300 }),
  });
  if (!res.ok) throw new Error(`sign_in_tokens ${res.status}`);
  return (await res.json()).token;
}

export interface Session {
  context: BrowserContext;
  page: Page;
}

/** A fresh, isolated browser context signed in as the user through a real Clerk session. */
export async function signedInSession(
  browser: Browser,
  userId: string,
  opts: { media?: boolean } = {}
): Promise<Session> {
  const context = await browser.newContext({
    permissions: opts.media ? ["camera", "microphone"] : [],
    viewport: { width: 1280, height: 800 },
  });
  // Record every RTCPeerConnection so tests can read real transport statistics.
  await context.addInitScript(() => {
    const Native = window.RTCPeerConnection;
    (window as any).__pcs = [];
    const Wrapped: any = function (this: unknown, ...args: any[]) {
      const pc = new (Native as any)(...args);
      (window as any).__pcs.push(pc);
      return pc;
    };
    Wrapped.prototype = Native.prototype;
    (window as any).RTCPeerConnection = Wrapped;
  });
  const page = await context.newPage();
  const token = await signInToken(userId);
  await page.goto("/");
  await page.waitForFunction(() => (window as any).Clerk?.loaded, null, { timeout: 45_000 });
  await page.evaluate(async (ticket) => {
    const clerk = (window as any).Clerk;
    const attempt = await clerk.client.signIn.create({ strategy: "ticket", ticket });
    if (attempt.status !== "complete") throw new Error("sign-in status " + attempt.status);
    await clerk.setActive({ session: attempt.createdSessionId });
  }, token);
  await page.goto("/dashboard");
  await page.waitForURL(/\/dashboard/, { timeout: 45_000 });
  return { context, page };
}

/** Bearer token of the signed-in page, to call the API exactly like the app does. */
export async function pageToken(page: Page): Promise<string> {
  await page.waitForFunction(() => Boolean((window as any).Clerk?.session), null, { timeout: 30_000 });
  return page.evaluate(() => (window as any).Clerk.session.getToken());
}

export async function api<T = any>(page: Page, method: string, route: string, body?: unknown): Promise<{ status: number; body: T }> {
  const token = await pageToken(page);
  const res = await fetch(`${API}${route}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : (null as T) };
}

export interface MediaSample {
  audioBytes: number;
  videoBytes: number;
  framesDecoded: number;
  connections: number;
  pairTypes: string[];
}

/** Inbound RTP counters summed over every peer connection of the page. */
export async function mediaSample(page: Page): Promise<MediaSample> {
  return page.evaluate(async () => {
    const out = { audioBytes: 0, videoBytes: 0, framesDecoded: 0, connections: 0, pairTypes: [] as string[] };
    for (const pc of (window as any).__pcs as RTCPeerConnection[]) {
      if (pc.connectionState === "closed") continue;
      out.connections += 1;
      const stats = await pc.getStats();
      const byId = new Map<string, any>();
      stats.forEach((r) => byId.set(r.id, r));
      stats.forEach((r: any) => {
        if (r.type === "inbound-rtp" && r.kind === "audio") out.audioBytes += r.bytesReceived ?? 0;
        if (r.type === "inbound-rtp" && r.kind === "video") {
          out.videoBytes += r.bytesReceived ?? 0;
          out.framesDecoded += r.framesDecoded ?? 0;
        }
        if (r.type === "candidate-pair" && r.nominated && r.state === "succeeded") {
          out.pairTypes.push(byId.get(r.remoteCandidateId)?.candidateType ?? "?");
        }
      });
    }
    return out;
  });
}
