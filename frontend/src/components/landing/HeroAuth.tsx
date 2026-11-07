"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { Show, SignIn } from "@clerk/nextjs";
import { authAppearance } from "@/lib/clerk-appearance";

/**
 * The real Clerk <SignIn /> embedded in the landing hero. Hash routing keeps
 * every step (password, MFA, SSO callback) on this page, so it needs no
 * extra `/sign-in/*` routes. Signed-in visitors get a dashboard link instead.
 */
export function HeroAuth() {
  // The server sends signed-out requests for protected pages to "/?redirect_url=...".
  // If the browser is signed in *and* we are here with that parameter, the server
  // refused a session the browser holds, which means it could not verify it
  // (a missing or truncated CLERK_SECRET_KEY). The query string cannot change
  // without a navigation, so there is nothing to subscribe to, and the server
  // snapshot is `false` so the prerendered page stays static and hydrates cleanly.
  const bounced = useSyncExternalStore(
    () => () => {},
    () => new URLSearchParams(window.location.search).has("redirect_url"),
    () => false
  );

  return (
    <div className="flex w-full justify-center min-[1200px]:w-[92%] min-[1200px]:justify-end min-[1200px]:[zoom:0.92]">
      <Show when="signed-out">
        <SignIn
          routing="hash"
          signUpUrl="/sign-up"
          fallbackRedirectUrl="/dashboard"
          appearance={authAppearance}
        />
      </Show>
      <Show when="signed-in">
        <div className="w-full max-w-[545px] rounded-[28px] border border-neutral-200 bg-white p-8">
          <h2 className="text-xl font-extrabold">Welcome back</h2>
          <p className="mt-2 text-sm text-neutral-500">
            You&apos;re signed in. Pick up where you left off.
          </p>
          {bounced && (
            <p
              role="alert"
              className="mt-4 rounded-xl bg-[#f5f5f5] p-3 text-xs leading-relaxed text-[#686868]"
            >
              You are signed in, but the server could not verify your session,
              so it sent you back here. If you are running this locally, check
              that <code>CLERK_SECRET_KEY</code> in <code>frontend/.env.local</code>{" "}
              is the full secret key (not truncated), then restart the dev server.
            </p>
          )}
          <Link
            href="/dashboard"
            className="mt-6 inline-flex h-11 w-full items-center justify-center rounded-lg bg-black text-sm font-semibold text-white no-underline hover:bg-neutral-800 hover:no-underline"
          >
            Go to dashboard
          </Link>
        </div>
      </Show>
    </div>
  );
}
