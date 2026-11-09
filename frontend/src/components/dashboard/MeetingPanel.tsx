import Link from "next/link";
import { Skeleton } from "@/components/common/Skeleton";

interface MeetingPanelProps {
  /** Heading text, also used as the section's accessible name. */
  title: string;
  /** Stable id suffix for aria-labelledby. */
  id: string;
  /** Where "View all" goes; the link is omitted when not given. */
  viewAllHref?: string;
  children: React.ReactNode;
}

/**
 * Bordered dashboard panel with a title on the left and "View all" on the
 * right. Two of these sit side by side; the grid stretches them to the same
 * height and the body keeps a minimum height, so a populated panel and an
 * empty-state panel always have identical dimensions.
 */
export function MeetingPanel({ title, id, viewAllHref, children }: MeetingPanelProps) {
  const headingId = `${id}-heading`;
  return (
    <section className="panel" aria-labelledby={headingId}>
      <header className="panel__head">
        <h2 className="panel__title" id={headingId}>
          {title}
        </h2>
        {viewAllHref ? (
          <Link href={viewAllHref} className="panel__link">
            View all
          </Link>
        ) : null}
      </header>
      <div className="panel__body">{children}</div>
    </section>
  );
}

/** Loading placeholder with the same row height as real meeting rows. */
export function PanelSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="meeting-list" aria-hidden="true">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="meeting-item meeting-item--skeleton">
          <Skeleton className="meeting-item__icon" />
          <div className="meeting-item__body">
            <Skeleton className="skeleton--line" style={{ width: "55%", height: 14 }} />
            <Skeleton className="skeleton--line" style={{ width: "35%", height: 12, marginBottom: 0 }} />
          </div>
        </div>
      ))}
    </div>
  );
}
