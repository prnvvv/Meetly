import { listFriendsPage } from "@/services/socialService";

/**
 * A friend as the invite pickers see it. Backed by the real friends API
 * (`GET /api/friends`); `id` is the user id as a string.
 */
export interface Friend {
  id: string;
  name: string;
  username: string;
  avatarUrl: string | null;
}

const PAGE = 20;
const MAX_PAGES = 5; // up to 100 friends in the picker; search narrows beyond that

export async function listFriends(): Promise<Friend[]> {
  const friends: Friend[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await listFriendsPage("", page * PAGE, PAGE);
    for (const p of result.items) {
      friends.push({
        id: String(p.user_id),
        name: p.display_name,
        username: p.username,
        avatarUrl: p.avatar_url,
      });
    }
    if (!result.has_more) break;
  }
  return friends;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}
