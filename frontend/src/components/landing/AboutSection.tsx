import { ArrowRightIcon, LinkIcon, ShieldIcon, VideoIcon } from "@/components/icons";
import { APP_NAME } from "@/lib/constants";
import { Reveal } from "./Reveal";
import {
  Section,
  SectionHeader,
  buttonSecondary,
  cardText,
  cardTitle,
  iconTile,
  sectionCard,
} from "./section";

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
    <Section id="about" className="grid gap-12 lg:grid-cols-2 lg:gap-20">
      <div>
        <SectionHeader eyebrow="About" title="A simple place to meet, schedule and collaborate">
          {APP_NAME} brings meetings, scheduling, and collaboration together in
          one simple workspace. It is a browser-based video meeting app for
          starting, scheduling and joining meetings with your team.
        </SectionHeader>

        <Reveal delay={150}>
          <ul className="mt-8 flex flex-wrap gap-2" aria-label="Built with">
            {STACK.map((t) => (
              <li
                key={t}
                className="rounded-full border border-white/15 bg-white/[0.06] px-4 py-1.5 text-sm font-semibold text-white"
              >
                {t}
              </li>
            ))}
          </ul>

          <a
            href="https://github.com/prnvvv/Meetly"
            target="_blank"
            rel="noopener noreferrer"
            className={`${buttonSecondary} mt-8`}
          >
            View on GitHub <ArrowRightIcon size={16} />
          </a>
        </Reveal>
      </div>

      <ul className="grid content-start gap-5">
        {PRINCIPLES.map(({ icon: Icon, title, text }, i) => (
          <li key={title}>
            <Reveal delay={i * 100}>
              <div className={`${sectionCard} flex gap-5 p-6 sm:gap-6 sm:p-7`}>
                <span className={iconTile}>
                  <Icon size={22} />
                </span>
                <div>
                  <h3 className={cardTitle}>{title}</h3>
                  <p className={`${cardText} mt-1.5`}>{text}</p>
                </div>
              </div>
            </Reveal>
          </li>
        ))}
      </ul>
    </Section>
  );
}
