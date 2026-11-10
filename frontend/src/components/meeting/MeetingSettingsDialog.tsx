"use client";

import { useEffect, useState } from "react";
import {
  AutoLayoutIcon,
  GridViewIcon,
  MaximizeIcon,
  MinimizeIcon,
  SpeakerViewIcon,
  VolumeIcon,
  XIcon,
} from "@/components/icons";
import { deviceLabel } from "@/hooks/useMediaDevices";
import type {
  RoomLayoutMode,
  RoomPreferences,
} from "@/hooks/useRoomPreferences";
import { cx } from "@/lib/utils";
import type { SettingsTab } from "@/components/meeting/ControlBar";

export interface SettingsDevices {
  audioInputDevices: MediaDeviceInfo[];
  videoInputDevices: MediaDeviceInfo[];
  audioOutputDevices: MediaDeviceInfo[];
  selectedAudioInputId: string | null;
  selectedVideoInputId: string | null;
  selectedAudioOutputId: string | null;
  canSelectSpeaker: boolean;
  setAudioInput: (deviceId: string) => void;
  setVideoInput: (deviceId: string) => void;
  setAudioOutput: (deviceId: string) => void;
}

interface MeetingSettingsDialogProps {
  open: boolean;
  tab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
  devices: SettingsDevices;
  preferences: RoomPreferences;
  localStream: MediaStream | null;
  isFullscreen: boolean;
  fullscreenSupported: boolean;
  onSetLayout: (layout: RoomLayoutMode) => void;
  onSetMirrorSelf: (mirror: boolean) => void;
  onToggleFullscreen: () => void;
  onClose: () => void;
}

const TABS: { key: SettingsTab; label: string }[] = [
  { key: "video", label: "Video" },
  { key: "audio", label: "Audio" },
  { key: "meeting", label: "Meeting" },
  { key: "general", label: "General" },
];

const LAYOUT_OPTIONS: {
  key: RoomLayoutMode;
  label: string;
  hint: string;
  icon: React.ReactNode;
}[] = [
  {
    key: "auto",
    label: "Auto",
    hint: "Follows the active speaker",
    icon: <AutoLayoutIcon size={18} />,
  },
  {
    key: "gallery",
    label: "Gallery",
    hint: "Everyone in an evenly sized grid",
    icon: <GridViewIcon size={18} />,
  },
  {
    key: "speaker",
    label: "Speaker",
    hint: "One large tile with a thumbnail strip",
    icon: <SpeakerViewIcon size={18} />,
  },
];

function supportsSetSinkId(): boolean {
  return (
    typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype
  );
}

/** Live microphone level (0..1) for the audio test meter. */
function useMicLevel(localStream: MediaStream | null, active: boolean): number {
  const [level, setLevel] = useState(0);

  useEffect(() => {
    if (!active || !localStream || localStream.getAudioTracks().length === 0) {
      return;
    }
    const Ctor =
      typeof AudioContext !== "undefined"
        ? AudioContext
        : (window as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
    if (!Ctor) return;

    let context: AudioContext;
    try {
      context = new Ctor();
    } catch {
      return;
    }
    void context.resume().catch(() => undefined);

    let analyser: AnalyserNode;
    try {
      const source = context.createMediaStreamSource(localStream);
      analyser = context.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
    } catch {
      void context.close().catch(() => undefined);
      return;
    }
    const data = new Uint8Array(analyser.fftSize);

    const timer = window.setInterval(() => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i += 1) {
        const sample = (data[i] - 128) / 128;
        sum += sample * sample;
      }
      setLevel(Math.min(1, Math.sqrt(sum / data.length) * 3));
    }, 120);

    return () => {
      window.clearInterval(timer);
      void context.close().catch(() => undefined);
    };
  }, [localStream, active]);

  return active ? level : 0;
}

