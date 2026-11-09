"use client";

import { useCallback, useEffect, useState } from "react";
import { useMediaDevices } from "@/hooks/useMediaDevices";
import { useRoomPreferences } from "@/hooks/useRoomPreferences";

/**
 * Device state behind <MeetingSetupCard>, shared by /new-meeting and /join so
 * both pages behave identically: camera and microphone start off, devices are
 * enumerated without prompting, and tracks are released when the page unmounts.
 *
 * Spread `cardProps` onto <MeetingSetupCard />.
 */
export function useMeetingSetup() {
  const devices = useMediaDevices();
  const { preferences } = useRoomPreferences();
  const { stop: stopDevices, refreshDevices } = devices;

  const [devicesReady, setDevicesReady] = useState(false);
  const [cameraPending, setCameraPending] = useState(false);
  const [micPending, setMicPending] = useState(false);

  // Enumeration never prompts for permission; it only tells us when the lists are real.
  useEffect(() => {
    let active = true;
    void refreshDevices().then(() => {
      if (active) setDevicesReady(true);
    });
    return () => {
      active = false;
    };
  }, [refreshDevices]);

  // Release the camera and microphone when leaving the page (including when
  // navigating into the meeting, which acquires its own tracks).
  useEffect(() => stopDevices, [stopDevices]);

  const cameraOn = devices.isVideoOn;
  const micOn = devices.audioJoined && !devices.isMuted;

  const toggleCamera = useCallback(
    async (next: boolean) => {
      setCameraPending(true);
      try {
        await devices.setVideoOn(next);
      } finally {
        setCameraPending(false);
      }
    },
    [devices]
  );

  const toggleMic = useCallback(
    async (next: boolean) => {
      if (!devices.audioJoined) {
        if (!next) return;
        setMicPending(true);
        try {
          await devices.joinAudio();
        } finally {
          setMicPending(false);
        }
        return;
      }
      devices.setMuted(!next);
    },
    [devices]
  );

  return {
    devices,
    cardProps: {
      devices,
      devicesReady,
      cameraOn,
      cameraPending,
      micOn,
      micPending,
      mirrorCamera: preferences.mirrorSelf,
      onCameraChange: toggleCamera,
      onMicChange: toggleMic,
    },
  };
}
