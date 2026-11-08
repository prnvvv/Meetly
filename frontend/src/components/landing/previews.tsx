import {
  CalendarIcon,
  ClockIcon,
  MicIcon,
  PhoneOffIcon,
  SmileIcon,
  UsersIcon,
  VideoIcon,
} from "@/components/icons";
import { Reveal } from "./Reveal";

/**
 * Two small, purely illustrative UI previews. They exist only to fill the
 * empty areas in the "How it works" and "Solutions" sections, so both are
 * desktop-only (the stacked layouts have no gap to fill).
 */

const PREVIEW_SHELL =
  "rounded-3xl border border-[#e8e8e8] bg-white shadow-[0_24px_48px_-30px_rgba(0,0,0,0.35)]";

/** A tiny "live meeting" window: the speaker highlight hops between tiles. */
export function LiveMeetingPreview() {
  return (
    <div
      aria-hidden="true"
      className={`${PREVIEW_SHELL} hidden w-[480px] max-w-full p-3 lg:block`}
    >
      <div className="flex items-center justify-between px-1.5 pb-2">
        <div className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-[#e2e2e2]" />
          <span className="size-2 rounded-full bg-[#e2e2e2]" />
          <span className="size-2 rounded-full bg-[#e2e2e2]" />
          <span className="ml-2 text-xs font-semibold text-black">Weekly sync</span>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#f5f5f5] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-black">
          <span className="relative flex size-1.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-black/50 motion-reduce:animate-none" />
            <span className="relative inline-flex size-1.5 rounded-full bg-black" />
          </span>
          Live
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {["You", "Alex", "Sam"].map((name, i) => (
          <div
            key={name}
            className="relative grid h-[70px] place-items-center overflow-hidden rounded-xl bg-[#f5f5f5]"
          >
            <span className="grid size-9 place-items-center rounded-full bg-white text-xs font-extrabold text-black shadow-[0_0_0_1px_#e8e8e8]">
              {name[0]}
            </span>
            <span className="absolute bottom-1.5 left-2 text-[10px] font-semibold text-[#686868]">
              {name}
            </span>
            {/* speaker highlight: ring + equaliser, cycles through the tiles */}
            <span
              className="speak-ring pointer-events-none absolute inset-0 rounded-xl ring-2 ring-inset ring-black"
              style={{ animationDelay: `${i * 2}s` }}
            />
            <span
              className="speak-ring absolute bottom-1.5 right-2 flex h-3 items-end gap-0.5"
              style={{ animationDelay: `${i * 2}s` }}
            >
              {[0, 1, 2].map((b) => (
                <span
                  key={b}
                  className="eq-bar h-full w-0.5 rounded-full bg-black"
                  style={{ animationDelay: `${b * 0.15}s` }}
                />
              ))}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-2 flex items-center justify-center gap-2 rounded-xl bg-[#f5f5f5] py-1.5">
        {[MicIcon, VideoIcon, SmileIcon, UsersIcon].map((Icon, i) => (
          <span
            key={i}
            className="grid size-7 place-items-center rounded-full bg-white text-black shadow-[0_0_0_1px_#e8e8e8]"
          >
            <Icon size={14} />
          </span>
        ))}
        <span className="grid size-7 place-items-center rounded-full bg-black text-white">
          <PhoneOffIcon size={14} />
        </span>
      </div>
    </div>
  );
}

const UPCOMING = [
  { time: "09:30", title: "Team stand-up", when: "Starts soon", soon: true },
  { time: "14:00", title: "Client call", when: "Today" },
  { time: "17:15", title: "Study group", when: "Today" },
];

/** A small "upcoming meetings" list; rows slide in one after another. */
export function ScheduleCard() {
  return (
    <div
      aria-hidden="true"
      className={`${PREVIEW_SHELL} hidden w-full max-w-[420px] p-4 lg:block`}
    >
      <div className="flex items-center justify-between pb-3">
        <span className="inline-flex items-center gap-2 text-sm font-extrabold text-black">
          <span className="grid size-7 place-items-center rounded-lg bg-black text-white">
            <CalendarIcon size={14} />
          </span>
          Upcoming
        </span>
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[#686868]">
          Example
        </span>
      </div>

      <ul className="grid gap-2">
        {UPCOMING.map((m, i) => (
          <li key={m.title}>
            <Reveal delay={200 + i * 140}>
              <div
                className={`flex items-center gap-3 rounded-xl px-3 py-2 ${
                  m.soon ? "bg-black text-white" : "bg-[#f5f5f5] text-black"
                }`}
              >
                <span
                  className={`inline-flex items-center gap-1 text-xs font-bold tabular-nums ${
                    m.soon ? "text-white/70" : "text-[#686868]"
                  }`}
                >
                  <ClockIcon size={12} />
                  {m.time}
                </span>
                <span className="flex-1 text-sm font-semibold">{m.title}</span>
                <span
                  className={`inline-flex items-center gap-1.5 text-[11px] font-semibold ${
                    m.soon ? "text-white" : "text-[#686868]"
                  }`}
                >
                  {m.soon && (
                    <span className="relative flex size-1.5">
                      <span className="absolute inline-flex size-full animate-ping rounded-full bg-white/60 motion-reduce:animate-none" />
                      <span className="relative inline-flex size-1.5 rounded-full bg-white" />
                    </span>
                  )}
                  {m.when}
                </span>
              </div>
            </Reveal>
          </li>
        ))}
      </ul>
    </div>
  );
}
