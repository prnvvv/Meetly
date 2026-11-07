import {
  CalendarIcon,
  GridViewIcon,
  LinkIcon,
  MicIcon,
  SmileIcon,
  UsersIcon,
} from "@/components/icons";
import { Reveal } from "./Reveal";
import {
  Section,
  SectionHeader,
  cardText,
  cardTitle,
  iconTile,
  sectionCard,
} from "./section";

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
    <Section id="features">
      <SectionHeader eyebrow="Features" title="Built for the way teams meet">
        Everything you need in the room, and nothing that gets in the way.
      </SectionHeader>

      <ul className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 lg:gap-6">
        {CAPABILITIES.map(({ icon: Icon, title, text }, i) => (
          <li key={title}>
            <Reveal delay={(i % 3) * 100} className="h-full">
              <article className={`${sectionCard} flex h-full flex-col p-7 lg:p-8`}>
                <span className={iconTile}>
                  <Icon size={22} />
                </span>
                <h3 className={`${cardTitle} mt-6`}>{title}</h3>
                <p className={`${cardText} mt-2`}>{text}</p>
              </article>
            </Reveal>
          </li>
        ))}
      </ul>
    </Section>
  );
}
