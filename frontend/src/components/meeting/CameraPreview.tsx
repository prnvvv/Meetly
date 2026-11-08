"use client";

import { useEffect, useRef } from "react";
import { VideoOffIcon } from "@/components/icons";
import { MeetingSetupIllustration } from "./MeetingSetupIllustration";

interface CameraPreviewProps {
  stream: MediaStream | null;
  /** True when the camera is on and a stream exists. */
  live: boolean;
  pending: boolean;
  mirror: boolean;
}

/**
 * The preview box on its own: live video (object-fit: cover) or the camera-off
 * state with the plant and mug anchored in the bottom corners.
 */
export function CameraPreview({ stream, live, pending, mirror }: CameraPreviewProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const element = videoRef.current;
    if (element) element.srcObject = live ? stream : null;
  }, [live, stream]);

  return (
    <div className="nm-preview" data-live={live}>
      <video
        ref={videoRef}
        className={mirror ? "nm-preview__video nm-preview__video--mirror" : "nm-preview__video"}
        autoPlay
        playsInline
        muted
        aria-label="Camera preview"
        hidden={!live}
      />
      <span
        className={live ? "nm-preview__status nm-preview__status--live" : "nm-preview__status"}
        role="status"
      >
        <span className="nm-preview__dot" aria-hidden="true" />
        {pending ? "Starting…" : live ? "Camera On" : "Camera Off"}
      </span>
      {live ? null : (
        <div className="nm-preview__off">
          <span className="nm-preview__off-icon">
            <VideoOffIcon size={26} />
          </span>
          <p className="nm-preview__caption">{pending ? "Starting camera…" : "Camera is off"}</p>
          <MeetingSetupIllustration name="plant" className="nm-preview__prop nm-preview__prop--left" sizes="80px" />
          <MeetingSetupIllustration name="mug" className="nm-preview__prop nm-preview__prop--right" sizes="80px" />
        </div>
      )}
    </div>
  );
}
