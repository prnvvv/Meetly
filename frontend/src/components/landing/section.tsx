import { LANDING_CONTAINER } from "./container";
import { Reveal } from "./Reveal";

/**
 * Single design system for every landing section below the hero crowd:
 * white page, graph-paper dots, hairline dividers, black used as the accent.
 * All sections are built from these pieces so they cannot drift apart.
 */

/** Rounded content card (hover: lifts, border turns black, icon tile inverts). */
export const sectionCard =
  "group rounded-3xl border border-[#e8e8e8] bg-white transition-all duration-300 hover:-translate-y-1 hover:border-black hover:shadow-[0_22px_44px_-26px_rgba(0,0,0,0.4)]";

/** Grey icon tile that turns black when its card is hovered (same as the hero strip). */
export const iconTile =
  "grid size-12 shrink-0 place-items-center rounded-2xl bg-[#f5f5f5] text-black transition-colors duration-300 group-hover:bg-black group-hover:text-white";

export const cardTitle = "text-xl font-extrabold tracking-tight text-black";
export const cardText = "text-base leading-relaxed text-[#686868]";

export const buttonPrimary =
  "inline-flex h-12 items-center gap-2 rounded-lg border border-black bg-black px-6 text-[15px] font-semibold text-white no-underline transition-all duration-200 hover:-translate-y-0.5 hover:bg-neutral-800 hover:no-underline";
export const buttonSecondary =
  "inline-flex h-12 items-center gap-2 rounded-lg border border-black bg-white px-6 text-[15px] font-semibold text-black no-underline transition-all duration-200 hover:-translate-y-0.5 hover:bg-neutral-100 hover:no-underline";

/** White section with a faint dotted grid that fades out at its top and bottom. */
export function Section({
  id,
  className = "",
  children,
}: {
  id?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className="relative scroll-mt-20 border-t border-[#e8e8e8] bg-white"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 [background-image:radial-gradient(#e2e2e2_1px,transparent_1px)] [background-size:22px_22px] [mask-image:linear-gradient(to_bottom,transparent,black_20%,black_80%,transparent)]"
      />
      <div
        className={`${LANDING_CONTAINER} relative py-16 md:py-24 ${className}`}
      >
        {children}
      </div>
    </section>
  );
}

/** A word with a hand-drawn underline that draws itself when its Reveal shows. */
export function Scribble({ children }: { children: React.ReactNode }) {
  return (
    <span className="relative inline-block whitespace-nowrap">
      {children}
      <svg
        aria-hidden="true"
        viewBox="0 0 200 14"
        preserveAspectRatio="none"
        className="pointer-events-none absolute -bottom-[0.14em] left-0 h-[0.2em] w-full overflow-visible"
        fill="none"
        stroke="currentColor"
        strokeWidth="3.5"
        strokeLinecap="round"
      >
        <path
          className="scribble-path"
          pathLength={1}
          d="M3 9 C 40 1, 80 13, 120 6 S 180 4, 197 8"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </span>
  );
}

/** Eyebrow pill (with a live dot) + heading + optional intro, identical everywhere. */
export function SectionHeader({
  eyebrow,
  title,
  children,
  className = "",
}: {
  eyebrow: string;
  title: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <Reveal className={`max-w-2xl ${className}`}>
      <span className="inline-flex h-8 items-center gap-2 rounded-full border border-[#dcdcdc] bg-white px-4 text-xs font-semibold uppercase tracking-[0.14em] text-[#686868]">
        <span className="relative flex size-1.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-black/40 motion-reduce:animate-none" />
          <span className="relative inline-flex size-1.5 rounded-full bg-black" />
        </span>
        {eyebrow}
      </span>
      <h2 className="mt-5 text-[clamp(1.875rem,3.2vw,2.75rem)] font-extrabold leading-[1.1] tracking-[-0.03em] text-black">
        {title}
      </h2>
      {children && (
        <p className="mt-4 text-base leading-relaxed text-[#686868] sm:text-lg">
          {children}
        </p>
      )}
    </Reveal>
  );
}
