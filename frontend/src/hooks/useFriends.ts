"use client";

import { useEffect, useState } from "react";
import { listFriends, type Friend } from "@/lib/friends";

export function useFriends(): { friends: Friend[]; loading: boolean } {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    listFriends()
      .then((list) => {
        if (active) setFriends(list);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return { friends, loading };
}
