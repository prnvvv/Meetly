"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ActionTiles } from "@/components/dashboard/ActionTiles";
import { CalendarWorkspace } from "@/components/dashboard/CalendarWorkspace";
import { MeetingLists } from "@/components/dashboard/MeetingLists";
import { ClockIcon } from "@/components/icons";
import { AppShell } from "@/components/layout/AppShell";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { PREVIEW_LIMIT, useDashboardData } from "@/hooks/useDashboardData";
import { formatCountdown, formatDayLabel, formatTime, greetingForDate, todayLabel } from "@/lib/utils";

export default function DashboardPage() {
  const { user } = useCurrentUser();
  const { upcoming, recent, refresh } = useDashboardData(PREVIEW_LIMIT);
  const [reloadKey, setReloadKey] = useState(0);
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    // Client clock after mount: the greeting depends on the viewer's timezone,
    // which the server does not know, and this keeps hydration consistent.
    const tick = () => setNow(new Date());
    const first = window.setTimeout(tick, 0);
    const interval = window.setInterval(tick, 30_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(interval);
    };
  }, []);

  const changed = useCallback(() => {
    setReloadKey((key) => key + 1);
    void refresh();
  }, [refresh]);

  const firstName = user?.name?.split(" ")[0];
  const next = upcoming.items[0];
  const subtitle = upcoming.loading
    ? "Checking your schedule…"
    : next
      ? "Here’s what’s coming up on your calendar."
      : "Your schedule is clear. Start or plan a meeting below.";

  return (
    <AppShell fit>
      <section className="dash-top" aria-labelledby="dash-greeting">
        <div className="dash-top__text">
          <h1 className="dash-top__title" id="dash-greeting">
            {now ? greetingForDate(now) : ""}
            {now && firstName ? `, ${firstName}` : ""}
          </h1>
          <p className="dash-top__sub">
            <span>{now ? todayLabel(now) : ""}</span>
            <span className="dash-top__dot" aria-hidden="true">
              ·
            </span>
            <span>{subtitle}</span>
          </p>
        </div>
        {next ? (
          <Link href={`/meetings/${next.meeting_id}`} className="next-chip" aria-label={`Next meeting: ${next.title}`}>
            <ClockIcon size={16} aria-hidden="true" />
            <span className="next-chip__text">
              <span className="next-chip__label">
                Next · {now ? formatCountdown(next.start_time, now.getTime()) : ""}
              </span>
              <span className="next-chip__title">
                {next.title} · {formatDayLabel(next.start_time)}, {formatTime(next.start_time)}
              </span>
            </span>
          </Link>
        ) : null}
      </section>

      <ActionTiles />

      <div className="workspace">
        <CalendarWorkspace reloadKey={reloadKey} onChanged={changed} />
        <MeetingLists
          upcoming={upcoming}
          recent={recent}
          limit={PREVIEW_LIMIT}
          onRetry={refresh}
          onChanged={changed}
        />
      </div>
    </AppShell>
  );
}
