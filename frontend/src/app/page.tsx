import { LANDING_CONTAINER } from "@/components/landing/container";
import { CrowdBand } from "@/components/landing/CrowdBand";
import { LandingNav } from "@/components/landing/LandingNav";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { HeroAuth } from "@/components/landing/HeroAuth";
import { Reveal } from "@/components/landing/Reveal";
import {
  CalendarIcon,
  SparklesIcon,
  UsersIcon,
  VideoIcon,
} from "@/components/icons";
import { APP_NAME } from "@/lib/constants";

const FEATURES = [
  {
    icon: VideoIcon,
    title: "HD Meetings",
    text: "Crystal-clear, low-latency video calls for seamless collaboration.",
  },
  {
    icon: CalendarIcon,
    title: "Smart Scheduling",
    text: "Plan, manage, and get reminders for your meetings with ease.",
  },
  {
    icon: UsersIcon,
    title: "Team Collaboration",
    text: "Share links, notes, and resources to keep your team in sync.",
  },
  {
    icon: SparklesIcon,
    title: "AI Meeting Rooms",
    text: "AI-powered meeting rooms with smart notes, summaries, and action items.",
    soon: true,
  },
];

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
  { n: "01", title: "Create", text: "Start an instant meeting or schedule one for later." },
  { n: "02", title: "Share", text: "Send the meeting link or ID to anyone you want to invite." },
  { n: "03", title: "Meet", text: "Join from your browser, no downloads and no fuss." },
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

      <section id="features" className="scroll-mt-8 bg-white">
        <div className={`${LANDING_CONTAINER} py-16 md:py-20`}>
          <Reveal>
            <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
              Everything you need to meet
            </h2>
          </Reveal>
          <div className="mt-8 grid gap-5 sm:max-lg:grid-cols-2 lg:grid-cols-4 lg:gap-6">
            {FEATURES.map(({ icon: Icon, title, text, soon }, i) => (
              <Reveal key={title} delay={i * 100} className="h-full">
                <article className="group flex h-full flex-col rounded-2xl border border-neutral-200 bg-white p-7 transition-colors duration-200 hover:border-black xl:p-8">
                  <span className="grid size-14 place-items-center rounded-xl bg-neutral-100 text-black transition-colors duration-200 group-hover:bg-black group-hover:text-white">
                    <Icon size={26} />
                  </span>
                  <h3 className="mt-6 flex flex-wrap items-center gap-2 text-xl font-extrabold tracking-tight">
                    {title}
                    {soon && (
                      <span className="rounded-full border border-neutral-300 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                        Coming soon
                      </span>
                    )}
                  </h3>
                  <p className="mt-2 text-base leading-relaxed text-neutral-600">{text}</p>
                </article>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section id="how-it-works" className="scroll-mt-8 border-t border-neutral-200 bg-white">
        <div className={`${LANDING_CONTAINER} py-16 md:py-20`}>
          <Reveal>
            <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl">How it works</h2>
          </Reveal>
          <ol className="mt-8 grid gap-5 md:grid-cols-3 md:gap-12">
            {STEPS.map((s, i) => (
              <li key={s.n} className="relative">
                <Reveal delay={i * 100} className="h-full">
                  <div className="h-full rounded-2xl border border-black p-7 lg:p-8">
                    <span className="grid size-10 place-items-center rounded-full bg-black text-sm font-bold text-white">
                      {s.n}
                    </span>
                    <h3 className="mt-6 text-2xl font-extrabold tracking-tight">{s.title}</h3>
                    <p className="mt-2 text-base leading-relaxed text-neutral-600">{s.text}</p>
                  </div>
                </Reveal>
                {i < STEPS.length - 1 && (
                  <span
                    aria-hidden="true"
                    className="absolute -right-12 top-1/2 hidden h-px w-12 bg-neutral-300 md:block"
                  />
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
