import Link from "next/link";
import { VideoIcon } from "@/components/icons";
import { APP_NAME } from "@/lib/constants";
import { LANDING_CONTAINER } from "./container";
import { Reveal } from "./Reveal";
import { ScrollLink } from "./ScrollLink";

const linkClass =
  "cursor-pointer appearance-none border-0 bg-transparent p-0 text-left text-sm font-normal text-[#686868] no-underline transition-colors hover:text-black hover:no-underline";

/** Only links to destinations that exist in the app; nothing placeholder. */
export function LandingFooter() {
  return (
    <footer className="relative overflow-hidden border-t border-[#e8e8e8] bg-white text-black">
      <div className={`${LANDING_CONTAINER} py-14`}>
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.6fr_1fr_1fr_1fr] lg:gap-12">
          <div className="sm:col-span-2 lg:col-span-1">
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-xl font-extrabold tracking-tight text-black no-underline hover:no-underline"
            >
              <span className="grid size-8 place-items-center rounded-lg bg-black text-white">
                <VideoIcon size={18} />
              </span>
              {APP_NAME}
            </Link>
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-[#686868]">
              {APP_NAME} brings meetings, scheduling, and collaboration
              together in one simple workspace.
            </p>
          </div>

          <nav aria-label="Product">
            <h3 className="text-sm font-extrabold">Product</h3>
            <ul className="mt-4 grid gap-3">
              <li>
                <ScrollLink targetId="features" className={linkClass}>
                  Features
                </ScrollLink>
              </li>
              <li>
                <ScrollLink targetId="how-it-works" className={linkClass}>
                  How It Works
                </ScrollLink>
              </li>
              <li>
                <Link href="/meetings" className={linkClass}>
                  Meeting Rooms
                </Link>
              </li>
              <li>
                <Link href="/schedule" className={linkClass}>
                  Scheduling
                </Link>
              </li>
            </ul>
          </nav>

          <nav aria-label="Get started">
            <h3 className="text-sm font-extrabold">Get started</h3>
            <ul className="mt-4 grid gap-3">
              <li>
                <Link href="/sign-up" className={linkClass}>
                  Create an account
                </Link>
              </li>
              <li>
                <Link href="/new-meeting" className={linkClass}>
                  Start a meeting
                </Link>
              </li>
              <li>
                <Link href="/join" className={linkClass}>
                  Join a meeting
                </Link>
              </li>
            </ul>
          </nav>

          <nav aria-label="Company">
            <h3 className="text-sm font-extrabold">Company</h3>
            <ul className="mt-4 grid gap-3">
              <li>
                <ScrollLink targetId="about" className={linkClass}>
                  About {APP_NAME}
                </ScrollLink>
              </li>
              <li>
                <a
                  href="https://github.com/prnvvv/Meetly"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={linkClass}
                >
                  Source on GitHub
                </a>
              </li>
            </ul>
          </nav>
        </div>

        <div className="mt-12 flex flex-col gap-2 border-t border-[#e8e8e8] pt-6 text-sm text-[#686868] sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {new Date().getFullYear()} {APP_NAME}. All rights reserved.
          </p>
          <p>Made for better collaboration</p>
        </div>
      </div>

      {/* oversized outlined wordmark, cropped like a printed masthead */}
      <Reveal className="pointer-events-none -mt-6 select-none">
        <div
          aria-hidden="true"
          className="mx-auto h-[0.6em] w-[86%] max-w-[1560px] overflow-hidden text-center text-[clamp(5rem,21vw,19rem)]"
        >
          <span className="block font-extrabold leading-[0.9] tracking-[-0.06em] text-transparent [-webkit-text-stroke:1.5px_#d9d9d9]">
            {APP_NAME}
          </span>
        </div>
      </Reveal>
    </footer>
  );
}
