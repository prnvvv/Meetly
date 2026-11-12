"use client";

import { useCallback, useEffect, useState } from "react";
import { toUserMessage } from "@/lib/api-client";
import { getMeeting } from "@/services/meetingService";
import { getParticipants } from "@/services/participantService";
import type { Meeting } from "@/types/meeting";
import type { Participant } from "@/types/participant";

export interface MeetingRoomState {
  meeting: Meeting | null;
  participants: Participant[];
  loading: boolean;
  error: string | null;
  notFound: boolean;
  refresh: () => Promise<void>;
}

interface RoomPayload {
  meeting: Meeting;
  participants: Participant[];
}

/** Loads the meeting plus its active participant list for the room page. */
export function useMeetingRoom(meetingId: string): MeetingRoomState {
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const fetchRoom = useCallback(
    (): Promise<RoomPayload> =>
      Promise.all([
        getMeeting(meetingId),
        // Someone who has not joined yet (an invited friend, a guest in the waiting
        // room) is not allowed to list participants. The live list arrives over the
        // socket once they are in, so a 403 here just means "empty for now".
        getParticipants(meetingId, true).catch((cause: unknown) => {
          if ((cause as { status?: number }).status === 403) return [] as Participant[];
          throw cause;
        }),
      ]).then(([found, people]) => ({
        meeting: found,
        participants: people,
      })),
    [meetingId]
  );

  useEffect(() => {
    let active = true;
    fetchRoom()
      .then((payload) => {
        if (!active) return;
        setMeeting(payload.meeting);
        setParticipants(payload.participants);
        setError(null);
        setNotFound(false);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        const status = (cause as { status?: number }).status;
        if (status === 404) {
          setNotFound(true);
        } else {
          setError(toUserMessage(cause));
        }
        setMeeting(null);
        setParticipants([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [fetchRoom]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotFound(false);
    try {
      const payload = await fetchRoom();
      setMeeting(payload.meeting);
      setParticipants(payload.participants);
    } catch (cause: unknown) {
      const status = (cause as { status?: number }).status;
      if (status === 404) {
        setNotFound(true);
      } else {
        setError(toUserMessage(cause));
      }
      setMeeting(null);
      setParticipants([]);
    } finally {
      setLoading(false);
    }
  }, [fetchRoom]);

  return { meeting, participants, loading, error, notFound, refresh };
}
