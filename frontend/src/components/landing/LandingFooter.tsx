import Link from "next/link";
import { VideoIcon } from "@/components/icons";
import { APP_NAME } from "@/lib/constants";
import { LANDING_CONTAINER } from "./container";
import { ScrollLink } from "./ScrollLink";

const linkClass =
  "cursor-pointer appearance-none border-0 bg-transparent p-0 text-left text-sm font-normal text-neutral-600 no-underline transition-colors hover:text-black hover:no-underline";

/** Only links to destinations that exist in the app; nothing placeholder. */
export function LandingFooter() {
  return (
    <footer className="border-t border-neutral-200 bg-white">
      <div className={`${LANDING_CONTAINER} py-14`}>
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.6fr_1fr_1fr_1fr] lg:gap-12">
          <div id="about" className="scroll-mt-8 sm:col-span-2 lg:col-span-1">
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-xl font-extrabold tracking-tight text-black no-underline hover:no-underline"
            >
              <span className="grid size-8 place-items-center rounded-lg bg-black text-white">
                <VideoIcon size={18} />
              </span>
              {APP_NAME}
            </Link>
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-neutral-600">
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

          <nav aria-label="Resources">
            <h3 className="text-sm font-extrabold">Resources</h3>
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

        <div className="mt-12 flex flex-col gap-2 border-t border-neutral-200 pt-6 text-sm text-neutral-500 sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {new Date().getFullYear()} {APP_NAME}. All rights reserved.
          </p>
          <p>Made for better collaboration</p>
        </div>
      </div>
    </footer>
  );
}
