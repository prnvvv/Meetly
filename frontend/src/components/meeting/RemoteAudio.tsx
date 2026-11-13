"use client";

import { useEffect, useRef } from "react";

/**
 * Plays every remote participant's audio. Audio is deliberately independent of
 * the video tiles: a tile only mounts a <video> while the camera is on (and the
 * tile is on the visible page), so relying on it silenced participants whose
 * camera was off.
 */
export function RemoteAudio({
  streams,
}: {
  streams: Record<number, MediaStream>;
}) {
  return (
    <>
      {Object.entries(streams).map(([id, stream]) => (
        <RemoteAudioElement key={id} stream={stream} />
      ))}
    </>
  );
}

function RemoteAudioElement({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.srcObject = stream;
    const play = () => void element.play().catch(() => undefined);
    play();
    // Tracks (e.g. a late microphone) can be added after the stream is set.
    stream.addEventListener?.("addtrack", play);
    return () => {
      stream.removeEventListener?.("addtrack", play);
      element.srcObject = null;
    };
  }, [stream]);

  return <audio ref={ref} autoPlay data-testid="remote-audio" />;
}
