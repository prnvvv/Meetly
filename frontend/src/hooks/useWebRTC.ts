"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createPeerConnection,
  descriptionToPayload,
  shouldCreateOffer,
} from "@/lib/webrtc";
import type { ClientMessage, SignalPayloadMessage } from "@/types/realtime";

interface UseWebRtcOptions {
  selfId: number | null;
  localStream: MediaStream | null;
  send: (message: ClientMessage) => void;
}

interface PeerEntry {
  pc: RTCPeerConnection;
  pendingCandidates: RTCIceCandidateInit[];
  /** Remote tracks that arrived without a stream id (see `ontrack`). */
  looseTracks: MediaStreamTrack[];
}

/**
 * Senders carrying `kind`. After `replaceTrack(null)` (camera unavailable)
 * `sender.track` is null, so we also look through `getTransceivers()` to find
 * the sender that belongs to a video/audio transceiver.
 */
function sendersOfKind(pc: RTCPeerConnection, kind: string): RTCRtpSender[] {
  const byTrack = pc.getSenders().filter((sender) => sender.track?.kind === kind);
  if (byTrack.length > 0) return byTrack;

  const byTransceiver: RTCRtpSender[] = [];
  for (const transceiver of pc.getTransceivers()) {
    if (transceiver.receiver.track?.kind === kind) {
      byTransceiver.push(transceiver.sender);
    }
  }
  return byTransceiver;
}

export interface WebRtcState {
  remoteStreams: Record<number, MediaStream>;
  /** Create peers for the connected set; offers when we are the lower id. */
  syncPeers: (peerIds: number[]) => void;
  handleSignal: (message: SignalPayloadMessage) => Promise<void>;
  closePeer: (peerId: number) => void;
  resetPeers: () => void;
}

/**
 * Full-mesh WebRTC: one `RTCPeerConnection` per remote participant.
 * The lower `participant_id` creates offers (deterministic glare handling);
 * SDP/ICE are forwarded untouched over the signaling socket. Media travels
 * browser-to-browser only.
 */
