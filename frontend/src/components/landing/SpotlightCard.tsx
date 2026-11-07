"use client";

import { useRef } from "react";
import { sectionCard } from "./section";

/**
 * The shared section card plus a soft spotlight that follows the cursor.
 * Pure decoration: pointer-events are off on the glow and it is hidden
 * unless the card is hovered.
 */
export function SpotlightCard({
  className = "",
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
  };

  return (
    <div
      ref={ref}
      onMouseMove={onMove}
      className={`${sectionCard} relative overflow-hidden ${className}`}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          background:
            "radial-gradient(280px circle at var(--mx, 50%) var(--my, 50%), rgba(0,0,0,0.055), transparent 70%)",
        }}
      />
      {children}
    </div>
  );
}
