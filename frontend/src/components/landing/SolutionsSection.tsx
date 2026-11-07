import Link from "next/link";
import {
  ArrowRightIcon,
  CalendarIcon,
  PlusIcon,
  UserIcon,
  UsersIcon,
} from "@/components/icons";
import { LANDING_CONTAINER } from "./container";
import { Reveal } from "./Reveal";

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
    <section
      id="solutions"
      className="scroll-mt-20 border-y border-[#e8e8e8] bg-[#f7f7f7]"
    >
      <div
        className={`${LANDING_CONTAINER} grid gap-12 py-16 md:py-24 lg:grid-cols-[5fr_7fr] lg:gap-20`}
      >
        <Reveal className="lg:pt-2">
          <span className="inline-flex h-8 items-center rounded-full border border-neutral-300 px-4 text-xs font-semibold uppercase tracking-[0.14em] text-neutral-600">
            Solutions
          </span>
          <h2 className="mt-5 text-[clamp(1.875rem,3.2vw,2.75rem)] font-extrabold leading-[1.1] tracking-[-0.03em]">
            One workspace for every kind of meeting
          </h2>
          <p className="mt-4 max-w-md text-base leading-relaxed text-[#686868] sm:text-lg">
            Whether it is a quick sync or a planned session, Meetly keeps the
            way you meet simple and the people in the same room.
          </p>
          <Link
            href="/sign-up"
            className="mt-8 inline-flex h-12 items-center gap-2 rounded-lg border border-black bg-black px-6 text-[15px] font-semibold text-white no-underline transition-colors hover:bg-neutral-800 hover:no-underline"
          >
            Get started <ArrowRightIcon size={16} />
          </Link>
        </Reveal>

        <ul className="divide-y divide-[#dcdcdc] border-y border-[#dcdcdc]">
          {SOLUTIONS.map(({ icon: Icon, title, text }, i) => (
            <li key={title}>
              <Reveal delay={i * 90}>
                <div className="group flex gap-5 py-7 sm:gap-6">
                  <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-white text-black shadow-[0_0_0_1px_#e8e8e8] transition-colors duration-200 group-hover:bg-black group-hover:text-white">
                    <Icon size={22} />
                  </span>
                  <div>
                    <h3 className="text-xl font-extrabold tracking-tight">{title}</h3>
                    <p className="mt-1.5 max-w-xl text-base leading-relaxed text-[#686868]">
                      {text}
                    </p>
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
