import type { ReactNode } from "react";
import { DeviceStatusBadge, type DeviceStatus } from "./DeviceStatusBadge";
import { SwitchControl } from "./MeetingSettingsList";

interface DeviceSetupRowProps {
  label: string;
  icon: ReactNode;
  /** The DeviceSelect for this row. */
  select: ReactNode;
  status: DeviceStatus;
  /** When provided the row shows an on/off switch (camera, microphone). */
  toggle?: {
    checked: boolean;
    disabled?: boolean;
    onChange: (next: boolean) => void;
  };
}

/** Icon + label, device dropdown and status, on one aligned line. */
export function DeviceSetupRow({ label, icon, select, status, toggle }: DeviceSetupRowProps) {
  return (
    <div className="nm-device">
      <span className="nm-device__label">
        <span className="nm-device__icon">{icon}</span>
        {label}
      </span>
      <div className="nm-device__select">{select}</div>
      <div className="nm-device__status">
        <DeviceStatusBadge status={status} />
        {toggle ? (
          <SwitchControl
            checked={toggle.checked}
            label={`${label} ${toggle.checked ? "on" : "off"}`}
            disabled={toggle.disabled}
            onChange={toggle.onChange}
          />
        ) : null}
      </div>
    </div>
  );
}
