/**
 * Friends are mock data for now. `listFriends()` is the single seam to swap
 * for a real API (and `inviteFriends` for real invitations) later; the UI only
 * depends on the `Friend` shape.
 */
export interface Friend {
  id: string;
  name: string;
  online: boolean;
}

const MOCK_FRIENDS: Friend[] = [
  { id: "f-alex", name: "Alex Morgan", online: true },
  { id: "f-sarah", name: "Sarah Johnson", online: true },
  { id: "f-daniel", name: "Daniel Kim", online: false },
  { id: "f-emma", name: "Emma Wilson", online: true },
  { id: "f-ryan", name: "Ryan Cooper", online: false },
  { id: "f-olivia", name: "Olivia Parker", online: true },
  { id: "f-noah", name: "Noah Bennett", online: false },
  { id: "f-mia", name: "Mia Patel", online: true },
  { id: "f-lucas", name: "Lucas Rivera", online: false },
  { id: "f-ava", name: "Ava Nguyen", online: true },
];

export async function listFriends(): Promise<Friend[]> {
  return MOCK_FRIENDS;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}
