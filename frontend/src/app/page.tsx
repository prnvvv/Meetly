import { LANDING_CONTAINER } from "@/components/landing/container";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { HeroAuth } from "@/components/landing/HeroAuth";
import { Reveal } from "@/components/landing/Reveal";
import {
  CalendarIcon,
  UsersIcon,
  VideoIcon,
} from "@/components/icons";
import { CROWD_SRC, CrowdCanvas } from "@/components/ui/skiper39";
import { APP_NAME } from "@/lib/constants";

const FEATURES = [
  {
    icon: VideoIcon,
    title: "HD Meetings",
    text: "High-quality, low-latency video calls for seamless collaboration.",
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
];

const STEPS = [
  { n: "01", title: "Create", text: "Start an instant meeting or schedule one for later." },
  { n: "02", title: "Share", text: "Send the meeting link or ID to anyone you want to invite." },
  { n: "03", title: "Meet", text: "Join from your browser, no downloads and no fuss." },
];

export default function Home() {
  return (
    <div className="landing min-h-screen bg-white text-black" id="top">
      {/* Hero: copy on top, the walking-crowd canvas (the page background)
          fills its own band beneath so the two never overlap. */}
      <section className="relative overflow-hidden border-b border-neutral-200">
        <div className={`relative z-10 ${LANDING_CONTAINER} pb-6 pt-8 sm:pt-10 lg:pt-10`}>
          {/* Two-column hero. The copy hugs the centre line from the left and
              the Clerk card from the right, so the gap is always one
              deliberate value; both share a vertical centre. */}
          <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-14">
            <div className="landing-rise w-fit max-w-full lg:justify-self-end">
              <h1 className="text-[clamp(2.6rem,1rem+3.4vw,3.75rem)] font-extrabold leading-[1.06] tracking-[-0.03em]">
                Meet, Schedule
                <br />
                and Collaborate
                <br />
                with {APP_NAME}
              </h1>
              <p className="mt-6 max-w-[520px] text-[clamp(1.125rem,1rem+0.3vw,1.25rem)] leading-[1.6] text-neutral-500">
                A simple and reliable platform for video meetings, smart
                scheduling, and team collaboration.
              </p>
            </div>
            <div className="lg:justify-self-start">
              <HeroAuth />
            </div>
          </div>
        </div>

        <div className="relative h-[310px] w-full sm:h-[340px] lg:h-[360px]">
          <CrowdCanvas
            src={CROWD_SRC}
            rows={15}
            cols={7}
            scale={0.95}
            fit
            className="pointer-events-none absolute inset-0 h-full w-full"
          />
        </div>
      </section>

      <section id="features" className="scroll-mt-8 bg-white">
        <div className={`${LANDING_CONTAINER} py-14 md:py-16`}>
          <Reveal>
            <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
              Everything you need to meet
            </h2>
          </Reveal>
          <div className="mt-8 grid gap-5 md:grid-cols-3 md:gap-6">
            {FEATURES.map(({ icon: Icon, title, text }, i) => (
              <Reveal key={title} delay={i * 100} className="h-full">
                <article className="group flex h-full flex-col rounded-2xl border border-neutral-200 bg-white p-7 transition-colors duration-200 hover:border-black lg:p-8">
                  <span className="grid size-14 place-items-center rounded-xl bg-neutral-100 text-black transition-colors duration-200 group-hover:bg-black group-hover:text-white">
                    <Icon size={26} />
                  </span>
                  <h3 className="mt-6 text-xl font-extrabold tracking-tight">{title}</h3>
                  <p className="mt-2 text-base leading-relaxed text-neutral-600">{text}</p>
                </article>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section id="how-it-works" className="scroll-mt-8 border-t border-neutral-200 bg-white">
        <div className={`${LANDING_CONTAINER} py-14 md:py-16`}>
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