export function useWebRTC({
  selfId,
  localStream,
  send,
}: UseWebRtcOptions): WebRtcState {
  const peersRef = useRef(new Map<number, PeerEntry>());
  const selfIdRef = useRef(selfId);
  const sendRef = useRef(send);
  const [remoteStreams, setRemoteStreams] = useState<Record<number, MediaStream>>({});

  useEffect(() => {
    selfIdRef.current = selfId;
  }, [selfId]);
  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  const removePeer = useCallback((peerId: number) => {
    const entry = peersRef.current.get(peerId);
    if (entry) {
      entry.pc.close();
      peersRef.current.delete(peerId);
    }
    setRemoteStreams((current) => {
      const stream = current[peerId];
      if (stream) {
        // Release the remote media; local tracks are shared and stay alive.
        stream.getTracks().forEach((track) => track.stop());
      }
      if (!(peerId in current)) return current;
      const next = { ...current };
      delete next[peerId];
      return next;
    });
  }, []);

  /** Offerer-only: renegotiate with fresh ICE credentials after a failed path. */
  const restartIce = useCallback(
    async (peerId: number, pc: RTCPeerConnection): Promise<void> => {
      const me = selfIdRef.current;
      if (me === null || !shouldCreateOffer(me, peerId)) return;
      if (pc.signalingState !== "stable") return;
      try {
        const offer = await pc.createOffer({ iceRestart: true });
        await pc.setLocalDescription(offer);
        sendRef.current({
          type: "offer",
          sender_id: me,
          target_id: peerId,
          payload: descriptionToPayload(pc.localDescription ?? offer),
        });
      } catch {
        // The peer was closed meanwhile; nothing to recover.
      }
    },
    []
  );

  const ensurePeer = useCallback(
    (peerId: number): RTCPeerConnection => {
      const existing = peersRef.current.get(peerId);
      if (existing) return existing.pc;

      const pc = createPeerConnection();
      const entry: PeerEntry = { pc, pendingCandidates: [], looseTracks: [] };
      peersRef.current.set(peerId, entry);

      if (localStream) {
        for (const track of localStream.getTracks()) {
          pc.addTrack(track, localStream);
        }
      }
      if (sendersOfKind(pc, "video").length === 0) {
        pc.addTransceiver("video", { direction: "sendrecv" });
      }
      if (sendersOfKind(pc, "audio").length === 0) {
        pc.addTransceiver("audio", { direction: "sendrecv" });
      }

      pc.onicecandidate = (event) => {
        const me = selfIdRef.current;
        if (!event.candidate || me === null) return;
        sendRef.current({
          type: "ice_candidate",
          sender_id: me,
          target_id: peerId,
          payload: event.candidate.toJSON() as RTCIceCandidateInit,
        });
      };

      pc.ontrack = (event) => {
        // Tracks sent without a stream id arrive with `streams` empty. Wrapping
        // each in its own MediaStream made the audio and video tracks overwrite
        // one another, so collect every received track into one stream per peer.
        const stream =
          event.streams[0] ??
          new MediaStream([
            ...entry.looseTracks.filter((track) => track.readyState === "live"),
            event.track,
          ]);
        if (!event.streams[0]) {
          entry.looseTracks = stream.getTracks();
        }
        setRemoteStreams((current) => ({ ...current, [peerId]: stream }));
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed") {
          // Try to recover the path (the offerer drives it) instead of
          // silently dropping a peer that is still in the meeting.
          void restartIce(peerId, pc);
        }
      };

      return pc;
    },
    [localStream, restartIce]
  );

  const sendOffer = useCallback(
    async (peerId: number): Promise<void> => {
      const me = selfIdRef.current;
      if (me === null || !shouldCreateOffer(me, peerId)) return;
      const pc = ensurePeer(peerId);
      if (pc.remoteDescription || pc.signalingState !== "stable") return;
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      sendRef.current({
        type: "offer",
        sender_id: me,
        target_id: peerId,
        payload: descriptionToPayload(pc.localDescription ?? offer),
      });
    },
    [ensurePeer]
  );

  const syncPeers = useCallback(
    (peerIds: number[]) => {
      for (const peerId of peerIds) {
        if (peerId === selfIdRef.current) continue;
        void sendOffer(peerId);
      }
    },
    [sendOffer]
  );

  const handleSignal = useCallback(
    async (message: SignalPayloadMessage): Promise<void> => {
      const { sender_id: peerId, payload } = message;
      if (peerId === selfIdRef.current) return;

      if (message.type === "ice_candidate") {
        const entry = peersRef.current.get(peerId);
        if (!entry) return;
        const candidate = payload as RTCIceCandidateInit;
        if (entry.pc.remoteDescription) {
          await entry.pc.addIceCandidate(candidate).catch(() => undefined);
        } else {
          entry.pendingCandidates.push(candidate);
        }
        return;
      }

      const pc = ensurePeer(peerId);

      if (message.type === "offer") {
        const offer = payload as unknown as RTCSessionDescriptionInit;
        await pc.setRemoteDescription(offer);
        for (const candidate of entryCandidates(peersRef, peerId)) {
          await pc.addIceCandidate(candidate).catch(() => undefined);
        }
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        const me = selfIdRef.current;
        if (me !== null) {
          sendRef.current({
            type: "answer",
            sender_id: me,
            target_id: peerId,
            payload: descriptionToPayload(pc.localDescription ?? answer),
          });
        }
        return;
      }

      // answer
      const answer = payload as unknown as RTCSessionDescriptionInit;
      // Also accepts the answer to an ICE-restart offer (remoteDescription is
      // already set then, but we are waiting on our own offer).
      if (pc.signalingState === "have-local-offer") {
        await pc.setRemoteDescription(answer);
        const entry = peersRef.current.get(peerId);
        for (const candidate of entry?.pendingCandidates ?? []) {
          await pc
            .addIceCandidate(candidate as RTCIceCandidateInit)
            .catch(() => undefined);
        }
        if (entry) entry.pendingCandidates = [];
      }
    },
    [ensurePeer]
  );

  const resetPeers = useCallback(() => {
    for (const peerId of [...peersRef.current.keys()]) {
      removePeer(peerId);
    }
  }, [removePeer]);

  // Attach the local stream when it arrives after peers exist. Switching a
  // device mid-meeting replaces the track on the existing sender instead of
  // adding a second one, so no renegotiation is needed.
  useEffect(() => {
    if (!localStream) return;
    for (const { pc } of peersRef.current.values()) {
      for (const track of localStream.getTracks()) {
        const [sender] = sendersOfKind(pc, track.kind);
        if (sender) {
          void sender.replaceTrack(track).catch(() => undefined);
        } else {
          pc.addTrack(track, localStream);
        }
      }
    }
  }, [localStream]);

  useEffect(() => {
    const peers = peersRef.current;
    return () => {
      for (const { pc } of peers.values()) pc.close();
      peers.clear();
    };
  }, []);

  return {
    remoteStreams,
    syncPeers,
    handleSignal,
    closePeer: removePeer,
    resetPeers,
  };
}

function entryCandidates(
  peersRefObj: { current: Map<number, PeerEntry> },
  peerId: number
): RTCIceCandidateInit[] {
  const entry = peersRefObj.current.get(peerId);
  if (!entry) return [];
  const queued = entry.pendingCandidates.splice(0);
  return queued;
}
