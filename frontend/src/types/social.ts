export type RelationshipState = "none" | "friend" | "request_sent" | "request_received" | "blocked";

/** A privacy-filtered card for lists and search results. Never includes email. */
export interface Person {
  user_id: number;
  username: string;
  display_name: string;
  avatar_url: string | null;
  designation: string | null;
  relationship: RelationshipState;
  request_id: number | null;
}

export interface PersonPage {
  items: Person[];
  has_more: boolean;
}

export interface FriendRequest {
  id: number;
  status: string;
  created_at: string;
  responded_at: string | null;
  person: Person;
}

export interface FriendRequestResult {
  request_id: number;
  status: string;
  friendship_created: boolean;
}

export interface NotificationActor {
  user_id: number;
  username: string;
  display_name: string;
  avatar_url: string | null;
}

export interface AppNotification {
  id: number;
  type: string;
  entity_type: string | null;
  entity_id: number | null;
  payload: Record<string, unknown> | null;
  actor: NotificationActor | null;
  read: boolean;
  created_at: string;
}

export interface NotificationPage {
  items: AppNotification[];
  unread_count: number;
  next_before_id: number | null;
}
