import { redirect } from "next/navigation";

/**
 * Sign-in now lives on the landing page. This route stays so old links,
 * bookmarks and Clerk redirects keep working.
 */
export default async function SignInPage({ searchParams }) {
  const params = await searchParams;
  const redirectUrl = params.redirect_url;

  let target: string;
  if (typeof redirectUrl === "string") {
    // Clerk OAuth redirects URL-encode the redirect_url; try to decode it.
    const decoded = decodeURIComponent(redirectUrl);
    // If it's a full URL (starts with http), extract the path.
    if (decoded.startsWith("http://") || decoded.startsWith("https://")) {
      try {
        const parsed = new URL(decoded);
        target = `/?redirect_url=${encodeURIComponent(parsed.pathname + parsed.search)}`;
      } catch {
        target = "/dashboard";
      }
    } else {
      // Relative path – keep existing behaviour.
      target = `/?redirect_url=${encodeURIComponent(redirectUrl)}`;
    }
  } else {
    target = "/dashboard";
  }
  redirect(target);
}