function DeviceField({
  id,
  label,
  devices,
  value,
  disabled,
  emptyLabel,
  onChange,
}: {
  id: string;
  label: string;
  devices: MediaDeviceInfo[];
  value: string | null;
  disabled: boolean;
  emptyLabel: string;
  onChange: (deviceId: string) => void;
}) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className="select"
        value={value ?? ""}
        disabled={disabled || devices.length === 0}
        onChange={(event) => onChange(event.target.value)}
      >
        {devices.length === 0 ? (
          <option value="">{emptyLabel}</option>
        ) : (
          devices.map((device, index) => (
            <option key={device.deviceId} value={device.deviceId}>
              {deviceLabel(device, index)}
            </option>
          ))
        )}
      </select>
    </div>
  );
}

function ChoiceRow<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { key: T; label: string; hint?: string; icon?: React.ReactNode }[];
  value: T;
  onChange: (key: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className="settings__choices" role="radiogroup" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          type="button"
          key={option.key}
          role="radio"
          aria-checked={option.key === value}
          className={cx(
            "settings__choice",
            option.key === value && "settings__choice--selected"
          )}
          onClick={() => onChange(option.key)}
        >
          {option.icon ? <span className="settings__choice-icon">{option.icon}</span> : null}
          <span className="settings__choice-body">
            <span className="settings__choice-label">{option.label}</span>
            {option.hint ? (
              <span className="settings__choice-hint">{option.hint}</span>
            ) : null}
          </span>
        </button>
      ))}
    </div>
  );
}

