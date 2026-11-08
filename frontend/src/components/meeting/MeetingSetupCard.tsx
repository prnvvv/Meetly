"use client";

import { MicIcon, MicOffIcon, VideoIcon, VideoOffIcon, VolumeIcon } from "@/components/icons";
import type { MediaDevicesState } from "@/hooks/useMediaDevices";
import { DeviceSelect } from "./DeviceSelect";
import { DeviceSetupRow } from "./DeviceSetupRow";
import type { DeviceStatus } from "./DeviceStatusBadge";
import { CameraPreview } from "./CameraPreview";
import { MeetingSetupIllustration } from "./MeetingSetupIllustration";
import { SecurityInfoCard } from "./SecurityInfoCard";

interface MeetingSetupCardProps {
  devices: MediaDevicesState;
  /** True once the first device enumeration has finished. */
  devicesReady: boolean;
  cameraOn: boolean;
  cameraPending: boolean;
  micOn: boolean;
  micPending: boolean;
  mirrorCamera: boolean;
  onCameraChange: (next: boolean) => void;
  onMicChange: (next: boolean) => void;
}

/** Right-hand card: live camera preview (or illustration), device pickers, security note. */
export function MeetingSetupCard({
  devices,
  devicesReady,
  cameraOn,
  cameraPending,
  micOn,
  micPending,
  mirrorCamera,
  onCameraChange,
  onMicChange,
}: MeetingSetupCardProps) {
  const showVideo = cameraOn && devices.stream !== null;


  const cameraStatus: DeviceStatus = cameraPending
    ? "pending"
    : cameraOn
      ? "on"
      : devicesReady && devices.videoInputDevices.length === 0
        ? "unavailable"
        : "off";

  const micStatus: DeviceStatus = micPending
    ? "pending"
    : micOn
      ? "on"
      : devicesReady && devices.audioInputDevices.length === 0
        ? "unavailable"
        : "off";

  // Browsers without setSinkId always play through the system default output.
  const speakerStatus: DeviceStatus = !devicesReady
    ? "pending"
    : devices.canSelectSpeaker
      ? devices.audioOutputDevices.length > 0
        ? "connected"
        : "unavailable"
      : "connected";

  return (
    <section className="nm-card nm-card--setup" aria-labelledby="nm-setup-title">
      <div className="nm-stage">
        <div className="nm-stage__inner">
          {/* Heading and the lady share one band; she is centred and sits on the preview's top edge. */}
          <div className="nm-stage__top">
            <div className="nm-card__head">
              <h2 className="nm-card__title" id="nm-setup-title">
                Meeting Setup
              </h2>
              <p className="nm-card__subtitle">Check your devices and settings before joining.</p>
            </div>
            <MeetingSetupIllustration name="lady" className="nm-stage__lady" sizes="(max-width: 700px) 170px, 220px" priority />
          </div>
          <div className="nm-stage__slot">
            <CameraPreview stream={devices.stream} live={showVideo} pending={cameraPending} mirror={mirrorCamera} />
          </div>
        </div>
      </div>

      <div className="nm-devices">
        <DeviceSetupRow
          label="Camera"
          icon={cameraOn ? <VideoIcon size={18} /> : <VideoOffIcon size={18} />}
          status={cameraStatus}
          select={
            <DeviceSelect
              id="nm-camera"
              label="Camera"
              devices={devices.videoInputDevices}
              value={devices.selectedVideoInputId}
              emptyLabel={devicesReady ? "No camera detected" : "Looking for cameras…"}
              onChange={devices.setVideoInput}
            />
          }
          toggle={{
            checked: cameraOn,
            disabled: cameraPending,
            onChange: onCameraChange,
          }}
        />
        <DeviceSetupRow
          label="Microphone"
          icon={micOn ? <MicIcon size={18} /> : <MicOffIcon size={18} />}
          status={micStatus}
          select={
            <DeviceSelect
              id="nm-microphone"
              label="Microphone"
              devices={devices.audioInputDevices}
              value={devices.selectedAudioInputId}
              emptyLabel={devicesReady ? "No microphone detected" : "Looking for microphones…"}
              onChange={devices.setAudioInput}
            />
          }
          toggle={{
            checked: micOn,
            disabled: micPending,
            onChange: onMicChange,
          }}
        />
        <DeviceSetupRow
          label="Speaker"
          icon={<VolumeIcon size={18} />}
          status={speakerStatus}
          select={
            <DeviceSelect
              id="nm-speaker"
              label="Speaker"
              devices={devices.canSelectSpeaker ? devices.audioOutputDevices : []}
              value={devices.selectedAudioOutputId ?? "default"}
              emptyLabel={
                !devices.canSelectSpeaker
                  ? "System default"
                  : devicesReady
                    ? "No speaker detected"
                    : "Looking for speakers…"
              }
              onChange={devices.setAudioOutput}
            />
          }
        />
      </div>

      {devices.error ? (
        <p className="nm-device-error" role="alert">
          {devices.error}
        </p>
      ) : null}

      <SecurityInfoCard />
    </section>
  );
}
