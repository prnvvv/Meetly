import Link from "next/link";
import { HeadingBloom } from "@/components/common/HeadingBloom";
import { ScheduleForm } from "@/components/dashboard/ScheduleForm";
import { ArrowLeftIcon } from "@/components/icons";
import { AppShell } from "@/components/layout/AppShell";

export default function SchedulePage() {
  return (
    <AppShell fit>
      <div className="nm-page sm-page">
        <header className="nm-header">
          <div className="nm-header__text">
            <Link href="/dashboard" className="nm-back">
              <ArrowLeftIcon size={16} />
              Back to Dashboard
            </Link>
            <h1 className="nm-title">
              Schedule a{" "}
              <span className="relative inline-block">
                Meeting
                <HeadingBloom />
              </span>
            </h1>
            <p className="nm-subtitle">
              Pick a topic, a time and a duration. You get an invite link as soon as it is saved.
            </p>
          </div>
        </header>

        <ScheduleForm />
      </div>
    </AppShell>
  );
}
