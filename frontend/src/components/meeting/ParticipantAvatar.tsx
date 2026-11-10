import type { CSSProperties } from "react";
import { HeadingBloom } from "@/components/common/HeadingBloom";
import { cx } from "@/lib/utils";

/**
 * Default participant avatar: one of Meetly's own hand-drawn black-and-white
 * people (cropped from the existing dashboard / new-meeting / join-meeting
 * artwork into /images/avatars) on a light circle, with the same three-ray
 * accent used on the New Meeting and Join headings (HeadingBloom).
 *
 * Which person appears is derived deterministically from a seed, so a
 * participant keeps the same face for the whole meeting. A real uploaded
 * profile photo, when provided, always takes priority over the illustration.
 */

export const AVATAR_ILLUSTRATIONS = [
  "/images/avatars/avatar-1.png",
  "/images/avatars/avatar-2.png",
  "/images/avatars/avatar-3.png",
  "/images/avatars/avatar-4.png",
] as const;

export const AVATAR_VARIANT_COUNT = AVATAR_ILLUSTRATIONS.length;

/** Small, stable string hash (FNV-1a) → non-negative int. */
export function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function avatarVariantFor(seed: string): number {
  return hashSeed(seed.trim().toLowerCase()) % AVATAR_VARIANT_COUNT;
}

interface ParticipantAvatarProps {
  /** Display name — used for the accessible label and, by default, the seed. */
  name: string;
  /** Override what decides which illustration is shown. */
  seed?: string;
  /** Force one illustration (any integer; wraps around). */
  variant?: number;
  /** A real uploaded profile photo; replaces the illustration. */
  imageUrl?: string | null;
  /**
   * Fixed pixel size. Omit it to let CSS size the avatar from its container
   * (the participant stage scales it with the tile).
   */
  size?: number;
  /** Show the three-ray accent beside the avatar. */
  accent?: boolean;
  className?: string;
}

export function ParticipantAvatar({
  name,
  seed,
  variant,
  imageUrl,
  size,
  accent = true,
  className,
}: ParticipantAvatarProps) {
  const index =
    variant !== undefined
      ? ((variant % AVATAR_VARIANT_COUNT) + AVATAR_VARIANT_COUNT) % AVATAR_VARIANT_COUNT
      : avatarVariantFor(seed ?? name);
  const style =
    size !== undefined ? ({ "--p-size": `${size}px` } as CSSProperties) : undefined;

  return (
    <span
      className={cx("p-avatar", size !== undefined && "p-avatar--fixed", className)}
      style={style}
      role="img"
      aria-label={`${name} avatar`}
      data-variant={imageUrl ? "photo" : index}
    >
      <span className={cx("p-avatar__disc", imageUrl && "p-avatar__disc--photo")}>
        {/* eslint-disable-next-line @next/next/no-img-element -- small fixed assets / remote profile photo */}
        <img
          src={imageUrl || AVATAR_ILLUSTRATIONS[index]}
          alt=""
          draggable={false}
          decoding="async"
        />
      </span>
      {accent ? (
        <span className="p-avatar__accent" aria-hidden="true">
          <HeadingBloom />
        </span>
      ) : null}
    </span>
  );
}
