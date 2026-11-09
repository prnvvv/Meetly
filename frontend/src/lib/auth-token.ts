interface ClerkGlobal {
  session?: { getToken: () => Promise<string | null> } | null;
}

/**
 * The signed-in user's Clerk session token, for the Authorization header and
 * the WebSocket join message. Clerk keeps a short-lived token fresh itself, so
 * this is called per request instead of being cached. `null` when signed out or
 * before Clerk has loaded (the backend then answers 401).
 */
export async function getAuthToken(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  const clerk = (window as unknown as { Clerk?: ClerkGlobal }).Clerk;
  try {
    return (await clerk?.session?.getToken()) ?? null;
  } catch {
    return null;
  }
}
