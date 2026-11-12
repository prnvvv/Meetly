import { apiRequest } from "@/lib/api-client";
import { setFetchedIceServers } from "@/lib/webrtc";

interface IceConfigResponse {
  ice_servers: { urls: string[]; username?: string | null; credential?: string | null }[];
  ttl_seconds: number;
  turn_enabled: boolean;
}

/**
 * Ask the API for ICE servers (TURN credentials expire, so this runs on every join). Never
 * throws: a failure simply leaves the STUN-only configuration in place.
 */
export async function loadIceServers(): Promise<{ turn: boolean }> {
  try {
    const config = await apiRequest<IceConfigResponse>("/api/webrtc/ice-servers");
    setFetchedIceServers(
      config.ice_servers.map((s) => ({
        urls: s.urls,
        ...(s.username ? { username: s.username } : {}),
        ...(s.credential ? { credential: s.credential } : {}),
      }))
    );
    return { turn: config.turn_enabled };
  } catch {
    return { turn: false };
  }
}
