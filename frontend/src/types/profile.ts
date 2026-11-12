export type ProfileVisibility = "public" | "friends" | "private";

export interface MeetingStats {
  meetings_hosted: number;
  meetings_attended: number;
  minutes_hosted: number;
}

/** What the signed-in viewer is allowed to see; hidden fields arrive as null. */
export interface Profile {
  user_id: number;
  username: string;
  display_name: string;
  avatar_url: string | null;
  limited: boolean;
  is_self: boolean;
  bio: string | null;
  location: string | null;
  designation: string | null;
  organization: string | null;
  website: string | null;
  social_links: Record<string, string> | null;
  created_at: string | null;
  stats: MeetingStats | null;
  visibility: ProfileVisibility | null;
  show_meeting_stats: boolean | null;
  updated_at: string | null;
}

export type ProfileUpdate = Partial<{
  username: string;
  display_name: string;
  bio: string | null;
  location: string | null;
  designation: string | null;
  organization: string | null;
  website: string | null;
  social_links: Record<string, string | null>;
  visibility: ProfileVisibility;
  show_meeting_stats: boolean;
}>;

export const SOCIAL_KEYS = ["twitter", "linkedin", "github", "instagram", "facebook", "youtube"] as const;
