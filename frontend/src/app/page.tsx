import { LANDING_CONTAINER } from "@/components/landing/container";
import { CrowdBand } from "@/components/landing/CrowdBand";
import { LandingNav } from "@/components/landing/LandingNav";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { HeroAuth } from "@/components/landing/HeroAuth";
import { Reveal } from "@/components/landing/Reveal";
import {
  CalendarIcon,
  LinkIcon,
  PlusIcon,
  SparklesIcon,
  UsersIcon,
  VideoIcon,
} from "@/components/icons";
import { APP_NAME } from "@/lib/constants";

const HERO_HIGHLIGHTS: { icon: typeof VideoIcon; title: string; hint?: string }[] = [
  { icon: VideoIcon, title: "HD Meetings" },
  { icon: CalendarIcon, title: "Smart Scheduling" },
  { icon: UsersIcon, title: "Team Collaboration" },
  {
    icon: SparklesIcon,
    title: "AI Meeting Rooms",
    hint: "AI-powered notes, summaries and action items",
  },
];

const STEPS = [
  { n: "01", icon: PlusIcon, title: "Create", text: "Start an instant meeting or schedule one for later." },
  { n: "02", icon: LinkIcon, title: "Share", text: "Send the meeting link or ID to anyone you want to invite." },
  { n: "03", icon: VideoIcon, title: "Meet", text: "Join from your browser, no downloads and no fuss." },
];

