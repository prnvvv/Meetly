import { beforeEach, describe, expect, it, vi } from "vitest";
import { peerConnectionConfig, setFetchedIceServers } from "@/lib/webrtc";
import { loadIceServers } from "./iceService";

const apiRequest = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-client", () => ({ apiRequest }));

describe("ICE servers", () => {
  beforeEach(() => {
    apiRequest.mockReset();
    setFetchedIceServers([]);
  });

  it("is STUN-only until the API has answered", () => {
    expect(peerConnectionConfig().iceServers).toHaveLength(1);
    expect(peerConnectionConfig().iceServers?.[0]).toHaveProperty("urls");
  });

  it("adds TURN with its short-lived credentials when the API provides them", async () => {
    apiRequest.mockResolvedValue({
      ice_servers: [
        { urls: ["stun:stun.l.google.com:19302"] },
        { urls: ["turn:t.example.com:3478"], username: "1700000000:7", credential: "abc=" },
      ],
      ttl_seconds: 3600,
      turn_enabled: true,
    });
    expect(await loadIceServers()).toEqual({ turn: true });
    const servers = peerConnectionConfig().iceServers!;
    expect(servers).toHaveLength(2); // the STUN entry is not duplicated
    expect(servers[1]).toEqual({ urls: ["turn:t.example.com:3478"], username: "1700000000:7", credential: "abc=" });
  });

  it("keeps the STUN-only configuration when the API is unreachable and never throws", async () => {
    apiRequest.mockRejectedValue(new Error("offline"));
    await expect(loadIceServers()).resolves.toEqual({ turn: false });
    expect(peerConnectionConfig().iceServers).toHaveLength(1);
  });
});
