import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "@/lib/utils";

export type ControlTone = "neutral" | "active" | "off" | "danger";

/**
 * How a control sits in the dock:
 * - `media` — the two live-media controls (mic, camera), filled.
 * - `tool`  — quiet tools, no fill.
 * - `end`   — the red destructive action.
 * All variants are icon-only: the label is the tooltip and accessible name.
 */
export type ControlVariant = "media" | "tool" | "end";

interface MediaControlButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children"> {
  /** Icon element — pass it at the shared toolbar icon size (20). */
  icon: ReactNode;
  /** Tooltip and screen-reader text (never rendered as visible wording). */
  label: string;
  variant?: ControlVariant;
  /**
   * Visual state:
   * - `active`  — feature is on (mic live, camera on, panel open)
   * - `off`     — feature is off / not joined yet (muted charcoal, slashed icon)
   * - `danger`  — destructive action (leave / end)
   * - `neutral` — plain action
   */
  tone?: ControlTone;
  /** The device could not be acquired; adds a distinct dashed outline. */
  unavailable?: boolean;
  /** A media request (permission prompt / capture) is in flight. */
  busy?: boolean;
  /** Lower-priority control that folds into the More menu on small screens. */
  secondary?: boolean;
  className?: string;
}

/** Icon size shared by every toolbar button, so weights never drift apart. */
export const CONTROL_ICON_SIZE = 20;

/**
 * One dock control. All of them go through this component so geometry, states
 * and focus rings stay identical. The accessible name comes from `aria-label`
 * (or the caption).
 */
export function MediaControlButton({
  icon,
  label,
  variant = "tool",
  tone = "neutral",
  unavailable = false,
  secondary = false,
  busy = false,
  className,
  type = "button",
  ...buttonProps
}: MediaControlButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        "control",
        `control--${variant}`,
        tone !== "neutral" && `control--${tone}`,
        unavailable && "control--unavailable",
        secondary && "control--secondary",
        busy && "control--busy",
        className
      )}
      data-tip={label}
      aria-busy={busy || undefined}
      {...buttonProps}
    >
      <span className="control__icon">
        {busy ? <span className="control__spinner" aria-hidden="true" /> : icon}
      </span>
      <span className="control__label">{label}</span>
    </button>
  );
}
