import Image from "next/image";
import Link from "next/link";

interface PanelEmptyStateProps {
  /** One of the monochrome illustration assets in /public/images. */
  illustration: "/images/empty-upcoming.svg" | "/images/empty-recent.svg";
  title: string;
  description: string;
  actionHref: string;
  actionLabel: string;
}

/**
 * Designed empty state that fills a dashboard panel: illustration, heading,
 * a short explanation and one clear action. It is sized to match a panel with
 * three meeting rows, so empty and populated panels look equally composed.
 */
export function PanelEmptyState({
  illustration,
  title,
  description,
  actionHref,
  actionLabel,
}: PanelEmptyStateProps) {
  return (
    <div className="panel-empty">
      <Image
        className="panel-empty__art"
        src={illustration}
        alt=""
        width={320}
        height={240}
        unoptimized
      />
      <h3 className="panel-empty__title">{title}</h3>
      <p className="panel-empty__text">{description}</p>
      <Link href={actionHref} className="btn btn--primary">
        {actionLabel}
      </Link>
    </div>
  );
}
