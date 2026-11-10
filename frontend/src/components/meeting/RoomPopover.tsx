"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "@/lib/utils";

interface RoomPopoverProps {
  /** Accessible name for the trigger and the panel. */
  label: string;
  /** Horizontal alignment of the panel over its trigger. */
  align?: "start" | "center" | "end";
  /** Receives the props to spread onto the trigger element. */
  trigger: (props: {
    open: boolean;
    onToggle: () => void;
    "aria-expanded": boolean;
    "aria-haspopup": "menu";
  }) => ReactNode;
  /** Panel content; a function receives `close` so items can dismiss it. */
  children: ReactNode | ((close: () => void) => ReactNode);
  className?: string;
}

/**
 * Dark meeting-room dropdown anchored above its trigger (toolbar buttons sit
 * at the bottom of the viewport). Closes on outside click, Escape and
 * selection. Only one popover needs to be open at a time in practice, so each
 * instance also closes when another one opens.
 */
export function RoomPopover({
  label,
  align = "center",
  trigger,
  children,
  className,
}: RoomPopoverProps) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (anchorRef.current && target && anchorRef.current.contains(target)) {
        return;
      }
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <div className={cx("room-popover-anchor", className)} ref={anchorRef}>
      {trigger({
        open,
        onToggle: () => setOpen((value) => !value),
        "aria-expanded": open,
        "aria-haspopup": "menu",
      })}
      {open ? (
        <div
          className={cx("room-popover", `room-popover--${align}`)}
          role="menu"
          aria-label={label}
        >
          {typeof children === "function" ? children(close) : children}
        </div>
      ) : null}
    </div>
  );
}

interface RoomMenuItemProps {
  onSelect: () => void;
  children: ReactNode;
  /** Renders the checked state for single-choice groups. */
  checked?: boolean;
  danger?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  className?: string;
}

/** One row inside a room popover. */
export function RoomMenuItem({
  onSelect,
  children,
  checked,
  danger,
  disabled,
  icon,
  className,
}: RoomMenuItemProps) {
  return (
    <button
      type="button"
      role={checked === undefined ? "menuitem" : "menuitemradio"}
      aria-checked={checked}
      aria-disabled={disabled || undefined}
      className={cx(
        "room-menu__item",
        danger && "room-menu__item--danger",
        disabled && "room-menu__item--disabled",
        className
      )}
      onClick={() => {
        if (disabled) return;
        onSelect();
      }}
    >
      {icon ? <span className="room-menu__icon">{icon}</span> : null}
      <span className="room-menu__label">{children}</span>
      {checked ? <span className="room-menu__check" aria-hidden="true" /> : null}
    </button>
  );
}

/** Separates groups of related actions inside a popover. */
export function RoomMenuDivider() {
  return <div className="room-menu__divider" role="separator" />;
}

/** Small uppercase caption above a group of items. */
export function RoomMenuLabel({ children }: { children: ReactNode }) {
  return <div className="room-menu__caption">{children}</div>;
}
