import type { ComponentType } from "react";
import {
  ClockIcon,
  LockIcon,
  MessageIcon,
  MicIcon,
  MicOffIcon,
  RecordIcon,
  ScreenShareIcon,
  SlidersIcon,
  type IconProps,
} from "@/components/icons";

/**
 * Shared definitions for the meeting settings: state shape, defaults, which
 * settings the server enforces, the copy for each, and the switch control.
 * EssentialMeetingSettings and MoreMeetingSettings render subsets of this.
 */
export interface MeetingSettings {
  waitingRoom: boolean;
  lockMeeting: boolean;
  muteOnEntry: boolean;
  allowUnmute: boolean;
  allowScreenShare: boolean;
  allowChat: boolean;
  hostControls: boolean;
  record: boolean;
}

export type SettingKey = keyof MeetingSettings;

/** Defaults keep today's behaviour: an open room where everyone can talk, chat and share. */
export const DEFAULT_MEETING_SETTINGS: MeetingSettings = {
  waitingRoom: false,
  lockMeeting: false,
  muteOnEntry: false,
  allowUnmute: true,
  allowScreenShare: true,
  allowChat: true,
  hostControls: true,
  record: false,
};

/**
 * Which settings the server enforces today. The meeting API only accepts a
 * title and password, so every preference is stored with the meeting but none
 * is enforced yet; the UI says so instead of implying otherwise.
 */
export const ENFORCED_SETTINGS: Record<SettingKey, boolean> = {
  waitingRoom: false,
  lockMeeting: false,
  muteOnEntry: false,
  allowUnmute: false,
  allowScreenShare: false,
  allowChat: false,
  hostControls: false,
  record: false,
};

export interface SettingDefinition {
  key: SettingKey;
  title: string;
  hint: string;
  icon: ComponentType<IconProps>;
}

export const SETTING_DEFINITIONS: Record<SettingKey, SettingDefinition> = {
  waitingRoom: { key: "waitingRoom", title: "Waiting room", hint: "Approve people before they join.", icon: ClockIcon },
  allowUnmute: { key: "allowUnmute", title: "Allow unmuting", hint: "Let participants unmute themselves.", icon: MicIcon },
  allowChat: { key: "allowChat", title: "Participant chat", hint: "Allow in-meeting messages.", icon: MessageIcon },
  allowScreenShare: { key: "allowScreenShare", title: "Screen sharing", hint: "Let participants share their screen.", icon: ScreenShareIcon },
  lockMeeting: { key: "lockMeeting", title: "Lock meeting", hint: "Block new joiners once locked.", icon: LockIcon },
  muteOnEntry: { key: "muteOnEntry", title: "Mute on entry", hint: "Mute people as they join.", icon: MicOffIcon },
  hostControls: { key: "hostControls", title: "Host controls", hint: "Mute and remove participants.", icon: SlidersIcon },
  record: { key: "record", title: "Record meeting", hint: "Save a recording afterwards.", icon: RecordIcon },
};

/** Shown directly on the page. Everything else lives in the More settings popover. */
export const ESSENTIAL_KEYS: SettingKey[] = ["waitingRoom", "allowUnmute", "allowChat", "allowScreenShare"];

/** Remaining settings, grouped; no key appears in both lists. */
export const MORE_GROUPS: { label: string; keys: SettingKey[] }[] = [
  { label: "Access", keys: ["lockMeeting"] },
  { label: "Participants", keys: ["muteOnEntry"] },
  { label: "Host", keys: ["hostControls", "record"] },
];

interface SwitchControlProps {
  checked: boolean;
  label: string;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}

/** Accessible on/off switch (role="switch"), styled in the Meetly monochrome. */
export function SwitchControl({ checked, label, disabled = false, onChange }: SwitchControlProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={checked ? "nm-switch nm-switch--on" : "nm-switch"}
      onClick={() => onChange(!checked)}
    >
      <span className="nm-switch__thumb" />
    </button>
  );
}

interface SettingTileProps {
  definition: SettingDefinition;
  checked: boolean;
  disabled?: boolean;
  onChange: (key: SettingKey, value: boolean) => void;
}

/** Icon, title (+ "Soon" tag when not enforced), hint and switch: one row/tile. */
export function SettingTile({ definition, checked, disabled = false, onChange }: SettingTileProps) {
  const { key, title, hint, icon: Icon } = definition;
  return (
    <li className="nm-setting">
      <span className="nm-setting__icon">
        <Icon size={17} />
      </span>
      <span className="nm-setting__text">
        <span className="nm-setting__title">
          {title}
          {ENFORCED_SETTINGS[key] ? null : (
            <span className="nm-soon" title="Saved with your meeting; not enforced by the server yet.">
              Soon
            </span>
          )}
        </span>
        <span className="nm-setting__hint">{hint}</span>
      </span>
      <SwitchControl checked={checked} label={title} disabled={disabled} onChange={(next) => onChange(key, next)} />
    </li>
  );
}
