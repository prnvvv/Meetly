"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  MoreHorizontalIcon,
  XIcon,
} from "@/components/icons";
import { ParticipantAvatar } from "@/components/meeting/ParticipantAvatar";
import type { Friend } from "@/lib/friends";

interface InvitePeopleSectionProps {
  friends: Friend[];
  loading: boolean;
  /** Set when the friends list could not be loaded. */
  error?: string | null;
  onRetry?: () => void;
  selectedIds: ReadonlySet<string>;
  /** Friends who already hold an invitation for this meeting (cannot be picked again). */
  invitedIds?: ReadonlySet<string>;
  disabled?: boolean;
  onToggle: (id: string) => void;
  onClear: () => void;
  onOpenMore: () => void;
  /** Section copy; defaults are the New Meeting wording. */
  title?: string;
  subtitle?: string;
}

/**
 * Friends picker for a meeting. Picking a friend only marks them; the invitation
 * is sent when the meeting is created, so nothing is sent by accident.
 */
export function InvitePeopleSection({
  friends,
  loading,
  error = null,
  onRetry,
  selectedIds,
  invitedIds,
  disabled = false,
  onToggle,
  onClear,
  onOpenMore,
  title = "Invite People",
  subtitle = "Bring your people into the conversation.",
}: InvitePeopleSectionProps) {
  const scroller = useRef<HTMLUListElement | null>(null);
  const [edges, setEdges] = useState({ start: true, end: true });

  const hasFriends = friends.length > 0;
  const showEmpty = !loading && !error && !hasFriends;
  const showFailure = !loading && !!error && !hasFriends;

  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    setEdges({
      start: el.scrollLeft <= 2,
      end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2,
    });
  }, []);

  useEffect(() => {
    measure();
    const el = scroller.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure, friends.length, loading]);

  const scrollBy = (direction: 1 | -1) => {
    const el = scroller.current;
    if (el) el.scrollBy({ left: direction * el.clientWidth * 0.7, behavior: "smooth" });
  };

  const count = selectedIds.size;
  const selectedFriends = friends.filter((f) => selectedIds.has(f.id));

  return (
    <section className="nm-section" aria-labelledby="nm-invite-title">
      <div className="nm-section__head nm-section__head--row">
        <div>
          <h3 className="nm-section__title" id="nm-invite-title">
            {title}
          </h3>
          <p className="nm-section__sub">{subtitle}</p>
        </div>
        {hasFriends ? (
          <div className="nm-invite__tools">
            {count > 0 ? (
              <>
                <span className="nm-invite__count" aria-live="polite">
                  {count} selected
                </span>
                <button type="button" className="nm-link" onClick={onClear} disabled={disabled}>
                  Clear
                </button>
              </>
            ) : null}
            <button
              type="button"
              className="nm-arrow"
              aria-label="Scroll friends left"
              onClick={() => scrollBy(-1)}
              disabled={edges.start}
            >
              <ChevronLeftIcon size={16} />
            </button>
            <button
              type="button"
              className="nm-arrow"
              aria-label="Scroll friends right"
              onClick={() => scrollBy(1)}
              disabled={edges.end}
            >
              <ChevronRightIcon size={16} />
            </button>
          </div>
        ) : null}
      </div>

      {showEmpty ? (
        <div className="nm-friends nm-friends--state" role="status">
          <p className="nm-empty__title">No friends yet</p>
        </div>
      ) : showFailure ? (
        <div className="nm-friends nm-friends--state" role="alert">
          <div className="nm-empty">
            <div className="nm-empty__text">
              <p className="nm-empty__title">Couldn&apos;t load your friends</p>
              <p className="nm-empty__sub">{error}</p>
            </div>
            {onRetry ? (
              <div className="nm-empty__actions">
                <button type="button" className="btn btn--secondary btn--sm" onClick={onRetry}>
                  Try again
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="nm-friends" aria-busy={loading || undefined}>
          <ul className="nm-friends__scroll" ref={scroller} onScroll={measure} aria-label="Friends">
            {loading
              ? Array.from({ length: 6 }, (_, i) => (
                  <li key={i} className="nm-friend nm-friend--skeleton" aria-hidden="true">
                    <span className="nm-avatar" style={{ width: 46, height: 46 }} />
                    <span className="nm-friend__name">&nbsp;</span>
                  </li>
                ))
              : friends.map((friend) => {
                  const selected = selectedIds.has(friend.id);
                  const invited = invitedIds?.has(friend.id) ?? false;
                  return (
                    <li key={friend.id} className="nm-friend">
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={selected || invited}
                        aria-label={`${friend.name}, @${friend.username}${invited ? ", already invited" : ""}`}
                        className={invited ? "nm-friend__btn nm-friend__btn--invited" : "nm-friend__btn"}
                        disabled={disabled || invited}
                        onClick={() => onToggle(friend.id)}
                      >
                        <span className="nm-friend__avatar">
                          <span className={selected ? "nm-picture nm-picture--selected" : "nm-picture"}>
                            <ParticipantAvatar
                              name={friend.name}
                              seed={friend.username}
                              imageUrl={friend.avatarUrl}
                              size={46}
                              accent={false}
                            />
                          </span>
                          {selected || invited ? (
                            <span className="nm-friend__check" aria-hidden="true">
                              <CheckIcon size={11} strokeWidth={3} />
                            </span>
                          ) : null}
                        </span>
                        <span className="nm-friend__name">{friend.name.split(" ")[0]}</span>
                        {invited ? <span className="nm-friend__state">Invited</span> : null}
                      </button>
                    </li>
                  );
                })}
          </ul>
          <button
            type="button"
            className="nm-friend__more"
            onClick={onOpenMore}
            disabled={disabled || loading}
          >
            <span className="nm-friend__more-icon">
              <MoreHorizontalIcon size={20} />
            </span>
            <span className="nm-friend__name">More</span>
          </button>
        </div>
      )}

      {selectedFriends.length > 0 ? (
        <ul className="nm-chips" aria-label="Selected friends">
          {selectedFriends.map((friend) => (
            <li key={friend.id} className="nm-chip">
              <span className="nm-chip__name">{friend.name}</span>
              <button
                type="button"
                className="nm-chip__remove"
                aria-label={`Remove ${friend.name}`}
                onClick={() => onToggle(friend.id)}
                disabled={disabled}
              >
                <XIcon size={12} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
