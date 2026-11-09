"use client";

import Link from "next/link";
import { HeadingBloom } from "@/components/common/HeadingBloom";
import { ArrowLeftIcon } from "@/components/icons";
import { AppShell } from "@/components/layout/AppShell";
import { MeetingSetupCard } from "@/components/meeting/MeetingSetupCard";
import { useMeetingSetup } from "@/hooks/useMeetingSetup";
import { JoinForm } from "./JoinForm";

/** /join: entry form on the left, the same Meeting Setup card as /new-meeting on the right. */
export function JoinMeetingPage() {
  const { cardProps } = useMeetingSetup();

  return (
    <AppShell fit>
      <div className="nm-page jm-page">
        <header className="nm-header">
          <div className="nm-header__text">
            <Link href="/dashboard" className="nm-back">
              <ArrowLeftIcon size={16} />
              Back to Dashboard
            </Link>
            <h1 className="nm-title">
              Join a{" "}
              <span className="relative inline-block">
                Meeting
                <HeadingBloom />
              </span>
            </h1>
            <p className="nm-subtitle">
              Paste an invite link or enter a meeting code, set your name, and join the meeting.
            </p>
          </div>
        </header>

        <div className="nm-grid">
          <JoinForm />
          <MeetingSetupCard {...cardProps} largeIllustration />
        </div>
      </div>
    </AppShell>
  );
}