/** Meeting settings modal; every control drives real behaviour. */
export function MeetingSettingsDialog({
  open,
  tab,
  onTabChange,
  devices,
  preferences,
  localStream,
  isFullscreen,
  fullscreenSupported,
  onSetLayout,
  onSetMirrorSelf,
  onToggleFullscreen,
  onClose,
}: MeetingSettingsDialogProps) {
  const [speakerFeedback, setSpeakerFeedback] = useState<string | null>(null);
  const level = useMicLevel(localStream, open && tab === "audio");

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const sinkSelectable =
    devices.canSelectSpeaker &&
    supportsSetSinkId() &&
    Boolean(devices.selectedAudioOutputId);

  const testSpeaker = async () => {
    const Ctor =
      typeof AudioContext !== "undefined"
        ? AudioContext
        : (window as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
    if (!Ctor) {
      setSpeakerFeedback("Audio output test is not supported by this browser.");
      return;
    }
    try {
      const context = new Ctor();
      await context.resume().catch(() => undefined);
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = 440;
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.18, context.currentTime + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.55);

      if (sinkSelectable) {
        const destination = context.createMediaStreamDestination();
        oscillator.connect(gain);
        gain.connect(destination);
        const element = new Audio() as HTMLMediaElement & {
          setSinkId?: (id: string) => Promise<void>;
        };
        element.srcObject = destination.stream;
        await element.setSinkId?.(devices.selectedAudioOutputId ?? "");
        await element.play();
        oscillator.start();
        window.setTimeout(() => {
          element.pause();
          void context.close().catch(() => undefined);
        }, 700);
        setSpeakerFeedback("Playing a test tone on the selected speaker.");
      } else {
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start();
        oscillator.stop(context.currentTime + 0.6);
        window.setTimeout(() => {
          void context.close().catch(() => undefined);
        }, 900);
        setSpeakerFeedback(
          devices.canSelectSpeaker
            ? "Playing a test tone on the default speaker."
            : "Playing a test tone — this browser cannot route audio to a chosen speaker."
        );
      }
    } catch {
      setSpeakerFeedback("Could not play the test tone.");
    }
  };

  return (
    <div
      className="settings-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="settings"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
      >
        <div className="settings__head">
          <h2 className="settings__title">Settings</h2>
          <button
            type="button"
            className="room-icon-button"
            aria-label="Close settings"
            onClick={onClose}
          >
            <XIcon size={18} />
          </button>
        </div>

        <div className="settings__tabs" role="tablist" aria-label="Settings sections">
          {TABS.map((entry) => (
            <button
              type="button"
              key={entry.key}
              role="tab"
              aria-selected={tab === entry.key}
              className={cx("settings__tab", tab === entry.key && "settings__tab--active")}
              onClick={() => onTabChange(entry.key)}
            >
              {entry.label}
            </button>
          ))}
        </div>

        <div className="settings__body">
          {tab === "video" ? (
            <div className="settings__section">
              <DeviceField
                id="settings-camera"
                label="Camera"
                devices={devices.videoInputDevices}
                value={devices.selectedVideoInputId}
                disabled={false}
                emptyLabel="No camera detected"
                onChange={devices.setVideoInput}
              />
              <label className="settings__toggle">
                <input
                  type="checkbox"
                  checked={preferences.mirrorSelf}
                  onChange={(event) => onSetMirrorSelf(event.target.checked)}
                />
                <span>Mirror my video</span>
              </label>
            </div>
          ) : null}

          {tab === "audio" ? (
            <div className="settings__section">
              <DeviceField
                id="settings-microphone"
                label="Microphone"
                devices={devices.audioInputDevices}
                value={devices.selectedAudioInputId}
                disabled={false}
                emptyLabel="No microphone detected"
                onChange={devices.setAudioInput}
              />
              <div className="field">
                <span className="field__label">Microphone level</span>
                <div
                  className="settings__meter"
                  role="meter"
                  aria-label="Microphone level"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(level * 100)}
                >
                  <div
                    className="settings__meter-fill"
                    style={{ width: `${Math.round(level * 100)}%` }}
                  />
                </div>
              </div>
              <DeviceField
                id="settings-speaker"
                label="Speaker"
                devices={devices.canSelectSpeaker ? devices.audioOutputDevices : []}
                value={devices.selectedAudioOutputId}
                disabled={!devices.canSelectSpeaker}
                emptyLabel={
                  devices.canSelectSpeaker
                    ? "No speaker detected"
                    : "Speaker selection is not supported by this browser"
                }
                onChange={devices.setAudioOutput}
              />
              <div className="settings__row">
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={() => void testSpeaker()}
                >
                  <VolumeIcon size={15} />
                  Test speaker
                </button>
                {speakerFeedback ? (
                  <span className="settings__hint">{speakerFeedback}</span>
                ) : null}
              </div>
            </div>
          ) : null}

          {tab === "meeting" ? (
            <div className="settings__section">
              <div className="field">
                <span className="field__label">Layout</span>
                <ChoiceRow
                  ariaLabel="Tile layout"
                  value={preferences.layout}
                  onChange={onSetLayout}
                  options={LAYOUT_OPTIONS}
                />
              </div>

            </div>
          ) : null}

          {tab === "general" ? (
            <div className="settings__section">
              {fullscreenSupported ? (
                <div className="settings__row">
                  <button
                    type="button"
                    className="btn btn--secondary btn--sm"
                    onClick={onToggleFullscreen}
                  >
                    {isFullscreen ? (
                      <MinimizeIcon size={15} />
                    ) : (
                      <MaximizeIcon size={15} />
                    )}
                    {isFullscreen ? "Exit full screen" : "Enter full screen"}
                  </button>
                </div>
              ) : (
                <p className="settings__hint">
                  Full screen is not available in this browser.
                </p>
              )}
              <div className="field">
                <span className="field__label">Keyboard shortcuts</span>
                <dl className="settings__shortcuts">
                  <div>
                    <dt><kbd>M</kbd></dt>
                    <dd>Mute / unmute the microphone</dd>
                  </div>
                  <div>
                    <dt><kbd>V</kbd></dt>
                    <dd>Start / stop the camera</dd>
                  </div>
                  <div>
                    <dt><kbd>P</kbd></dt>
                    <dd>Show / hide participants</dd>
                  </div>
                  <div>
                    <dt><kbd>F</kbd></dt>
                    <dd>Enter / exit full screen</dd>
                  </div>
                  <div>
                    <dt><kbd>Esc</kbd></dt>
                    <dd>Close the open panel or menu</dd>
                  </div>
                </dl>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
