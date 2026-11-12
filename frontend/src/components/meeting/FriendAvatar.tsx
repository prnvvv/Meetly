import { initials, type Friend } from "@/lib/friends";

interface FriendAvatarProps {
  friend: Friend;
  size?: number;
  selected?: boolean;
}

/** Monochrome avatar: the friend picture when allowed, otherwise initials in a grey shade. */
export function FriendAvatar({ friend, size = 46, selected = false }: FriendAvatarProps) {
  // Stable light-grey shade derived from the id so each friend reads as distinct.
  const shade = [...friend.id].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 4;
  const style = { width: size, height: size, fontSize: size * 0.34 };
  return (
    <span
      className={selected ? "nm-avatar nm-avatar--selected" : "nm-avatar"}
      data-shade={shade}
      style={style}
    >
      {friend.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={friend.avatarUrl} alt="" className="nm-avatar__img" />
      ) : (
        initials(friend.name)
      )}
    </span>
  );
}
