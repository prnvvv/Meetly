import { LinkIcon, PlusIcon, VideoIcon } from "@/components/icons";
import { Reveal } from "./Reveal";
import {
  Section,
  SectionHeader,
  cardText,
  cardTitle,
  iconTile,
  sectionCard,
} from "./section";

const STEPS = [
  { n: "01", icon: PlusIcon, title: "Create", text: "Start an instant meeting or schedule one for later." },
  { n: "02", icon: LinkIcon, title: "Share", text: "Send the meeting link or ID to anyone you want to invite." },
  { n: "03", icon: VideoIcon, title: "Meet", text: "Join from your browser, no downloads and no fuss." },
];

export function HowItWorksSection() {
  return (
    <Section id="how-it-works">
      <SectionHeader eyebrow="How it works" title="From idea to meeting in three simple steps">
        No downloads, no setup. Start, share and join right from your browser.
      </SectionHeader>

      <ol className="mt-12 grid gap-5 md:grid-cols-3 md:gap-14">
        {STEPS.map(({ n, icon: Icon, title, text }, i) => (
          <li key={n} className="relative">
            <Reveal delay={i * 120} className="h-full">
              <div className={`${sectionCard} group relative h-full overflow-hidden p-7 lg:p-8`}>
                <div className="flex items-start justify-between">
                  <span className={iconTile}>
                    <Icon size={22} />
                  </span>
                  <span
                    aria-hidden="true"
                    className="select-none text-[4.5rem] font-extrabold leading-[0.8] tracking-[-0.04em] text-transparent [-webkit-text-stroke:1.5px_rgba(255,255,255,0.28)] transition-[-webkit-text-stroke-color] duration-300 group-hover:[-webkit-text-stroke-color:rgba(255,255,255,0.7)]"
                  >
                    {n}
                  </span>
                </div>
                <h3 className={`${cardTitle} mt-8 text-2xl`}>{title}</h3>
                <p className={`${cardText} mt-2`}>{text}</p>
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
    </Section>
  );
}
