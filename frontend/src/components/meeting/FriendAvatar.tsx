import { initials, type Friend } from "@/lib/friends";

interface FriendAvatarProps {
  friend: Friend;
  size?: number;
  selected?: boolean;
}

/** Monochrome initials avatar with an online dot; shades vary per person, never colours. */
export function FriendAvatar({ friend, size = 46, selected = false }: FriendAvatarProps) {
  // Stable light-grey shade derived from the id so each friend reads as distinct.
  const shade = [...friend.id].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 4;
  return (
    <span
      className={selected ? "nm-avatar nm-avatar--selected" : "nm-avatar"}
      data-shade={shade}
      style={{ width: size, height: size, fontSize: size * 0.34 }}
    >
      {initials(friend.name)}
      <span
        className={friend.online ? "nm-avatar__dot nm-avatar__dot--on" : "nm-avatar__dot"}
        role="img"
        aria-label={friend.online ? "Online" : "Offline"}
      />
    </span>
  );
}
