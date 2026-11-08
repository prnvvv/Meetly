import { apiRequest } from "@/lib/api-client";
import { REST } from "@/lib/constants";
import type { Meeting } from "@/types/meeting";
import type { ScheduleCreatePayload, ScheduleUpdatePayload } from "@/types/schedule";

/** GET /api/schedules/upcoming */
export function getUpcomingMeetings(limit = 50): Promise<Meeting[]> {
  return apiRequest<Meeting[]>(`${REST.schedulesUpcoming}?limit=${limit}`);
}

/** GET /api/schedules/recent */
export function getRecentMeetings(limit = 50): Promise<Meeting[]> {
  return apiRequest<Meeting[]>(`${REST.schedulesRecent}?limit=${limit}`);
}

/** POST /api/schedules */
export function scheduleMeeting(payload: ScheduleCreatePayload): Promise<Meeting> {
  return apiRequest<Meeting>(REST.schedules, {
    method: "POST",
    body: payload,
  });
}

/** GET /api/schedules/range: meetings starting in [start, end). */
export function getMeetingsInRange(start: Date, end: Date): Promise<Meeting[]> {
  const query = new URLSearchParams({
    start: start.toISOString(),
    end: end.toISOString(),
  });
  return apiRequest<Meeting[]>(`${REST.schedulesRange}?${query.toString()}`);
}

/** PATCH /api/schedules/{meeting_id} */
export function updateScheduledMeeting(
  meetingId: string,
  payload: ScheduleUpdatePayload
): Promise<Meeting> {
  return apiRequest<Meeting>(REST.schedule(meetingId), {
    method: "PATCH",
    body: payload,
  });
}
