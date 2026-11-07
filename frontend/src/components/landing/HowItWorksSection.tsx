import { LinkIcon, PlusIcon, VideoIcon } from "@/components/icons";
import { Reveal } from "./Reveal";
import { SpotlightCard } from "./SpotlightCard";
import {
  Scribble,
  Section,
  SectionHeader,
  cardText,
  cardTitle,
  iconTile,
} from "./section";

const STEPS = [
  { n: "01", icon: PlusIcon, title: "Create", text: "Start an instant meeting or schedule one for later." },
  { n: "02", icon: LinkIcon, title: "Share", text: "Send the meeting link or ID to anyone you want to invite." },
  { n: "03", icon: VideoIcon, title: "Meet", text: "Join from your browser, no downloads and no fuss." },
];

export function HowItWorksSection() {
  return (
    <Section id="how-it-works">
      <SectionHeader
        eyebrow="How it works"
        title={
          <>
            From idea to meeting in <Scribble>three simple steps</Scribble>
          </>
        }
      >
        No downloads, no setup. Start, share and join right from your browser.
      </SectionHeader>

      <ol className="mt-12 grid gap-5 md:grid-cols-3 md:gap-14">
        {STEPS.map(({ n, icon: Icon, title, text }, i) => (
          <li key={n} className="relative">
            <Reveal delay={i * 150} className="h-full">
              <SpotlightCard className="h-full p-7 lg:p-8">
                <div className="flex items-start justify-between">
                  <span className={iconTile}>
                    <Icon size={22} />
                  </span>
                  {/* outlined numeral that fills in once the step is revealed */}
                  <span
                    aria-hidden="true"
                    className="select-none text-[4.5rem] font-extrabold leading-[0.8] tracking-[-0.04em] text-transparent [-webkit-text-stroke:1.5px_#d4d4d4] transition-[-webkit-text-stroke-color] duration-1000 group-data-[shown=true]/reveal:[-webkit-text-stroke-color:#000] group-hover:[-webkit-text-stroke-color:#000]"
                  >
                    {n}
                  </span>
                </div>
                <h3 className={`${cardTitle} mt-8 text-2xl`}>{title}</h3>
                <p className={`${cardText} mt-2`}>{text}</p>
              </SpotlightCard>

              {/* connector to the next step: draws left to right, then the arrowhead pops in */}
              {i < STEPS.length - 1 && (
                <span
                  aria-hidden="true"
                  className="absolute -right-14 top-1/2 hidden h-px w-14 origin-left scale-x-0 bg-black transition-transform duration-700 ease-out [transition-delay:600ms] group-data-[shown=true]/reveal:scale-x-100 motion-reduce:scale-x-100 md:block"
                >
                  <span className="absolute -right-px -top-[3px] size-[7px] rotate-45 border-r border-t border-black opacity-0 transition-opacity duration-300 [transition-delay:1200ms] group-data-[shown=true]/reveal:opacity-100 motion-reduce:opacity-100" />
                </span>
              )}
            </Reveal>
          </li>
        ))}
      </ol>
    </Section>
  );
}
