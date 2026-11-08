import { CheckIcon } from "@/components/icons";

export type DeviceStatus = "on" | "off" | "connected" | "unavailable" | "pending";

const LABELS: Record<DeviceStatus, string> = {
  on: "On",
  off: "Off",
  connected: "Connected",
  unavailable: "Unavailable",
  pending: "Starting…",
};

/** Small pill describing a device's state; always text-labelled, never colour-only. */
export function DeviceStatusBadge({ status }: { status: DeviceStatus }) {
  return (
    <span className={`nm-badge nm-badge--${status}`} aria-live="polite">
      {status === "connected" || status === "on" ? <CheckIcon size={12} strokeWidth={2.5} /> : null}
      {LABELS[status]}
    </span>
  );
}
