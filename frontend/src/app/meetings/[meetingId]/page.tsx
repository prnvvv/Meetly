"use client";

import { useUser } from "@clerk/nextjs";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { useToast } from "@/components/common/ToastProvider";
import { HeadingBloom } from "@/components/common/HeadingBloom";
import {
  AlertIcon,
  CheckIcon,
  LinkIcon,
  MicIcon,
  MicOffIcon,
  PinIcon,
  XIcon,
} from "@/components/icons";
import { ControlBar, type SettingsTab } from "@/components/meeting/ControlBar";
import { MeetingSettingsDialog } from "@/components/meeting/MeetingSettingsDialog";
import { ParticipantAvatar } from "@/components/meeting/ParticipantAvatar";
import { MeetingTopBar } from "@/components/meeting/MeetingTopBar";
import { ParticipantGrid, type StageTile } from "@/components/meeting/ParticipantGrid";
import { ParticipantsPanel } from "@/components/meeting/ParticipantsPanel";
import { useActiveSpeakerId } from "@/hooks/useActiveSpeaker";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useFullscreen } from "@/hooks/useFullscreen";
import { useMeeting } from "@/hooks/useMeeting";
import { useMeetingRoom } from "@/hooks/useMeetingRoom";
import {
  readPinnedParticipant,
  useRoomPreferences,
  writePinnedParticipant,
} from "@/hooks/useRoomPreferences";
import { STORAGE_KEYS } from "@/lib/constants";
import {
  buildInviteUrl,
  copyText,
  cx,
  formatDateShort,
  formatTime,
} from "@/lib/utils";
import type { ParticipantSummary } from "@/types/participant";

// Dark dotted room theme; loaded after the shared stylesheets so it wins the cascade.
import "@/styles/room-theme.css";

/** sessionStorage is not observable; re-read on any re-render instead. */
const subscribeToSessionName = () => () => {};

function connectionLabel(status: string): string {
  switch (status) {
    case "connected":
      return "Connected";
    case "reconnecting":
      return "Reconnecting…";
    case "disconnected":
      return "Disconnected";
    default:
      return "Connecting…";
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable
  );
}

/** Full-room state (ended, removed, error): one illustration, one heading, one action. */
function RoomScreen({
  title,
  body,
  avatar,
  children,
}: {
  title: string;
  body: string;
  /** Which of the existing people illustrations to show (wraps around). */
  avatar: number;
  children: React.ReactNode;
}) {
  const words = title.split(" ");
  const last = words.pop();
  return (
    <div className="room room-loading">
      <div className="room-overlay-screen">
        <ParticipantAvatar name="Meetly" variant={avatar} size={120} accent={false} />
        <h1 className="room-overlay-screen__title">
          {words.join(" ")}{" "}
          <span className="relative inline-block">
            {last}
            <HeadingBloom />
          </span>
        </h1>
        <div className="room-overlay-screen__text">{body}</div>
        {children}
      </div>
    </div>
  );
}

