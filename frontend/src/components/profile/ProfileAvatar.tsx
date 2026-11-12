import { cx, getInitials } from "@/lib/utils";

interface ProfileAvatarProps {
  name: string;
  url?: string | null;
  size?: number;
  className?: string;
}

/** Existing black-disc avatar; shows the picture when there is one. */
export function ProfileAvatar({ name, url, size = 56, className }: ProfileAvatarProps) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.34) };
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" className={cx("avatar", "avatar--img", className)} style={style} />;
  }
  return (
    <span className={cx("avatar", className)} style={style} aria-hidden="true">
      {getInitials(name)}
    </span>
  );
}
