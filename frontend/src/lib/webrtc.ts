import { STUN_SERVER } from "@/lib/constants";

/** TURN/STUN entries fetched from the API (short-lived credentials); empty until loaded. */
let fetchedIceServers: RTCIceServer[] = [];

/** Replace the cached ICE servers (called after `GET /api/webrtc/ice-servers`). */
export function setFetchedIceServers(servers: RTCIceServer[]): void {
  fetchedIceServers = servers;
}

/**
 * RTCConfiguration: the configured STUN server always, plus whatever the API returned
 * (including TURN with expiring credentials when the server has TURN configured). If the
 * API was unreachable this is exactly the previous STUN-only configuration.
 */
export function peerConnectionConfig(): RTCConfiguration {
  const base: RTCIceServer = { urls: STUN_SERVER };
  const list = (urls: string | string[]) => (Array.isArray(urls) ? urls : [urls]);
  const extra = fetchedIceServers.filter((s) => !(list(s.urls).length === 1 && list(s.urls)[0] === STUN_SERVER));
  return { iceServers: [base, ...extra] };
}

/**
 * Deterministic glare handling: for a pair of participants the one with the
 * lower `participant_id` creates the offer; the other answers.
 */
export function shouldCreateOffer(selfId: number, otherId: number): boolean {
  return selfId < otherId;
}

/** One `RTCPeerConnection` per remote participant. Media never touches the server. */
export function createPeerConnection(
  config: RTCConfiguration = peerConnectionConfig()
): RTCPeerConnection {
  return new RTCPeerConnection(config);
}

/** SDP/ICE payloads are forwarded untouched as plain JSON. */
export function descriptionToPayload(
  description: RTCSessionDescription | RTCSessionDescriptionInit
): Record<string, unknown> {
  return {
    type: description.type,
    sdp: description.sdp,
  } as Record<string, unknown>;
}
