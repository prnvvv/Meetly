import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Without the real secret key the server cannot verify session tokens, so every
// protected route treats a signed-in browser as signed out and bounces it back
// to "/". Say so loudly once at startup instead of leaving a silent redirect loop.
const secretKey = process.env.CLERK_SECRET_KEY ?? "";
if (!secretKey) {
  console.error(
    "[meetly] CLERK_SECRET_KEY is not set: sign-in cannot reach protected pages. " +
      "Add it to frontend/.env.local (Clerk Dashboard -> API keys) and restart the dev server."
  );
} else if (secretKey.length < 30 || /[^\x21-\x7e]/.test(secretKey)) {
  console.error(
    "[meetly] CLERK_SECRET_KEY looks truncated or redacted (too short or contains " +
      "non-ASCII characters such as an ellipsis). Signed-in users will be bounced back " +
      "to the landing page. Copy the full Secret key from Clerk Dashboard -> API keys " +
      "into frontend/.env.local and restart the dev server."
  );
}

const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/",
]);

export const proxy = clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/:path*",
  ],
};