export default function MeetingRoomPage() {
  const params = useParams<{ meetingId: string }>();
  const meetingId = params.meetingId;
  const router = useRouter();
  const { toast } = useToast();
  const { user } = useCurrentUser();
  const { user: clerkUser } = useUser();
  // Only a photo the user actually uploaded; Clerk's generated default is skipped.
  const localImageUrl = clerkUser?.hasImage ? clerkUser.imageUrl : null;
  const { meeting, participants, loading, error, notFound, refresh } =
    useMeetingRoom(meetingId);

  const [panelOpen, setPanelOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [pinnedId, setPinnedId] = useState<number | null>(null);

  const prefs = useRoomPreferences();
  const {
    ref: roomRef,
    isFullscreen,
    supported: fullscreenSupported,
    toggle: toggleFullscreen,
  } = useFullscreen<HTMLDivElement>();

  const storedName = useSyncExternalStore(
    subscribeToSessionName,
    () => window.sessionStorage.getItem(STORAGE_KEYS.displayName) ?? "",
    () => ""
  );
  const localName = storedName || user?.name || "You";

  const storedPassword = useSyncExternalStore(
    subscribeToSessionName,
    () => window.sessionStorage.getItem(STORAGE_KEYS.meetingPassword(meetingId)) ?? "",
    () => ""
  );

  const session = useMeeting({
    meeting,
    meetingId,
    displayName: localName,
    password: storedPassword,
  });
  const settingsOpen = settingsTab !== null;

  // Restore the pinned participant once we are in the browser (deferred so
  // hydration sees the same value the server rendered).
  useEffect(() => {
    const stored = readPinnedParticipant(meetingId);
    if (stored === null) return;
    const timer = window.setTimeout(() => setPinnedId(stored), 0);
    return () => window.clearTimeout(timer);
  }, [meetingId]);

  const togglePin = useCallback(
    (participantId: number) => {
      setPinnedId((current) => {
        const next = current === participantId ? null : participantId;
        writePinnedParticipant(meetingId, next);
        return next;
      });
    },
    [meetingId]
  );

  const activeSpeakerId = useActiveSpeakerId({
    selfId: session.selfId,
    localStream: session.localStream,
    remoteStreams: session.remoteStreams,
  });

  const [inviteCopied, setInviteCopied] = useState(false);
  useEffect(() => {
    if (!inviteCopied) return;
    const timer = window.setTimeout(() => setInviteCopied(false), 2200);
    return () => window.clearTimeout(timer);
  }, [inviteCopied]);

  const copyInvite = async () => {
    const ok = await copyText(buildInviteUrl(meetingId));
    setInviteCopied(ok);
    toast(
      ok ? "Invite link copied" : "Could not copy the invite link",
      ok ? "success" : "error"
    );
  };

  const leaveRoom = () => {
    session.leave();
    router.push("/dashboard");
  };

  const openSettings = useCallback((tab: SettingsTab) => {
    setSettingsTab(tab);
    setPanelOpen(false);
  }, []);

  const toggleParticipants = useCallback(() => {
    setPanelOpen((open) => !open);
    setSettingsTab(null);
  }, []);

  const endMeetingForAll = session.endMeeting;
  const muteEveryone = session.muteAll;

  const endMeeting = useCallback(() => {
    setConfirmEnd(false);
    endMeetingForAll();
  }, [endMeetingForAll]);

  const muteAll = useCallback(() => {
    muteEveryone();
    toast("Asked everyone to mute", "success");
  }, [muteEveryone, toast]);

  // One overlay at a time; Escape closes whichever is open.
  useEffect(() => {
    if (!panelOpen && !settingsOpen && !confirmEnd) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setPanelOpen(false);
      setSettingsTab(null);
      setConfirmEnd(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [panelOpen, settingsOpen, confirmEnd]);

  // Room shortcuts: M mute, V video, P participants, F fullscreen.
  const joined = session.phase === "joined";
  const { toggleMute, toggleVideo } = session;
  useEffect(() => {
    if (!joined) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      if (settingsTab !== null || confirmEnd) return;
      const key = event.key.toLowerCase();
      if (key === "m") {
        event.preventDefault();
        toggleMute();
      } else if (key === "v") {
        event.preventDefault();
        toggleVideo();
      } else if (key === "p") {
        event.preventDefault();
        setPanelOpen((open) => !open);
      } else if (key === "f" && fullscreenSupported) {
        event.preventDefault();
        toggleFullscreen();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [
    joined,
    settingsTab,
    confirmEnd,
    toggleMute,
    toggleVideo,
    fullscreenSupported,
    toggleFullscreen,
  ]);

  const reactionsByParticipant = useMemo(() => {
    const grouped = new Map<number, string[]>();
    for (const reaction of session.reactions) {
      const list = grouped.get(reaction.participantId);
      if (list) {
        list.push(reaction.emoji);
      } else {
        grouped.set(reaction.participantId, [reaction.emoji]);
      }
    }
    return grouped;
  }, [session.reactions]);

  if (loading) {
    return (
      <div className="room room-loading">
        <span className="spinner" aria-hidden="true" />
        Loading meeting…
      </div>
    );
  }

  if (notFound) {
    return (
      <RoomScreen
        avatar={0}
        title="Meeting not found"
        body="We could not find that meeting. Check the link and try again."
      >
        <Link href="/dashboard" className="btn btn--primary">
          Back to dashboard
        </Link>
      </RoomScreen>
    );
  }

  if (error) {
    return (
      <RoomScreen avatar={1} title="Could not open the meeting" body={error}>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => void refresh()}
        >
          Try again
        </button>
        <Link href="/dashboard" className="btn btn--ghost">
          Back to dashboard
        </Link>
      </RoomScreen>
    );
  }

  if (meeting && (meeting.status === "ended" || meeting.status === "cancelled")) {
    return (
      <RoomScreen
        avatar={2}
        title="This meeting has ended"
        body={`${meeting.title} is no longer running.`}
      >
        <Link href="/dashboard" className="btn btn--primary">
          Back to dashboard
        </Link>
      </RoomScreen>
    );
  }

  if (!meeting) {
    return null;
  }

  if (session.phase === "left") {
    return null;
  }

  if (session.phase === "ended") {
    return (
      <RoomScreen
        avatar={2}
        title="This meeting has ended"
        body="The meeting is no longer running."
      >
        <Link href="/dashboard" className="btn btn--primary">
          Back to dashboard
        </Link>
      </RoomScreen>
    );
  }

  if (session.phase === "removed") {
    return (
      <RoomScreen
        avatar={1}
        title="You were removed"
        body="The host removed you from this meeting."
      >
        <Link href="/dashboard" className="btn btn--primary">
          Back to dashboard
        </Link>
      </RoomScreen>
    );
  }

  if (session.phase === "rejected" || session.phase === "failed") {
    return (
      <RoomScreen
        avatar={0}
        title="Could not join the meeting"
        body={
          session.failure ?? "Something went wrong while joining the meeting."
        }
      >
        <button
          type="button"
          className="btn btn--primary"
          onClick={session.retry}
        >
          Try again
        </button>
        <Link href="/dashboard" className="btn btn--ghost">
          Back to dashboard
        </Link>
      </RoomScreen>
    );
  }

  if (
    session.phase === "joining" &&
    session.connection === "disconnected"
  ) {
    return (
      <RoomScreen
        avatar={1}
        title="Could not connect"
        body="The meeting service is unreachable. Check your connection and try again."
      >
        <button
          type="button"
          className="btn btn--primary"
          onClick={session.retry}
        >
          Try again
        </button>
        <Link href="/dashboard" className="btn btn--ghost">
          Back to dashboard
        </Link>
      </RoomScreen>
    );
  }

  // Host status comes from the server once joined; the local user id is only
  // a pre-join hint.
  const isLocalHost = session.phase === "joined" && session.isHost;
  const roster: ParticipantSummary[] =
    session.phase === "joined" ? session.participants : participants;
  const others = roster.filter((participant) => {
    if (session.selfId !== null) return participant.id !== session.selfId;
    return participant.display_name !== localName;
  });
  const scheduledNotice = meeting.status === "scheduled";
  const connectionLost =
    session.phase === "joined" && session.connection === "disconnected";
  const reconnecting =
    session.phase === "joined" && session.connection === "reconnecting";
  const audioVideoOffNotice =
    joined &&
    roster.length > 1 && // alone, the waiting canvas already says what to do
    !session.audioJoined &&
    !session.isVideoOn &&
    !session.mediaError;


  const selfKey = session.selfId ?? -1;
  const tiles: StageTile[] = [
    {
      id: selfKey,
      name: localName,
      isMuted: session.isMuted,
      isHost: isLocalHost,
      isVideoOn: session.isVideoOn,
      stream: session.localStream,
      reactions: reactionsByParticipant.get(selfKey) ?? [],
      isSelf: true,
      imageUrl: localImageUrl,
    },
    ...others.map((participant) => ({
      id: participant.id,
      name: participant.display_name,
      isMuted: participant.is_muted,
      isHost: participant.is_host,
      isVideoOn: participant.is_video_on,
      stream: session.remoteStreams[participant.id] ?? null,
      reactions: reactionsByParticipant.get(participant.id) ?? [],
      isSelf: false,
    })),
  ];

  const renderTileMenu = (tile: StageTile) => (
    <div className="tile__menu-actions">
      <button
        type="button"
        className="tile__menu-button"
        aria-pressed={pinnedId === tile.id}
        aria-label={
          pinnedId === tile.id
            ? `Unpin ${tile.name}`
            : `Pin ${tile.name} to the stage`
        }
        onClick={() => togglePin(tile.id)}
      >
        <PinIcon size={15} />
        {pinnedId === tile.id ? "Unpin" : "Pin"}
      </button>
      {session.isHost && !tile.isSelf ? (
        <>
          <button
            type="button"
            className="tile__menu-button"
            aria-label={
              tile.isMuted
                ? `Ask ${tile.name} to unmute`
                : `Mute ${tile.name}`
            }
            onClick={() => session.muteParticipant(tile.id, !tile.isMuted)}
          >
            {tile.isMuted ? <MicIcon size={15} /> : <MicOffIcon size={15} />}
            {tile.isMuted ? "Unmute" : "Mute"}
          </button>
          <button
            type="button"
            className="tile__menu-button tile__menu-button--danger"
            aria-label={`Remove ${tile.name} from the meeting`}
            onClick={() => session.removeParticipant(tile.id)}
          >
            <XIcon size={15} />
            Remove
          </button>
        </>
      ) : null}
    </div>
  );

  return (
    <div
      className={cx("room", panelOpen && "room--panel")}
      ref={roomRef}
    >
      <span className="visually-hidden" role="status" aria-live="polite">
        {`${connectionLabel(session.connection)}. ${roster.length} in the meeting.`}
      </span>

      <MeetingTopBar
        title={meeting.title}
        hostName={roster.find((participant) => participant.is_host)?.display_name}
        meetingId={meeting.meeting_id}
        connection={session.connection}
        participantCount={roster.length}
        isLive={meeting.status === "active"}
        participantsOpen={panelOpen}
        isFullscreen={isFullscreen}
        fullscreenSupported={fullscreenSupported}
        onToggleParticipants={toggleParticipants}
        onCopyInvite={() => void copyInvite()}
        onToggleFullscreen={toggleFullscreen}
      />

      <div className="room__notices">
        {scheduledNotice ? (
          <div className="room-notice">
            <AlertIcon size={16} />
            Scheduled for {formatDateShort(meeting.start_time)} at{" "}
            {formatTime(meeting.start_time)}
          </div>
        ) : null}

        {connectionLost ? (
          <div className="room-notice room-notice--error">
            <AlertIcon size={16} />
            Connection lost.
            <button
              type="button"
              className="room__chip room-notice__action"
              onClick={session.reconnect}
            >
              Reconnect
            </button>
          </div>
        ) : null}

        {reconnecting ? (
          <div className="room-notice room-notice--warning" role="status">
            <span className="room-notice__spinner" aria-hidden="true" />
            Reconnecting…
          </div>
        ) : null}

        {session.mediaError ? (
          <div className="room-notice room-notice--warning" role="status">
            <AlertIcon size={16} />
            {session.mediaError}
          </div>
        ) : null}

        {audioVideoOffNotice ? (
          <div className="room-notice room-notice--info">
            <MicOffIcon size={16} />
            Your microphone and camera are off. Click Join Audio or Start Video
            when you&apos;re ready.
          </div>
        ) : null}
      </div>

      <main className="room__stage">
        <ParticipantGrid
          tiles={tiles}
          layout={prefs.preferences.layout}
          activeSpeakerId={activeSpeakerId}
          pinnedId={pinnedId}
          mirroredSelf={prefs.preferences.mirrorSelf}
          renderMenu={renderTileMenu}
          soloHint={
            <div className="solo-hint">
              <h2 className="solo-hint__title">Waiting for others to join</h2>
              <p className="solo-hint__text">Share the invite link to get started</p>
              <button
                type="button"
                className="solo-hint__button"
                data-copied={inviteCopied || undefined}
                onClick={() => void copyInvite()}
              >
                {inviteCopied ? <CheckIcon size={16} /> : <LinkIcon size={16} />}
                <span aria-live="polite">
                  {inviteCopied ? "Copied" : "Copy invite link"}
                </span>
              </button>
            </div>
          }
        />
      </main>

      <ControlBar
        isMuted={session.isMuted}
        isVideoOn={session.isVideoOn}
        audioJoined={session.audioJoined}
        audioAvailable={session.audioAvailable}
        audioPending={session.audioPending}
        videoPending={session.videoPending}
        videoAvailable={session.videoAvailable}
        participantsOpen={panelOpen}
        isHost={session.isHost}
        layout={prefs.preferences.layout}
        isFullscreen={isFullscreen}
        fullscreenSupported={fullscreenSupported}
        devices={session.devices}
        onToggleMute={session.toggleMute}
        onToggleVideo={session.toggleVideo}
        onToggleParticipants={toggleParticipants}
        onReact={session.sendReaction}
        onSetLayout={prefs.setLayout}
        onOpenSettings={openSettings}
        onToggleFullscreen={toggleFullscreen}
        onCopyInvite={() => void copyInvite()}
        onMuteAll={session.isHost ? muteAll : undefined}
        onEndMeeting={session.isHost ? () => setConfirmEnd(true) : undefined}
        onLeave={leaveRoom}
      />

      <MeetingSettingsDialog
        open={settingsOpen}
        tab={settingsTab ?? "general"}
        onTabChange={setSettingsTab}
        devices={session.devices}
        preferences={prefs.preferences}
        localStream={session.localStream}
        isFullscreen={isFullscreen}
        fullscreenSupported={fullscreenSupported}
        onSetLayout={prefs.setLayout}
        onSetMirrorSelf={prefs.setMirrorSelf}
        onToggleFullscreen={toggleFullscreen}
        onClose={() => setSettingsTab(null)}
      />

      {panelOpen ? (
        <>
          <div
            className="room-panel__backdrop"
            onClick={() => setPanelOpen(false)}
            aria-hidden="true"
          />
          <ParticipantsPanel
            participants={roster}
            meetingId={meetingId}
            localName={localName}
            isHost={session.isHost}
            selfId={session.selfId}
            pinnedId={pinnedId}
            onTogglePin={togglePin}
            onClose={() => setPanelOpen(false)}
            onMuteParticipant={
              session.isHost ? session.muteParticipant : undefined
            }
            onRemoveParticipant={
              session.isHost ? session.removeParticipant : undefined
            }
            onMuteAll={session.isHost ? muteAll : undefined}
            onEndMeeting={session.isHost ? () => setConfirmEnd(true) : undefined}
          />
        </>
      ) : null}

      <ConfirmDialog
        open={confirmEnd}
        title="End meeting for everyone?"
        message="Every participant will be disconnected. This cannot be undone."
        confirmLabel="End meeting"
        destructive
        onConfirm={endMeeting}
        onCancel={() => setConfirmEnd(false)}
      />
    </div>
  );
}
