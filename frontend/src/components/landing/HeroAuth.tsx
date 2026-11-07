"use client";

import Link from "next/link";
import { Show, SignIn } from "@clerk/nextjs";
import { authAppearance } from "@/lib/clerk-appearance";

/**
 * The real Clerk <SignIn /> embedded in the landing hero. Hash routing keeps
 * every step (password, MFA, SSO callback) on this page, so it needs no
 * extra `/sign-in/*` routes. Signed-in visitors get a dashboard link instead.
 */
export function HeroAuth() {
  return (
    <div className="flex w-full justify-center min-[1200px]:justify-end">
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
