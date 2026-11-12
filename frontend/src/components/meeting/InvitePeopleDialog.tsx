"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/components/common/ToastProvider";
import { CheckIcon, CopyIcon, SearchIcon } from "@/components/icons";
import { useFriends } from "@/hooks/useFriends";
import { toUserMessage } from "@/lib/api-client";
import { openFriendsPanel } from "@/lib/friendsPanel";
import { buildInviteUrl, copyText } from "@/lib/utils";
import { inviteToMeeting, listMeetingInvitations } from "@/services/socialService";
import { ParticipantAvatar } from "./ParticipantAvatar";

interface InvitePeopleDialogProps {
  open: boolean;
  meetingId: string;
  /** Tell people what they still need after opening the link. */
  waitingRoomEnabled?: boolean;
  onClose: () => void;
}

type InviteState = "PENDING" | "ACCEPTED" | "DECLINED" | "CANCELLED" | "EXPIRED";

const STATE_LABEL: Record<InviteState, string> = {
  PENDING: "Invited",
  ACCEPTED: "Accepted",
  DECLINED: "Declined",
  CANCELLED: "Cancelled",
  EXPIRED: "Expired",
};

/** States that already hold (or held) an answer worth keeping: do not offer them again. */
const BLOCKING: ReadonlySet<InviteState> = new Set(["PENDING", "ACCEPTED"]);

/**
 * Invite people from inside a live meeting: copy the link, or pick friends and send real
 * invitations. Invitations never bypass the password or the waiting room; the server decides
 * who may be invited and returns the status shown here.
 */
export function InvitePeopleDialog({ open, meetingId, waitingRoomEnabled = false, onClose }: InvitePeopleDialogProps) {
  const { toast } = useToast();
  const { friends, loading, error, reload } = useFriends();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [statuses, setStatuses] = useState<Record<string, InviteState>>({});
  const [statusError, setStatusError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const refreshStatuses = useCallback(async () => {
    try {
      const rows = await listMeetingInvitations(meetingId);
      setStatuses(Object.fromEntries(rows.map((r) => [String(r.person.user_id), r.status])));
      setStatusError(null);
    } catch (cause) {
      setStatusError(toUserMessage(cause));
    }
  }, [meetingId]);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelected(new Set());
    setSendError(null);
    void refreshStatuses();
    searchRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, refreshStatuses]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle
      ? friends.filter((f) => f.name.toLowerCase().includes(needle) || f.username.toLowerCase().includes(needle))
      : friends;
  }, [friends, query]);

  if (!open) return null;

  const blocked = (id: string) => BLOCKING.has(statuses[id] as InviteState);

  const toggle = (id: string) => {
    if (blocked(id) || sending) return;
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const copyLink = async () => {
    const ok = await copyText(buildInviteUrl(meetingId));
    toast(ok ? "Invite link copied" : "Could not copy the link", ok ? "success" : "error");
  };

  const send = async () => {
    const ids = [...selected].map(Number).filter((n) => Number.isInteger(n) && n > 0);
    if (ids.length === 0 || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const result = await inviteToMeeting(meetingId, ids);
      const skipped = result.results.filter((r) => r.result === "unavailable").length;
      if (result.invited > 0) {
        toast(`${result.invited} ${result.invited === 1 ? "friend" : "friends"} invited`, "success");
      }
      if (skipped > 0) {
        setSendError(`${skipped} could not be invited (they may no longer be your friend).`);
      }
      setSelected(new Set());
      await refreshStatuses();
    } catch (cause) {
      // 404/409 mean the meeting is gone or over; anything else may work if tried again.
      setSendError(toUserMessage(cause));
    } finally {
      setSending(false);
    }
  };

  const count = selected.size;
  const hasFriends = friends.length > 0;

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="dialog nm-dialog ip-dialog" role="dialog" aria-modal="true" aria-labelledby="ip-title">
        <h2 className="dialog__title" id="ip-title">
          Invite people
        </h2>

        <div className="ip-link">
          <div className="ip-link__text">
            <span className="ip-link__label">Meeting link</span>
            <span className="ip-link__value">{buildInviteUrl(meetingId)}</span>
          </div>
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => void copyLink()}>
            <CopyIcon size={14} />
            Copy link
          </button>
        </div>
        <p className="ip-note">
          Anyone with the link still needs the meeting password
          {waitingRoomEnabled ? " and has to be admitted from the waiting room" : ""}.
        </p>

        <h3 className="ip-heading">Invite friends</h3>

        {loading ? (
          <p className="nm-dialog__empty" aria-busy="true">
            Loading your friends…
          </p>
        ) : error && !hasFriends ? (
          <div className="ip-state" role="alert">
            <p className="ip-state__title">Couldn&apos;t load your friends</p>
            <p className="ip-state__text">{error}</p>
            <button type="button" className="btn btn--secondary btn--sm" onClick={reload}>
              Try again
            </button>
          </div>
        ) : !hasFriends ? (
          <div className="ip-state" role="status">
            <p className="ip-state__title">No friends yet</p>
            <p className="ip-state__text">Add friends to invite them straight from here. For now, share the link above.</p>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={() => {
                onClose();
                openFriendsPanel("find");
              }}
            >
              Find friends
            </button>
          </div>
        ) : (
          <>
            <div className="input-group nm-dialog__search">
              <span className="input-group__icon">
                <SearchIcon size={18} />
              </span>
              <input
                ref={searchRef}
                className="input"
                type="search"
                placeholder="Search friends"
                aria-label="Search friends"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            {statusError ? <p className="field__hint">Invitation status unavailable: {statusError}</p> : null}
            <ul className="nm-dialog__list">
              {visible.length === 0 ? (
                <li className="nm-dialog__empty">No friends match “{query.trim()}”.</li>
              ) : (
                visible.map((friend) => {
                  const state = statuses[friend.id] as InviteState | undefined;
                  const isSelected = selected.has(friend.id);
                  const locked = blocked(friend.id);
                  return (
                    <li key={friend.id}>
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={isSelected}
                        disabled={locked}
                        className={isSelected ? "nm-pick nm-pick--selected" : "nm-pick"}
                        onClick={() => toggle(friend.id)}
                      >
                        <ParticipantAvatar
                          name={friend.name}
                          seed={friend.username}
                          imageUrl={friend.avatarUrl}
                          size={40}
                          accent={false}
                        />
                        <span className="nm-pick__text">
                          <span className="nm-pick__name">{friend.name}</span>
                          <span className="nm-pick__status">@{friend.username}</span>
                        </span>
                        {state ? (
                          <span className={locked ? "ip-badge ip-badge--done" : "ip-badge"}>{STATE_LABEL[state]}</span>
                        ) : (
                          <span className="nm-pick__box" aria-hidden="true">
                            {isSelected ? <CheckIcon size={13} strokeWidth={3} /> : null}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          </>
        )}

        {sendError ? (
          <p className="field__error" role="alert">
            {sendError}
          </p>
        ) : null}

        <div className="dialog__actions nm-dialog__actions">
          <span className="nm-dialog__count" aria-live="polite">
            {count} selected
          </span>
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            Close
          </button>
          <button type="button" className="btn btn--primary" onClick={() => void send()} disabled={count === 0 || sending}>
            {sending ? "Sending…" : "Send invitations"}
          </button>
        </div>
      </div>
    </div>
  );
}
