/**
 * Lets any page open the Friends drawer (which lives in the top bar) without
 * prop-drilling: `openFriendsPanel("find")` from a button, TopNav listens.
 */
export const FRIENDS_PANEL_EVENT = "meetly:open-friends";

export type FriendsPanelTab = "friends" | "requests" | "find" | "blocked";

export function openFriendsPanel(tab: FriendsPanelTab = "find"): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(FRIENDS_PANEL_EVENT, { detail: { tab } }));
}
