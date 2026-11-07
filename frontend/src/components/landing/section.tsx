import { LANDING_CONTAINER } from "./container";
import { Reveal } from "./Reveal";

/**
 * Single design system for every landing section below the hero crowd.
 * All of them are built from these pieces so spacing, background, borders,
 * headings and cards stay identical.
 */

/** Rounded content card used by every section. */
export const sectionCard =
  "rounded-3xl border border-white/15 bg-white/[0.03] transition-colors duration-300 hover:border-white/45";

/** White icon tile with a black icon. */
export const iconTile =
  "grid size-12 shrink-0 place-items-center rounded-2xl bg-white text-black";

export const cardTitle = "text-xl font-extrabold tracking-tight text-white";
export const cardText = "text-base leading-relaxed text-white/65";

export const buttonPrimary =
  "inline-flex h-12 items-center gap-2 rounded-lg border border-white bg-white px-6 text-[15px] font-semibold text-black no-underline transition-colors hover:bg-white/85 hover:no-underline";
export const buttonSecondary =
  "inline-flex h-12 items-center gap-2 rounded-lg border border-white/40 bg-transparent px-6 text-[15px] font-semibold text-white no-underline transition-colors hover:border-white hover:bg-white/10 hover:no-underline";

/** Full-width black section with the shared container and vertical rhythm. */
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
      className="scroll-mt-20 border-t border-white/10 bg-black text-white"
    >
      <div className={`${LANDING_CONTAINER} py-16 md:py-24 ${className}`}>
        {children}
      </div>
    </section>
  );
}

/** Eyebrow pill + heading + optional intro, identical in every section. */
export function SectionHeader({
  eyebrow,
  title,
  children,
  className = "",
}: {
  eyebrow: string;
  title: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <Reveal className={`max-w-2xl ${className}`}>
      <span className="inline-flex h-8 items-center rounded-full border border-white/25 px-4 text-xs font-semibold uppercase tracking-[0.14em] text-white/70">
        {eyebrow}
      </span>
      <h2 className="mt-5 text-[clamp(1.875rem,3.2vw,2.75rem)] font-extrabold leading-[1.1] tracking-[-0.03em] text-white">
        {title}
      </h2>
      {children && (
        <p className="mt-4 text-base leading-relaxed text-white/60 sm:text-lg">
          {children}
        </p>
      )}
    </Reveal>
  );
}
