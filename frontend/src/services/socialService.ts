import { apiRequest } from "@/lib/api-client";
import type {
  FriendRequest,
  FriendRequestResult,
  NotificationPage,
  PersonPage,
} from "@/types/social";

const enc = encodeURIComponent;

export const searchPeople = (q: string, offset = 0, limit = 20) =>
  apiRequest<PersonPage>(`/api/users/search?q=${enc(q)}&offset=${offset}&limit=${limit}`);

export const discoverPeople = () => apiRequest<PersonPage>("/api/users/discover");

export const listFriendsPage = (q = "", offset = 0, limit = 20) =>
  apiRequest<PersonPage>(`/api/friends?q=${enc(q)}&offset=${offset}&limit=${limit}`);

export const incomingRequests = () => apiRequest<FriendRequest[]>("/api/friends/requests/incoming");
export const outgoingRequests = () => apiRequest<FriendRequest[]>("/api/friends/requests/outgoing");

export const sendFriendRequest = (userId: number) =>
  apiRequest<FriendRequestResult>("/api/friends/requests", { method: "POST", body: { user_id: userId } });

export const acceptRequest = (id: number) =>
  apiRequest<FriendRequestResult>(`/api/friends/requests/${id}/accept`, { method: "POST" });

export const rejectRequest = (id: number) =>
  apiRequest<FriendRequestResult>(`/api/friends/requests/${id}/reject`, { method: "POST" });

export const cancelRequest = (id: number) =>
  apiRequest<FriendRequestResult>(`/api/friends/requests/${id}`, { method: "DELETE" });

export const removeFriend = (userId: number) =>
  apiRequest<void>(`/api/friends/${userId}`, { method: "DELETE" });

export const blockUser = (userId: number) =>
  apiRequest<void>(`/api/users/${userId}/block`, { method: "POST" });

export const unblockUser = (userId: number) =>
  apiRequest<void>(`/api/users/${userId}/block`, { method: "DELETE" });

export const listBlocked = () => apiRequest<PersonPage>("/api/blocks");

export const listNotifications = (beforeId?: number, limit = 20) =>
  apiRequest<NotificationPage>(
    `/api/notifications?limit=${limit}${beforeId ? `&before_id=${beforeId}` : ""}`
  );

export const markNotificationRead = (id: number) =>
  apiRequest<void>(`/api/notifications/${id}/read`, { method: "PATCH" });

export const markAllNotificationsRead = () =>
  apiRequest<{ updated: number }>("/api/notifications/read-all", { method: "POST" });

// ---- meeting invitations ----

export interface InviteResponse {
  meeting_id: string;
  invited: number;
  results: { user_id: number; result: "invited" | "reinvited" | "already_invited" | "unavailable" }[];
}

export interface InvitationAccepted {
  invitation_id: number;
  status: string;
  meeting_id: string;
  has_password: boolean;
  joinable_now: boolean;
}

export const inviteToMeeting = (meetingId: string, userIds: number[]) =>
  apiRequest<InviteResponse>(`/api/meetings/${enc(meetingId)}/invitations`, {
    method: "POST",
    body: { user_ids: userIds },
  });

export const acceptInvitation = (id: number) =>
  apiRequest<InvitationAccepted>(`/api/invitations/${id}/accept`, { method: "POST" });

export const declineInvitation = (id: number) =>
  apiRequest<InvitationAccepted>(`/api/invitations/${id}/decline`, { method: "POST" });
