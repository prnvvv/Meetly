"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getAuthToken } from "@/lib/auth-token";
import { toWebSocketUrl } from "@/lib/constants";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/services/socialService";
import type { AppNotification } from "@/types/social";

const POLL_MS = 60_000;
const MAX_BACKOFF_MS = 30_000;

/**
 * Notification feed + unread count for the signed-in user.
 *
 * Realtime: one WebSocket (`/ws/notifications`) delivers "something changed"
 * hints; each hint triggers a REST refetch, so no private data crosses the
 * socket. A 60s poll covers a dropped socket or a missed hint. `changeTick`
 * increments on every hint so other panels (friends, requests) can refetch too.
 */
export function useNotifications(enabled: boolean) {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [changeTick, setChangeTick] = useState(0);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const page = await listNotifications();
      if (!alive.current) return;
      setItems(page.items);
      setUnread(page.unread_count);
      setNextBefore(page.next_before_id);
    } catch {
      /* keep what we have; the next poll retries */
    }
  }, []);

  const initialLoad = useCallback(async () => {
    setLoading(true);
    await refresh();
    if (alive.current) setLoading(false);
  }, [refresh]);

  const loadMore = useCallback(async () => {
    if (!nextBefore) return;
    try {
      const page = await listNotifications(nextBefore);
      setItems((current) => [...current, ...page.items]);
      setNextBefore(page.next_before_id);
      setUnread(page.unread_count);
    } catch {
      /* ignore */
    }
  }, [nextBefore]);

  const markRead = useCallback(async (id: number) => {
    setItems((cur) => cur.map((n) => (n.id === id ? { ...n, read: true } : n)));
    setUnread((n) => Math.max(0, n - 1));
    try {
      await markNotificationRead(id);
    } catch {
      void refresh();
    }
  }, [refresh]);

  const markAllRead = useCallback(async () => {
    setItems((cur) => cur.map((n) => ({ ...n, read: true })));
    setUnread(0);
    try {
      await markAllNotificationsRead();
    } catch {
      void refresh();
    }
  }, [refresh]);

  useEffect(() => {
    alive.current = true;
    if (!enabled) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void initialLoad();

    let socket: WebSocket | null = null;
    let retry = 1000;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;

    const connect = async () => {
      const token = await getAuthToken();
      if (closed || !token) {
        if (!closed) retryTimer = setTimeout(connect, retry);
        return;
      }
      socket = new WebSocket(toWebSocketUrl("/ws/notifications"));
      socket.onopen = () => socket?.send(JSON.stringify({ type: "auth", token }));
      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(String(event.data));
          if (msg.type === "ready") retry = 1000;
          if (msg.type === "notifications_changed") {
            setChangeTick((n) => n + 1);
            void refresh();
          }
        } catch {
          /* ignore malformed hints */
        }
      };
      socket.onclose = () => {
        socket = null;
        if (closed) return;
        retryTimer = setTimeout(connect, retry);
        retry = Math.min(retry * 2, MAX_BACKOFF_MS);
      };
    };
    void connect();

    const poll = setInterval(() => void refresh(), POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      alive.current = false;
      closed = true;
      clearInterval(poll);
      if (retryTimer) clearTimeout(retryTimer);
      document.removeEventListener("visibilitychange", onVisible);
      socket?.close();
    };
  }, [enabled, initialLoad, refresh]);

  return {
    items,
    unread,
    loading,
    hasMore: nextBefore !== null,
    changeTick,
    refresh,
    loadMore,
    markRead,
    markAllRead,
  };
}
