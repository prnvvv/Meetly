"use client";

import { useCallback, useEffect, useState } from "react";
import { toUserMessage } from "@/lib/api-client";
import { listFriends, type Friend } from "@/lib/friends";

/** The signed-in user's real friends, with an error state and a retry. */
export function useFriends(): {
  friends: Friend[];
  loading: boolean;
  error: string | null;
  reload: () => void;
} {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    listFriends()
      .then((list) => {
        if (!active) return;
        setFriends(list);
        setError(null);
      })
      .catch((cause) => {
        if (active) setError(toUserMessage(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [attempt]);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    setAttempt((n) => n + 1);
  }, []);

  return { friends, loading, error, reload };
}
