import { LANDING_CONTAINER } from "@/components/landing/container";
import { CrowdBand } from "@/components/landing/CrowdBand";
import { AboutSection } from "@/components/landing/AboutSection";
import { FeaturesSection } from "@/components/landing/FeaturesSection";
import { HowItWorksSection } from "@/components/landing/HowItWorksSection";
import { SolutionsSection } from "@/components/landing/SolutionsSection";
import { LandingNav } from "@/components/landing/LandingNav";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { HeroAuth } from "@/components/landing/HeroAuth";
import {
  CalendarIcon,
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
              <ul className="mt-9 grid grid-cols-2 gap-x-4 gap-y-5 sm:flex sm:items-stretch sm:gap-0">
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

      <FeaturesSection />

      <SolutionsSection />

      <HowItWorksSection />

      <AboutSection />

      <LandingFooter />
    </div>
  );
}
