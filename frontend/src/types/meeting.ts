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
  /** Server-enforced waiting room. Absent on older API responses (treated as off). */
  waiting_room_enabled?: boolean;
  admission_mode?: string;
}

export interface MeetingCreatePayload {
  title: string;
  description?: string;
  password?: string;
  /** Host settings saved with the meeting (`lockMeeting` and `waitingRoom` are enforced server-side). */
  settings?: Record<string, boolean>;
}

export interface MeetingJoinPayload {
  display_name: string;
  password?: string;
}
