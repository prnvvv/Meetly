interface ClerkGlobal {
  loaded?: boolean;
  session?: { getToken: () => Promise<string | null> } | null;
}

/** How long a request waits for Clerk to finish loading before going out unauthenticated. */
export const CLERK_LOAD_WAIT_MS = 4000;
const POLL_MS = 50;

function readClerk(): ClerkGlobal | undefined {
  return (window as unknown as { Clerk?: ClerkGlobal }).Clerk;
}

/**
 * Wait (bounded) until Clerk has loaded, so a request fired on first render is
 * not sent without a token and rejected with a 401. Resolves as soon as Clerk
 * reports loaded, or after the wait. Signed-out visitors pay at most this wait.
 */
async function waitForClerk(maxWaitMs: number): Promise<ClerkGlobal | undefined> {
  const deadline = Date.now() + maxWaitMs;
  let clerk = readClerk();
  // No Clerk object and no Clerk configured (e.g. unit tests): nothing to wait for.
  const configured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
  if (!clerk && !configured) return undefined;
  while ((!clerk || clerk.loaded === false) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    clerk = readClerk();
  }
  return clerk;
}

/**
 * The signed-in user's Clerk session token, for the Authorization header and
 * the WebSocket join message. Clerk keeps a short-lived token fresh itself, so
 * this is called per request instead of being cached. `null` when signed out
 * (the backend then answers 401).
 */
export async function getAuthToken(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  try {
    const clerk = await waitForClerk(CLERK_LOAD_WAIT_MS);
    return (await clerk?.session?.getToken()) ?? null;
  } catch {
    return null;
  }
}
