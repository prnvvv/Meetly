"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { ErrorState } from "@/components/common/ErrorState";
import { SkeletonList } from "@/components/common/Skeleton";
import { RecentMeetingCard } from "@/components/dashboard/RecentMeetingCard";
import { UpcomingMeetingCard } from "@/components/dashboard/UpcomingMeetingCard";
import { AppShell } from "@/components/layout/AppShell";
import {
  MAX_LIST_LIMIT,
  useMeetingList,
  type MeetingListKind,
} from "@/hooks/useMeetingList";

const TABS: Array<{ key: MeetingListKind; label: string }> = [
  { key: "upcoming", label: "Upcoming" },
  { key: "recent", label: "Recent" },
];

function EmptyPanel({ tab }: { tab: MeetingListKind }) {
  return (
    <div className="cta-panel">
      <p className="cta-panel__title">
        {tab === "upcoming" ? "No upcoming meetings" : "No recent meetings"}
      </p>
      <p className="cta-panel__text">
        {tab === "upcoming"
          ? "Schedule a meeting and it will appear here with its invite link."
          : "Meetings you have hosted or attended will show up here once they finish."}
      </p>
      <Link href="/schedule" className="btn btn--primary">
        Schedule a Meeting
      </Link>
    </div>
  );
}

/** `?tab=recent` support without useSearchParams (keeps the page statically prerendered). */
function useRequestedTab(): MeetingListKind {
  const requested = useSyncExternalStore(
    () => () => {},
    () => new URLSearchParams(window.location.search).get("tab"),
    () => null
  );
  return requested === "recent" ? "recent" : "upcoming";
}

export default function MeetingsPage() {
  const requested = useRequestedTab();
  const [chosen, setChosen] = useState<MeetingListKind | null>(null);
  const tab = chosen ?? requested;

  const upcoming = useMeetingList("upcoming");
  const recent = useMeetingList("recent");
  const active = tab === "upcoming" ? upcoming : recent;

  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1 className="page-header__title">Meetings</h1>
          <p className="page-header__subtitle">
            Everything you have scheduled and everything you have attended.
          </p>
        </div>
        <div className="page-header__actions">
          <Link href="/schedule" className="btn btn--primary">
            Schedule
          </Link>
        </div>
      </div>

      <div className="tabs page-tabs" role="tablist" aria-label="Meeting lists">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            id={`meetings-tab-${item.key}`}
            aria-selected={tab === item.key}
            aria-controls="meetings-panel"
            className="tab"
            onClick={() => setChosen(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <section
        className="tab-panel section__body"
        id="meetings-panel"
        role="tabpanel"
        aria-labelledby={`meetings-tab-${tab}`}
      >
        {active.loading ? (
          <SkeletonList rows={3} />
        ) : active.error && active.items.length === 0 ? (
          <ErrorState message={active.error} onRetry={active.retry} />
        ) : active.items.length === 0 ? (
          <EmptyPanel tab={tab} />
        ) : (
          <>
            {tab === "upcoming"
              ? active.items.map((meeting) => (
                  <UpcomingMeetingCard key={meeting.meeting_id} meeting={meeting} />
                ))
              : active.items.map((meeting) => (
                  <RecentMeetingCard key={meeting.meeting_id} meeting={meeting} />
                ))}

            {active.error ? (
              <p className="field__error" role="alert">
                {active.error}
              </p>
            ) : null}

            <div className="load-more">
              <p className="load-more__count" aria-live="polite">
                Showing {active.items.length}{" "}
                {active.items.length === 1 ? "meeting" : "meetings"}
                {active.capped ? ` (the latest ${MAX_LIST_LIMIT})` : ""}
              </p>
              {active.hasMore ? (
                <button
                  type="button"
                  className="btn btn--secondary"
                  onClick={active.loadMore}
                  disabled={active.loadingMore}
                >
                  {active.loadingMore ? "Loading…" : "Load more"}
                </button>
              ) : null}
            </div>
          </>
        )}
      </section>
    </AppShell>
  );
}
