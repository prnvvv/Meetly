import { deviceLabel } from "@/hooks/useMediaDevices";

interface DeviceSelectProps {
  id: string;
  label: string;
  devices: MediaDeviceInfo[];
  value: string | null;
  emptyLabel: string;
  disabled?: boolean;
  onChange: (deviceId: string) => void;
}

/** Native select (keyboard and screen-reader friendly) listing real devices. */
export function DeviceSelect({
  id,
  label,
  devices,
  value,
  emptyLabel,
  disabled = false,
  onChange,
}: DeviceSelectProps) {
  const empty = devices.length === 0;
  const selected = devices.some((device) => device.deviceId === value)
    ? (value as string)
    : (devices[0]?.deviceId ?? "");
  return (
    <select
      id={id}
      aria-label={label}
      className="select nm-select"
      value={empty ? "" : selected}
      disabled={disabled || empty}
      onChange={(event) => onChange(event.target.value)}
    >
      {empty ? (
        <option value="">{emptyLabel}</option>
      ) : (
        devices.map((device, index) => (
          <option key={device.deviceId || index} value={device.deviceId}>
            {deviceLabel(device, index)}
          </option>
        ))
      )}
    </select>
  );
}
