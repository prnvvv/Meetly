import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "./api-client";

const assign = vi.fn();

beforeEach(() => {
  assign.mockReset();
  vi.stubGlobal("location", { pathname: "/dashboard", search: "?x=1", assign });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 401 })));
});
afterEach(() => vi.unstubAllGlobals());

describe("401 handling", () => {
  it("sends the user to sign-in and back to the same page", async () => {
    await expect(apiRequest("/api/x")).rejects.toMatchObject({ status: 401 });
    expect(assign).toHaveBeenCalledWith("/sign-in?redirect_url=%2Fdashboard%3Fx%3D1");
  });

  it("does not redirect on public pages", async () => {
    vi.stubGlobal("location", { pathname: "/sign-in", search: "", assign });
    await expect(apiRequest("/api/x")).rejects.toMatchObject({ status: 401 });
    expect(assign).not.toHaveBeenCalled();
  });
});
