import { afterEach, describe, expect, it, vi } from "vitest";
import { getAuthToken } from "./auth-token";

type W = { Clerk?: unknown };
const w = window as unknown as W;

afterEach(() => {
  delete w.Clerk;
  vi.useRealTimers();
});

describe("getAuthToken", () => {
  it("returns the session token when Clerk is loaded", async () => {
    w.Clerk = { loaded: true, session: { getToken: async () => "tok" } };
    expect(await getAuthToken()).toBe("tok");
  });

  it("waits for Clerk to finish loading instead of returning null", async () => {
    const clerk: { loaded: boolean; session: { getToken: () => Promise<string> } | null } = {
      loaded: false,
      session: null,
    };
    w.Clerk = clerk;
    setTimeout(() => {
      clerk.session = { getToken: async () => "late" };
      clerk.loaded = true;
    }, 120);
    expect(await getAuthToken()).toBe("late");
  });

  it("returns null when signed out", async () => {
    w.Clerk = { loaded: true, session: null };
    expect(await getAuthToken()).toBeNull();
  });

  it("returns null if the token lookup throws", async () => {
    w.Clerk = {
      loaded: true,
      session: {
        getToken: async () => {
          throw new Error("x");
        },
      },
    };
    expect(await getAuthToken()).toBeNull();
  });
});
