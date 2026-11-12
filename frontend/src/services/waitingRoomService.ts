import { apiRequest } from "@/lib/api-client";
import type { WaitingEntry } from "@/types/realtime";

export interface WaitingRoomState {
  enabled: boolean;
  admission_mode: string;
  entries: WaitingEntry[];
}

const base = (meetingId: string) => `/api/meetings/${encodeURIComponent(meetingId)}/waiting-room`;

/** Host-only. The server enforces this; the UI only shows the controls to the host. */
export const getWaitingRoom = (meetingId: string) => apiRequest<WaitingRoomState>(base(meetingId));

export const setWaitingRoomEnabled = (meetingId: string, enabled: boolean) =>
  apiRequest<WaitingRoomState>(base(meetingId), { method: "PATCH", body: { enabled } });

export const admitGuest = (meetingId: string, entryId: number) =>
  apiRequest<{ id: number; state: string; changed: boolean }>(`${base(meetingId)}/${entryId}/admit`, {
    method: "POST",
  });

export const rejectGuest = (meetingId: string, entryId: number) =>
  apiRequest<{ id: number; state: string; changed: boolean }>(`${base(meetingId)}/${entryId}/reject`, {
    method: "POST",
  });

export const admitAllGuests = (meetingId: string) =>
  apiRequest<{ admitted: number }>(`${base(meetingId)}/admit-all`, { method: "POST" });
