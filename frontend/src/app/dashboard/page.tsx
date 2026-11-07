"use client";

import React from "react";
import { ErrorState } from "@/components/common/ErrorState";
import { ActionTiles } from "@/components/dashboard/ActionTiles";
import { DashboardHero } from "@/components/dashboard/DashboardHero";
import { MeetingPanel, PanelSkeleton } from "@/components/dashboard/MeetingPanel";
import { AddRow, RecentRow, UpcomingRow } from "@/components/dashboard/MeetingRows";
import { PanelEmptyState } from "@/components/dashboard/PanelEmptyState";
import { AppShell } from "@/components/layout/AppShell";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { PREVIEW_LIMIT, useDashboardData } from "@/hooks/useDashboardData";
import { greetingForDate, todayLabel } from "@/lib/utils";

export default function DashboardPage() {
  const { user } = useCurrentUser();
  const { upcoming, recent, refresh } = useDashboardData();

  const firstName = user?.name?.split(" ")[0];
  const [now, setNow] = React.useState<Date | null>(null);

  React.useEffect(() => {
    // Deferred so the first client render matches the prerendered HTML; the
    // greeting depends on the viewer's clock and timezone, which the server
    // does not know.
    const id = window.setTimeout(() => setNow(new Date()), 0);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <AppShell>
      <DashboardHero
        greeting={now ? greetingForDate(now) : ""}
        firstName={firstName}
        dateLabel={now ? todayLabel(now) : ""}
      />

      <ActionTiles />

      <div className="dash-panels">
        <MeetingPanel title="Upcoming Meetings" id="upcoming" viewAllHref="/meetings">
          {upcoming.loading ? (
            <PanelSkeleton />
          ) : upcoming.error ? (
            <ErrorState message={upcoming.error} onRetry={refresh} />
          ) : upcoming.items.length === 0 ? (
            <PanelEmptyState
              illustration="/images/empty-upcoming.svg"
              title="No upcoming meetings"
              description="Your schedule is clear. Create a meeting or schedule one to get started."
              actionHref="/schedule"
              actionLabel="Schedule a Meeting"
            />
          ) : (
            <ul className="meeting-list">
              {upcoming.items.slice(0, PREVIEW_LIMIT).map((meeting) => (
                <UpcomingRow key={meeting.meeting_id} meeting={meeting} />
              ))}
              {upcoming.items.length < PREVIEW_LIMIT && (
                <AddRow href="/schedule" label="Schedule another meeting" />
              )}
            </ul>
          )}
        </MeetingPanel>

        <MeetingPanel title="Recent Meetings" id="recent" viewAllHref="/meetings?tab=recent">
          {recent.loading ? (
            <PanelSkeleton />
          ) : recent.error ? (
            <ErrorState message={recent.error} onRetry={refresh} />
          ) : recent.items.length === 0 ? (
            <PanelEmptyState
              illustration="/images/empty-recent.svg"
              title="No recent meetings"
              description="Your hosted and attended meetings will appear here."
              actionHref="/new-meeting"
              actionLabel="New Meeting"
            />
          ) : (
            <ul className="meeting-list">
              {recent.items.slice(0, PREVIEW_LIMIT).map((meeting) => (
                <RecentRow key={meeting.meeting_id} meeting={meeting} />
              ))}
              {recent.items.length < PREVIEW_LIMIT && (
                <AddRow href="/new-meeting" label="Start a new meeting" />
              )}
            </ul>
          )}
        </MeetingPanel>
      </div>
    </AppShell>
  );
}