export default function Home() {
  return (
    <div className="landing min-h-screen bg-white text-black" id="top">
      <LandingNav />

      {/* Hero: marketing copy (left) and the real Clerk sign-in (right) in one
          grid; the crowd band below is its own flow element, so nothing
          overlaps and nothing depends on viewport height. */}
      <section
        className="relative overflow-hidden border-b border-neutral-200"
        style={{ "--hero-lead": "29rem" } as React.CSSProperties}
      >
        <div className={`relative z-10 ${LANDING_CONTAINER} pb-6 pt-6 sm:pt-8 lg:pb-6 lg:pt-10`}>
          <div className="grid items-center gap-10 min-[1200px]:grid-cols-[56fr_44fr] min-[1200px]:gap-[clamp(48px,4vw,64px)]">
            <div className="landing-rise @container min-w-0 min-[1200px]:ml-auto min-[1200px]:w-[92%] min-[1200px]:[zoom:0.92]">
              <span className="inline-flex h-11 items-center gap-2 rounded-full bg-[#f5f5f5] px-5 text-[15px] font-semibold text-black sm:text-base">
                <SparklesIcon size={18} />
                All-in-One Meeting Platform
              </span>

              <h1 className="mt-6 text-[length:clamp(2.25rem,9.2cqw,4.125rem)] font-extrabold leading-[1.05] tracking-[-0.05em] text-black">
                Meet, Schedule{" "}
                <span className="relative inline-block">
                  and
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 48 48"
                    className="pointer-events-none absolute left-full top-0 ml-[0.02em] hidden h-[0.95em] w-[0.95em] -translate-y-[54%] overflow-visible sm:block"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="4"
                    strokeLinecap="round"
                  >
                    {/* Three rays fanning out from one point at the top-right of "and". */}
                    <path className="bloom-ray" style={{ "--i": 0 } as React.CSSProperties} pathLength={1} d="M6.9 32 L8.1 8.1" />
                    <path className="bloom-ray" style={{ "--i": 1 } as React.CSSProperties} pathLength={1} d="M13.1 33.6 L31.7 11.4" />
                    <path className="bloom-ray" style={{ "--i": 2 } as React.CSSProperties} pathLength={1} d="M15.7 39.4 L38.8 33.2" />
                  </svg>
                </span>
                <br className="hidden md:block" /> Collaborate with{" "}
                <span className="relative inline-block whitespace-nowrap">
                  {APP_NAME}
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 200 14"
                    preserveAspectRatio="none"
                    className="pointer-events-none absolute -bottom-[0.14em] left-0 h-[0.2em] w-full"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3.5"
                    strokeLinecap="round"
                  >
                    <path
                      d="M3 9 C 40 1, 80 13, 120 6 S 180 4, 197 8"
                      vectorEffect="non-scaling-stroke"
                    />
                  </svg>
                </span>
              </h1>

              <p className="mt-7 max-w-[650px] text-[clamp(1.0625rem,1.55vw,1.4rem)] leading-[1.5] text-[#686868]">
                A simple and reliable platform for video meetings, smart
                scheduling, and team collaboration.
              </p>

              {/* Compact capability strip: one row on desktop (labels never wrap),
                  2x2 on phones. */}
              <ul id="features" className="mt-9 scroll-mt-28 grid grid-cols-2 gap-x-4 gap-y-5 sm:flex sm:items-stretch sm:gap-0">
                {HERO_HIGHLIGHTS.map(({ icon: Icon, title, hint }, i) => (
                  <li
                    key={title}
                    title={hint}
                    className={`flex items-center gap-3 sm:flex-1 sm:flex-col sm:items-start sm:gap-2.5 sm:px-4 ${
                      i === 0 ? "sm:pl-0" : "sm:border-l sm:border-[#e8e8e8]"
                    } ${i === HERO_HIGHLIGHTS.length - 1 ? "sm:pr-0" : ""}`}
                  >
                    <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#f5f5f5] text-black">
                      <Icon size={20} />
                    </span>
                    <span className="text-[14px] font-semibold leading-tight text-black sm:whitespace-nowrap sm:text-[15px]">
                      {title}
                    </span>
                    {hint && <span className="sr-only">{hint}</span>}
                  </li>
                ))}
              </ul>
            </div>

            <HeroAuth />
          </div>
        </div>

        {/* Stacked layouts keep fixed band heights. From 1200px the band takes the
            viewport height left under the hero content (29rem = nav-less content
            block), clamped so it never gets huge or too short: the same composition
            fits whether the window is fullscreen or not. */}
        <CrowdBand className="h-[320px] sm:max-lg:h-[360px] lg:max-[1199px]:h-[400px] min-[1200px]:h-[clamp(240px,calc(100svh-5rem-var(--hero-lead)),400px)]" />
      </section>

      {/* How it works: an inverted black band that breaks up the long white
          scroll; three linked steps with outlined numerals. */}
      <section id="how-it-works" className="scroll-mt-8 bg-black text-white">
        <div className={`${LANDING_CONTAINER} py-16 md:py-24`}>
          <Reveal className="max-w-2xl">
            <span className="inline-flex h-8 items-center rounded-full border border-white/25 px-4 text-xs font-semibold uppercase tracking-[0.14em] text-white/70">
              How it works
            </span>
            <h2 className="mt-5 text-[clamp(1.875rem,3.2vw,2.75rem)] font-extrabold leading-[1.1] tracking-[-0.03em]">
              From idea to meeting in three simple steps
            </h2>
            <p className="mt-4 text-base leading-relaxed text-white/60 sm:text-lg">
              No downloads, no setup. Start, share and join right from your browser.
            </p>
          </Reveal>

          <ol className="mt-12 grid gap-5 md:mt-14 md:grid-cols-3 md:gap-14">
            {STEPS.map(({ n, icon: Icon, title, text }, i) => (
              <li key={n} className="relative">
                <Reveal delay={i * 120} className="h-full">
                  <div className="group relative h-full overflow-hidden rounded-3xl border border-white/15 bg-white/[0.03] p-7 transition-colors duration-300 hover:border-white/45 lg:p-8">
                    <div className="flex items-start justify-between">
                      <span className="grid size-12 place-items-center rounded-2xl bg-white text-black transition-transform duration-300 group-hover:-rotate-6">
                        <Icon size={22} />
                      </span>
                      <span
                        aria-hidden="true"
                        className="select-none text-[4.5rem] font-extrabold leading-[0.8] tracking-[-0.04em] text-transparent [-webkit-text-stroke:1.5px_rgba(255,255,255,0.28)] transition-[-webkit-text-stroke-color] duration-300 group-hover:[-webkit-text-stroke-color:rgba(255,255,255,0.7)]"
                      >
                        {n}
                      </span>
                    </div>
                    <h3 className="mt-8 text-2xl font-extrabold tracking-tight">{title}</h3>
                    <p className="mt-2 text-base leading-relaxed text-white/65">{text}</p>
                  </div>
                </Reveal>

                {/* connector to the next step: line ending in an arrowhead */}
                {i < STEPS.length - 1 && (
                  <span
                    aria-hidden="true"
                    className="absolute -right-14 top-1/2 hidden h-px w-14 bg-white/30 md:block"
                  >
                    <span className="absolute -right-px -top-[3px] size-[7px] rotate-45 border-r border-t border-white/60" />
                  </span>
                )}
              </li>
            ))}
          </ol>
        </div>
      </section>

      <LandingFooter />
    </div>
  );
}
