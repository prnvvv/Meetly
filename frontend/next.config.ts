import type { NextConfig } from "next";

/**
 * Production builds (Vercel sets VERCEL_ENV to "production" or "preview"; NODE_ENV is "production" for
 * every `next build`) must point at a real HTTPS backend and carry a Clerk key. NEXT_PUBLIC_* values are
 * inlined into the browser bundle at build time, so a missing value would silently ship `localhost`.
 * Failing the build is the safe outcome. Set MEETLY_SKIP_ENV_CHECK=1 only for a local `next build`.
 */
function assertDeploymentEnv(): void {
  if (process.env.NODE_ENV !== "production" || process.env.MEETLY_SKIP_ENV_CHECK === "1") return;
  const problems: string[] = [];
  const api = (process.env.NEXT_PUBLIC_API_URL ?? "").trim();
  if (!api) {
    problems.push("NEXT_PUBLIC_API_URL is not set (the bundle would call http://localhost:8000)");
  } else {
    try {
      const url = new URL(api);
      if (url.protocol !== "https:") problems.push("NEXT_PUBLIC_API_URL must use https:// (WebSockets become wss://)");
      if (["localhost", "127.0.0.1", "::1"].includes(url.hostname)) problems.push("NEXT_PUBLIC_API_URL points at localhost");
    } catch {
      problems.push("NEXT_PUBLIC_API_URL is not a valid URL");
    }
  }
  const clerk = (process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "").trim();
  if (!clerk.startsWith("pk_")) problems.push("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY must be a Clerk publishable key (pk_...)");
  if (!(process.env.CLERK_SECRET_KEY ?? "").trim().startsWith("sk_")) problems.push("CLERK_SECRET_KEY must be set (server-side only)");
  if (process.env.VERCEL_ENV === "production" && clerk.startsWith("pk_test_") && process.env.MEETLY_ALLOW_CLERK_DEV_KEY !== "1") {
    problems.push("a production Vercel deployment is using a Clerk DEVELOPMENT key (pk_test_...); use the production instance (needs your own domain), or set MEETLY_ALLOW_CLERK_DEV_KEY=1 to accept development limits knowingly");
  }
  if (problems.length) {
    throw new Error(`Refusing to build with an unsafe environment:\n - ${problems.join("\n - ")}\nSee docs/deployment/VERCEL_SETUP.md.`);
  }
}
assertDeploymentEnv();

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.1.10"],
  // Standalone output lets the frontend run inside a minimal Docker container. Vercel ignores it.
  output: "standalone",
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Meetly needs the camera, microphone and screen capture for its own pages only.
          { key: "Permissions-Policy", value: "camera=(self), microphone=(self), display-capture=(self), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
