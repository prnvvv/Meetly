export type MeetingStatus = "scheduled" | "active" | "ended" | "cancelled";

export interface Meeting {
  id: number;
  meeting_id: string;
  host_id: number;
  title: string;
  description: string | null;
  start_time: string;
  end_time: string | null;
  duration: number | null;
  status: MeetingStatus;
  meeting_link: string;
  created_at: string;
}

export interface MeetingCreatePayload {
  title: string;
  description?: string;
  password?: string;
  /** Host settings saved with the meeting (only `lockMeeting` is enforced server-side). */
  settings?: Record<string, boolean>;
}

export interface MeetingJoinPayload {
  display_name: string;
  password?: string;
}
