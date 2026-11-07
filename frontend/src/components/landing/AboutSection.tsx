import { ArrowRightIcon, LinkIcon, ShieldIcon, VideoIcon } from "@/components/icons";
import { APP_NAME } from "@/lib/constants";
import { LANDING_CONTAINER } from "./container";
import { Reveal } from "./Reveal";

const PRINCIPLES = [
  {
    icon: VideoIcon,
    title: "Browser-based",
    text: "Nothing to download or install. Open a link and you are in the meeting.",
  },
  {
    icon: ShieldIcon,
    title: "Sign-in handled by Clerk",
    text: "Authentication is delegated to Clerk, so accounts and sessions use a proven, managed service.",
  },
  {
    icon: LinkIcon,
    title: "Open source",
    text: "The code is public on GitHub, so you can read how it works and follow along.",
  },
];

const STACK = ["Next.js", "FastAPI", "WebRTC", "WebSockets", "Clerk"];

export function AboutSection() {
  return (
    <section id="about" className="scroll-mt-20 bg-white">
      <div
        className={`${LANDING_CONTAINER} grid gap-12 py-16 md:py-24 lg:grid-cols-2 lg:gap-20`}
      >
        <Reveal>
          <span className="inline-flex h-8 items-center rounded-full border border-neutral-300 px-4 text-xs font-semibold uppercase tracking-[0.14em] text-neutral-600">
            About
          </span>
          <h2 className="mt-5 text-[clamp(1.875rem,3.2vw,2.75rem)] font-extrabold leading-[1.1] tracking-[-0.03em]">
            A simple place to meet, schedule and collaborate
          </h2>
          <p className="mt-5 max-w-lg text-base leading-relaxed text-[#686868] sm:text-lg">
            {APP_NAME} brings meetings, scheduling, and collaboration together
            in one simple workspace. It is a browser-based video meeting app
            for starting, scheduling and joining meetings with your team.
          </p>

          <ul className="mt-8 flex flex-wrap gap-2" aria-label="Built with">
            {STACK.map((t) => (
              <li
                key={t}
                className="rounded-full bg-[#f5f5f5] px-4 py-1.5 text-sm font-semibold text-black"
              >
                {t}
              </li>
            ))}
          </ul>

          <a
            href="https://github.com/prnvvv/Meetly"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-8 inline-flex h-12 items-center gap-2 rounded-lg border border-black bg-white px-6 text-[15px] font-semibold text-black no-underline transition-colors hover:bg-neutral-100 hover:no-underline"
          >
            View on GitHub <ArrowRightIcon size={16} />
          </a>
        </Reveal>

        <ul className="grid content-start gap-5">
          {PRINCIPLES.map(({ icon: Icon, title, text }, i) => (
            <li key={title}>
              <Reveal delay={i * 100}>
                <div className="flex gap-5 rounded-3xl border border-[#e8e8e8] p-6 sm:p-7">
                  <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-black text-white">
                    <Icon size={22} />
                  </span>
                  <div>
                    <h3 className="text-xl font-extrabold tracking-tight">{title}</h3>
                    <p className="mt-1.5 text-base leading-relaxed text-[#686868]">{text}</p>
                  </div>
                </div>
              </Reveal>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
