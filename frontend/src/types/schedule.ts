export interface ScheduleCreatePayload {
  title: string;
  description?: string | null;
  /** Timezone-aware ISO 8601 string (the API rejects naive values). */
  start_time: string;
  /** Minutes, 1..1440. */
  duration: number;
}

/** PATCH /api/schedules/{meeting_id}: only the fields that changed. */
export interface ScheduleUpdatePayload {
  title?: string;
  description?: string | null;
  start_time?: string;
  duration?: number;
}
