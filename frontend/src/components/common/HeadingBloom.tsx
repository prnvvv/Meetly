import type { CSSProperties } from "react";

/**
 * Three-ray accent shown at the top right of a page heading (same as the landing
 * page headline). Place it inside a `relative inline-block` span that wraps the
 * heading's last word; it positions itself against that word.
 */
export function HeadingBloom() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 48 48"
      className="pointer-events-none absolute left-full top-0 ml-[0.02em] hidden h-[0.95em] w-[0.95em] -translate-y-[54%] overflow-visible sm:block"
      fill="none"
      stroke="currentColor"
      strokeWidth="4"
      strokeLinecap="round"
    >
      <path className="bloom-ray" style={{ "--i": 0 } as CSSProperties} pathLength={1} d="M6.9 32 L8.1 8.1" />
      <path className="bloom-ray" style={{ "--i": 1 } as CSSProperties} pathLength={1} d="M13.1 33.6 L31.7 11.4" />
      <path className="bloom-ray" style={{ "--i": 2 } as CSSProperties} pathLength={1} d="M15.7 39.4 L38.8 33.2" />
    </svg>
  );
}
