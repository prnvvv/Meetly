import {
  CalendarIcon,
  GridViewIcon,
  LinkIcon,
  MicIcon,
  SmileIcon,
  UsersIcon,
} from "@/components/icons";
import { LANDING_CONTAINER } from "./container";
import { Reveal } from "./Reveal";

// Only capabilities that exist in the app today.
const CAPABILITIES = [
  {
    icon: CalendarIcon,
    title: "Instant or scheduled",
    text: "Start a meeting in one click, or schedule it for later and keep what's coming up on your dashboard.",
  },
  {
    icon: LinkIcon,
    title: "Join by link or ID",
    text: "Share a meeting link or ID and anyone can join straight from the browser, with nothing to install.",
  },
  {
    icon: GridViewIcon,
    title: "Flexible layouts",
    text: "Switch between grid, speaker and automatic layouts, and pin the person you want to focus on.",
  },
  {
    icon: MicIcon,
    title: "Full device control",
    text: "Choose your camera, microphone and speaker, mute with a click and mirror your own preview.",
  },
  {
    icon: SmileIcon,
    title: "Reactions",
    text: "Respond without interrupting the speaker, with quick reactions everyone in the room can see.",
  },
  {
    icon: UsersIcon,
    title: "Participants panel",
    text: "See everyone who is in the room at a glance and manage the conversation from one place.",
  },
];

export function FeaturesSection() {
  return (
    <section id="features" className="scroll-mt-20 bg-white">
      <div className={`${LANDING_CONTAINER} py-16 md:py-24`}>
        <Reveal className="max-w-2xl">
          <span className="inline-flex h-8 items-center rounded-full border border-neutral-300 px-4 text-xs font-semibold uppercase tracking-[0.14em] text-neutral-600">
            Features
          </span>
          <h2 className="mt-5 text-[clamp(1.875rem,3.2vw,2.75rem)] font-extrabold leading-[1.1] tracking-[-0.03em]">
            Built for the way teams meet
          </h2>
          <p className="mt-4 text-base leading-relaxed text-[#686868] sm:text-lg">
            Everything you need in the room, and nothing that gets in the way.
          </p>
        </Reveal>

        <ul className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 lg:gap-6">
          {CAPABILITIES.map(({ icon: Icon, title, text }, i) => (
            <li key={title}>
              <Reveal delay={(i % 3) * 100} className="h-full">
                <article className="group flex h-full flex-col rounded-3xl border border-[#e8e8e8] bg-white p-7 transition-colors duration-200 hover:border-black lg:p-8">
                  <span className="grid size-12 place-items-center rounded-2xl bg-[#f5f5f5] text-black transition-colors duration-200 group-hover:bg-black group-hover:text-white">
                    <Icon size={22} />
                  </span>
                  <h3 className="mt-6 text-xl font-extrabold tracking-tight">{title}</h3>
                  <p className="mt-2 text-base leading-relaxed text-[#686868]">{text}</p>
                </article>
              </Reveal>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
