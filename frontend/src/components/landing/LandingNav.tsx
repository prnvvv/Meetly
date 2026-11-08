"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { VideoIcon } from "@/components/icons";
import { APP_NAME } from "@/lib/constants";
import { LANDING_CONTAINER } from "./container";

const NAV_LINKS = [
  { targetId: "features", label: "Features" },
  { targetId: "solutions", label: "Solutions" },
  { targetId: "about", label: "About" },
];

/**
 * Sticky landing navigation. Each link scrolls to its own section (without
 * touching the URL hash, which Clerk's hash router owns) and the link for the
 * section currently in view is highlighted.
 */
export function LandingNav() {
  const [active, setActive] = useState<string | null>(null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const update = () => {
      setScrolled(window.scrollY > 8);
      // The active section is the last one whose top has passed ~35% of the viewport.
      const line = window.innerHeight * 0.35;
      let current: string | null = null;
      for (const { targetId } of NAV_LINKS) {
        const el = document.getElementById(targetId);
        if (el && el.getBoundingClientRect().top <= line) current = targetId;
      }
      // Near the very bottom, the last section wins even if it is short.
      if (
        window.innerHeight + window.scrollY >=
        document.documentElement.scrollHeight - 4
      ) {
        current = null;
      }
      setActive(current);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  const go = (id: string) =>
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });

  return (
    <header
      className={`sticky top-0 z-50 bg-white transition-shadow duration-200 ${
        scrolled ? "shadow-[0_1px_0_#e8e8e8]" : ""
      }`}
    >
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
          {NAV_LINKS.map((l) => {
            const isActive = active === l.targetId;
            return (
              <li key={l.targetId}>
                <button
                  type="button"
                  onClick={() => go(l.targetId)}
                  aria-current={isActive ? "true" : undefined}
                  className={`relative cursor-pointer appearance-none border-0 bg-transparent p-0 text-[15px] font-medium transition-colors sm:text-base lg:text-[17px] ${
                    isActive ? "text-black" : "text-black/60 hover:text-black"
                  } after:absolute after:-bottom-1.5 after:left-0 after:h-0.5 after:w-full after:origin-left after:rounded-full after:bg-black after:transition-transform after:duration-200 ${
                    isActive ? "after:scale-x-100" : "after:scale-x-0"
                  }`}
                >
                  {l.label}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </header>
  );
}
