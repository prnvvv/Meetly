"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@/components/common/ToastProvider";
import { ArrowLeftIcon } from "@/components/icons";
import { AppShell } from "@/components/layout/AppShell";
import { useFriends } from "@/hooks/useFriends";
import { useMediaDevices } from "@/hooks/useMediaDevices";
import { useRoomPreferences } from "@/hooks/useRoomPreferences";
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
  const devices = useMediaDevices();
  const { preferences } = useRoomPreferences();
  const { stop: stopDevices, refreshDevices } = devices;

  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const { friends, loading: friendsLoading } = useFriends();
  const [selectedFriends, setSelectedFriends] = useState<ReadonlySet<string>>(() => new Set());
  const [friendsOpen, setFriendsOpen] = useState(false);
  const [settings, setSettings] = useState<MeetingSettings>(DEFAULT_MEETING_SETTINGS);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"start" | "copy" | null>(null);
  const [devicesReady, setDevicesReady] = useState(false);
  const [cameraPending, setCameraPending] = useState(false);
  const [micPending, setMicPending] = useState(false);

  // Remembered so Start Meeting after Copy Invite Link reuses the same room.
  const createdRef = useRef<CreatedMeeting | null>(null);

  // Enumeration never prompts for permission; it only tells us when the lists are real.
  useEffect(() => {
    let active = true;
    void refreshDevices().then(() => {
      if (active) setDevicesReady(true);
    });
    return () => {
      active = false;
    };
  }, [refreshDevices]);

  // Release the camera and microphone when leaving the page (including when
  // navigating into the meeting, which acquires its own tracks).
  useEffect(() => stopDevices, [stopDevices]);

  const cameraOn = devices.isVideoOn;
  const micOn = devices.audioJoined && !devices.isMuted;

  const toggleCamera = useCallback(
    async (next: boolean) => {
      setCameraPending(true);
      try {
        await devices.setVideoOn(next);
      } finally {
        setCameraPending(false);
      }
    },
    [devices]
  );

  const toggleMic = useCallback(
    async (next: boolean) => {
      if (!devices.audioJoined) {
        if (!next) return;
        setMicPending(true);
        try {
          await devices.joinAudio();
        } finally {
          setMicPending(false);
        }
        return;
      }
      devices.setMuted(!next);
    },
    [devices]
  );

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

  /** Creates the meeting once per (title, password) pair and returns its id. */
  async function ensureMeeting(): Promise<CreatedMeeting> {
    const title = name.trim() || DEFAULT_TITLE;
    const secret = password.trim();
    const existing = createdRef.current;
    if (existing && existing.title === title && existing.password === secret) {
      // Same room: refresh the remembered setup choices, they may have changed.
      persistConfig(existing.meetingId);
      return existing;
    }
    const meeting = await createMeeting({ title, password: secret || undefined });
    if (secret) {
      window.sessionStorage.setItem(STORAGE_KEYS.meetingPassword(meeting.meeting_id), secret);
    }
    persistConfig(meeting.meeting_id);
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
              Back to Home
            </Link>
            <h1 className="nm-title">
              New{" "}
              <span className="relative inline-block">
                Meeting
                {/* Same three-ray accent as the landing page headline. */}
                <svg
                  aria-hidden="true"
                  viewBox="0 0 48 48"
                  className="pointer-events-none absolute left-full top-0 ml-[0.02em] hidden h-[0.95em] w-[0.95em] -translate-y-[54%] overflow-visible sm:block"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="4"
                  strokeLinecap="round"
                >
                  <path className="bloom-ray" style={{ "--i": 0 } as React.CSSProperties} pathLength={1} d="M6.9 32 L8.1 8.1" />
                  <path className="bloom-ray" style={{ "--i": 1 } as React.CSSProperties} pathLength={1} d="M13.1 33.6 L31.7 11.4" />
                  <path className="bloom-ray" style={{ "--i": 2 } as React.CSSProperties} pathLength={1} d="M15.7 39.4 L38.8 33.2" />
                </svg>
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
              selectedIds={selectedFriends}
              disabled={disabled}
              onToggle={toggleFriend}
              onClear={clearFriends}
              onOpenMore={() => setFriendsOpen(true)}
            />
            <EssentialMeetingSettings
              settings={settings}
              disabled={disabled}
              onChange={(key, value) => setSettings((current) => ({ ...current, [key]: value }))}
            />

            <MeetingActions busy={busy} onStart={startMeeting} onCopyLink={copyInviteLink} />
          </section>

          <MeetingSetupCard
            devices={devices}
            devicesReady={devicesReady}
            cameraOn={cameraOn}
            cameraPending={cameraPending}
            micOn={micOn}
            micPending={micPending}
            mirrorCamera={preferences.mirrorSelf}
            onCameraChange={toggleCamera}
            onMicChange={toggleMic}
          />
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
          toast(`${n} ${n === 1 ? "friend" : "friends"} added to this meeting's invite list`, "success");
        }}
      />
    </AppShell>
  );
}
