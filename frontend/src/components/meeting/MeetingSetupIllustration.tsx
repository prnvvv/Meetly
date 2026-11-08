import Image from "next/image";

/** Intrinsic size of the trimmed artwork; keeps the aspect ratio stable. */
const ART = {
  lady: { src: "/images/new-meeting/cheerful-lady-trimmed.png", width: 991, height: 751 },
  mug: { src: "/images/new-meeting/coffee-mug-trimmed.png", width: 548, height: 778 },
  plant: { src: "/images/new-meeting/plant-trimmed.png", width: 668, height: 914 },
} as const;

export type MeetingIllustrationName = keyof typeof ART;

interface MeetingSetupIllustrationProps {
  name: MeetingIllustrationName;
  className?: string;
  priority?: boolean;
  sizes?: string;
}

/**
 * One of the hand-drawn black-and-white illustrations. Rendered with its
 * original proportions (no stretching or cropping); callers size it via CSS.
 */
export function MeetingSetupIllustration({
  name,
  className,
  priority = false,
  sizes = "(max-width: 700px) 60vw, 320px",
}: MeetingSetupIllustrationProps) {
  const art = ART[name];
  return (
    <Image
      className={className}
      src={art.src}
      alt=""
      width={art.width}
      height={art.height}
      sizes={sizes}
      priority={priority}
    />
  );
}
