import { redirect } from "next/navigation";

/**
 * Sign-in now lives on the landing page. This route stays so old links,
 * bookmarks and Clerk redirects keep working.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const redirectUrl = params.redirect_url;
  const target =
    typeof redirectUrl === "string" && redirectUrl.startsWith("/")
      ? `/?redirect_url=${encodeURIComponent(redirectUrl)}`
      : "/";
  redirect(target);
}
