import Link from "next/link";
import { VideoIcon } from "@/components/icons";
import { APP_NAME } from "@/lib/constants";
import { LANDING_CONTAINER } from "./container";
import { ScrollLink } from "./ScrollLink";

const NAV_LINKS = [
  { targetId: "features", label: "Features" },
  // "Solutions" scrolls to the section that explains how Meetly solves the
  // meeting workflow; there is no separate solutions section.
  { targetId: "how-it-works", label: "Solutions" },
  { targetId: "about", label: "About" },
];

/**
 * Minimal landing-page navigation. In-page links scroll via ScrollLink so
 * the URL hash stays untouched (Clerk's hash router owns it).
 */
export function LandingNav() {
  return (
    <header className="bg-white">
      <nav
        aria-label="Primary"
        className={`${LANDING_CONTAINER} flex h-[72px] items-center justify-between sm:h-20`}
      >
        <Link
          href="/"
          className="flex items-center gap-2.5 text-[22px] font-extrabold tracking-tight text-black no-underline hover:no-underline sm:text-[26px]"
        >
          <VideoIcon size={28} strokeWidth={2.25} />
          {APP_NAME}
        </Link>

        <ul className="flex items-center gap-5 sm:gap-10 lg:gap-16">
          {NAV_LINKS.map((l) => (
            <li key={l.targetId}>
              <ScrollLink
                targetId={l.targetId}
                className="cursor-pointer appearance-none border-0 bg-transparent p-0 text-[15px] font-medium text-black transition-colors hover:text-neutral-500 sm:text-base lg:text-[17px]"
              >
                {l.label}
              </ScrollLink>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
