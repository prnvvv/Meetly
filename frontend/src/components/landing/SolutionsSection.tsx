import Link from "next/link";
import {
  ArrowRightIcon,
  CalendarIcon,
  PlusIcon,
  UserIcon,
  UsersIcon,
} from "@/components/icons";
import { Reveal } from "./Reveal";
import { ScheduleCard } from "./previews";
import { SpotlightCard } from "./SpotlightCard";
import {
  Scribble,
  Section,
  SectionHeader,
  buttonPrimary,
  cardText,
  cardTitle,
  iconTile,
} from "./section";

const SOLUTIONS = [
  {
    icon: PlusIcon,
    title: "Team stand-ups and syncs",
    text: "Start an instant meeting and bring everyone together in seconds, no calendar invite required.",
  },
  {
    icon: CalendarIcon,
    title: "Planned sessions and client calls",
    text: "Schedule ahead, share the link, and keep your upcoming meetings in one place.",
  },
  {
    icon: UsersIcon,
    title: "Study groups and classes",
    text: "Share a meeting ID and learn together from anywhere, straight from the browser.",
  },
  {
    icon: UserIcon,
    title: "One-on-one catch-ups",
    text: "Jump on a face-to-face call with a single link, on whatever device you have.",
  },
];

export function SolutionsSection() {
  return (
    <Section id="solutions" className="grid gap-12 lg:grid-cols-[5fr_7fr] lg:gap-20">
      <div>
        <SectionHeader
          eyebrow="Solutions"
          title={
            <>
              One workspace for every kind of <Scribble>meeting</Scribble>
            </>
          }
        >
          Whether it is a quick sync or a planned session, Meetly keeps the way
          you meet simple and the people in the same room.
        </SectionHeader>
        <Reveal delay={150}>
          <Link href="/sign-up" className={`${buttonPrimary} mt-8`}>
            Get started <ArrowRightIcon size={16} />
          </Link>
        </Reveal>
        <Reveal delay={250} className="mt-8">
          <ScheduleCard />
        </Reveal>
      </div>

      <ul className="grid content-start gap-5">
        {SOLUTIONS.map(({ icon: Icon, title, text }, i) => (
          <li key={title}>
            <Reveal delay={i * 90}>
              <SpotlightCard className="flex gap-5 p-6 sm:gap-6 sm:p-7">
                <span className={iconTile}>
                  <Icon size={22} />
                </span>
                <div>
                  <h3 className={cardTitle}>{title}</h3>
                  <p className={`${cardText} mt-1.5 max-w-xl`}>{text}</p>
                </div>
              </SpotlightCard>
            </Reveal>
          </li>
        ))}
      </ul>
    </Section>
  );
}
