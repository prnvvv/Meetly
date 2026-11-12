"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { HeadingBloom } from "@/components/common/HeadingBloom";
import { useToast } from "@/components/common/ToastProvider";
import { ArrowLeftIcon } from "@/components/icons";
import { AppShell } from "@/components/layout/AppShell";
import { useFriends } from "@/hooks/useFriends";
import { describeInviteOutcome, inviteSelectedFriends } from "@/lib/inviteFriends";
import { useMeetingSetup } from "@/hooks/useMeetingSetup";
import { toUserMessage } from "@/lib/api-client";
import { STORAGE_KEYS } from "@/lib/constants";
import { buildInviteUrl, copyText } from "@/lib/utils";
import { saveMeetingConfig } from "@/lib/meetingConfig";
import { createMeeting } from "@/services/meetingService";
import { FriendsDialog } from "./FriendsDialog";
import { InvitePeopleSection } from "./InvitePeopleSection";
import { MeetingDetailsForm } from "./MeetingDetailsForm";
import { EssentialMeetingSettings } from "./EssentialMeetingSettings";
import { MeetingActions } from "./MeetingActions";
import { DEFAULT_MEETING_SETTINGS, type MeetingSettings } from "./MeetingSettingsList";
import { MeetingSetupCard } from "./MeetingSetupCard";

const DEFAULT_TITLE = "Instant Meeting";

interface CreatedMeeting {
  meetingId: string;
  title: string;
  password: string;
}

export function NewMeetingPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { cardProps } = useMeetingSetup();

  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const { friends, loading: friendsLoading, error: friendsError, reload: reloadFriends } = useFriends();
  const [invitedFriends, setInvitedFriends] = useState<ReadonlySet<string>>(() => new Set());
  const [selectedFriends, setSelectedFriends] = useState<ReadonlySet<string>>(() => new Set());
  const [friendsOpen, setFriendsOpen] = useState(false);
  const [settings, setSettings] = useState<MeetingSettings>(DEFAULT_MEETING_SETTINGS);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"start" | "copy" | null>(null);

  // Remembered so Start Meeting after Copy Invite Link reuses the same room.
  const createdRef = useRef<CreatedMeeting | null>(null);

  const toggleFriend = useCallback((id: string) => {
    setSelectedFriends((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const clearFriends = useCallback(() => setSelectedFriends(new Set()), []);
  const closeFriends = useCallback(() => setFriendsOpen(false), []);

  /** The title/password go to the API; the rest is remembered with the meeting for the room. */
  function persistConfig(meetingId: string) {
    saveMeetingConfig(meetingId, {
      settings: { ...settings },
      invitedFriendIds: [...selectedFriends],
    });
  }

  /** Real invitations for the picked friends (the server ignores ones already sent). */
  async function sendInvites(meetingId: string) {
    const outcome = await inviteSelectedFriends(meetingId, selectedFriends);
    const message = describeInviteOutcome(outcome);
    if (message) toast(message.text, message.kind);
    if (outcome.invitedIds.length > 0) {
      // They hold an invitation now: show them as invited and stop offering them again.
      setInvitedFriends((current) => new Set([...current, ...outcome.invitedIds]));
      setSelectedFriends((current) => new Set([...current].filter((id) => !outcome.invitedIds.includes(id))));
    }
  }

  /** Creates the meeting once per (title, password) pair and returns its id. */
  async function ensureMeeting(): Promise<CreatedMeeting> {
    const title = name.trim() || DEFAULT_TITLE;
    const secret = password.trim();
    const existing = createdRef.current;
    if (existing && existing.title === title && existing.password === secret) {
      // Same room: refresh the remembered setup choices, they may have changed.
      persistConfig(existing.meetingId);
      await sendInvites(existing.meetingId);
      return existing;
    }
    const meeting = await createMeeting({ title, password: secret || undefined, settings: { ...settings } });
    if (secret) {
      window.sessionStorage.setItem(STORAGE_KEYS.meetingPassword(meeting.meeting_id), secret);
    }
    persistConfig(meeting.meeting_id);
    await sendInvites(meeting.meeting_id);
    const created = { meetingId: meeting.meeting_id, title, password: secret };
    createdRef.current = created;
    return created;
  }

  async function startMeeting() {
    setBusy("start");
    setError(null);
    try {
      const { meetingId } = await ensureMeeting();
      router.push(`/meetings/${meetingId}`);
    } catch (cause) {
      setError(toUserMessage(cause));
      setBusy(null);
    }
  }

  async function copyInviteLink() {
    setBusy("copy");
    setError(null);
    try {
      const { meetingId } = await ensureMeeting();
      const ok = await copyText(buildInviteUrl(meetingId));
      toast(ok ? "Invite link copied" : "Couldn't copy the link. Copy it from the address bar in the room.", ok ? "success" : "error");
    } catch (cause) {
      setError(toUserMessage(cause));
    } finally {
      setBusy(null);
    }
  }

  const disabled = busy !== null;

  return (
    <AppShell fit>
      <div className="nm-page">
        <header className="nm-header">
          <div className="nm-header__text">
            <Link href="/dashboard" className="nm-back">
              <ArrowLeftIcon size={16} />
              Back to Dashboard
            </Link>
            <h1 className="nm-title">
              New{" "}
              <span className="relative inline-block">
                Meeting
                <HeadingBloom />
              </span>
            </h1>
            <p className="nm-subtitle">
              Create a meeting room, set your preferences, and start meeting instantly.
            </p>
          </div>
        </header>

        <div className="nm-grid">
          <section className="nm-card nm-card--create" aria-labelledby="nm-create-title">
            <h2 className="sr-only" id="nm-create-title">
              Meeting details
            </h2>
            {error ? (
              <div className="form-error-banner" role="alert">
                {error}
              </div>
            ) : null}

            <MeetingDetailsForm
              name={name}
              password={password}
              disabled={disabled}
              onNameChange={setName}
              onPasswordChange={setPassword}
            />
            <InvitePeopleSection
              friends={friends}
              loading={friendsLoading}
              error={friendsError}
              onRetry={reloadFriends}
              selectedIds={selectedFriends}
              invitedIds={invitedFriends}
              disabled={disabled}
              onToggle={toggleFriend}
              onClear={clearFriends}
              onOpenMore={() => setFriendsOpen(true)}
              onCopyLink={() => void copyInviteLink()}
            />
            <EssentialMeetingSettings
              settings={settings}
              disabled={disabled}
              onChange={(key, value) => setSettings((current) => ({ ...current, [key]: value }))}
            />

            <MeetingActions busy={busy} onStart={startMeeting} onCopyLink={copyInviteLink} />
          </section>

          <MeetingSetupCard {...cardProps} />
        </div>
      </div>
      <FriendsDialog
        open={friendsOpen}
        friends={friends}
        selectedIds={selectedFriends}
        onToggle={toggleFriend}
        onClose={closeFriends}
        onInviteSelected={() => {
          setFriendsOpen(false);
          const n = selectedFriends.size;
          toast(`${n} ${n === 1 ? "friend" : "friends"} will be invited when you start the meeting`, "success");
        }}
      />
    </AppShell>
  );
}
