"use client";

import { useCallback, useEffect, useState } from "react";
import { STORAGE_KEYS } from "@/lib/constants";

/** Tile arrangement modes; each one genuinely changes the rendered layout. */
export type RoomLayoutMode = "auto" | "gallery" | "speaker";

export interface RoomPreferences {
  layout: RoomLayoutMode;
  /** Mirror the local camera preview (display-only). */
  mirrorSelf: boolean;
}

export const DEFAULT_ROOM_PREFERENCES: RoomPreferences = {
  layout: "auto",
  mirrorSelf: true,
};

const LAYOUTS: RoomLayoutMode[] = ["auto", "gallery", "speaker"];

function sanitize(raw: unknown): RoomPreferences {
  const value = (raw ?? {}) as Partial<RoomPreferences>;
  return {
    layout: LAYOUTS.includes(value.layout as RoomLayoutMode)
      ? (value.layout as RoomLayoutMode)
      : DEFAULT_ROOM_PREFERENCES.layout,
    mirrorSelf:
      typeof value.mirrorSelf === "boolean"
        ? value.mirrorSelf
        : DEFAULT_ROOM_PREFERENCES.mirrorSelf,
  };
}

function read(): RoomPreferences {
  if (typeof window === "undefined") return DEFAULT_ROOM_PREFERENCES;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.roomPrefs);
    return raw ? sanitize(JSON.parse(raw)) : DEFAULT_ROOM_PREFERENCES;
  } catch {
    return DEFAULT_ROOM_PREFERENCES;
  }
}

/**
 * Room view preferences (layout, mirroring),
 * persisted to localStorage so the choice survives refreshes and later
 * meetings. Every field drives real rendering behaviour.
 */
export function useRoomPreferences(): {
  preferences: RoomPreferences;
  setLayout: (layout: RoomLayoutMode) => void;
  setMirrorSelf: (mirror: boolean) => void;
} {
  const [preferences, setPreferences] = useState<RoomPreferences>(read);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        STORAGE_KEYS.roomPrefs,
        JSON.stringify(preferences)
      );
    } catch {
      /* storage disabled — the choice still applies to this session */
    }
  }, [preferences]);

  const update = useCallback(
    (patch: Partial<RoomPreferences>) =>
      setPreferences((current) => ({ ...current, ...patch })),
    []
  );

  return {
    preferences,
    setLayout: useCallback(
      (layout: RoomLayoutMode) => update({ layout }),
      [update]
    ),
    setMirrorSelf: useCallback(
      (mirrorSelf: boolean) => update({ mirrorSelf }),
      [update]
    ),
  };
}

/** Pinned participant for one meeting; pinning is a local-only view choice. */
export function readPinnedParticipant(meetingId: string): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(
      STORAGE_KEYS.pinnedParticipant(meetingId)
    );
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

export function writePinnedParticipant(
  meetingId: string,
  participantId: number | null
): void {
  if (typeof window === "undefined") return;
  try {
    const key = STORAGE_KEYS.pinnedParticipant(meetingId);
    if (participantId === null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, String(participantId));
  } catch {
    /* storage disabled — pinning simply does not persist */
  }
}
