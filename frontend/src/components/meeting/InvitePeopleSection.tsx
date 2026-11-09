"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, MoreHorizontalIcon } from "@/components/icons";
import type { Friend } from "@/lib/friends";
import { FriendAvatar } from "./FriendAvatar";

interface InvitePeopleSectionProps {
  friends: Friend[];
  loading: boolean;
  selectedIds: ReadonlySet<string>;
  disabled?: boolean;
  onToggle: (id: string) => void;
  onClear: () => void;
  onOpenMore: () => void;
  /** Section copy; defaults are the New Meeting wording. */
  title?: string;
  subtitle?: string;
}

/** Horizontally scrolling friend row. Picking a friend only marks them; nothing is sent. */
export function InvitePeopleSection({
  friends,
  loading,
  selectedIds,
  disabled = false,
  onToggle,
  onClear,
  onOpenMore,
  title = "Invite People",
  subtitle = "Bring your people into the conversation.",
}: InvitePeopleSectionProps) {
  const scroller = useRef<HTMLUListElement | null>(null);
  const [edges, setEdges] = useState({ start: true, end: true });

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
  }, [measure, friends.length]);

  const scrollBy = (direction: 1 | -1) => {
    const el = scroller.current;
    if (el) el.scrollBy({ left: direction * el.clientWidth * 0.7, behavior: "smooth" });
  };

  const count = selectedIds.size;

  return (
    <section className="nm-section" aria-labelledby="nm-invite-title">
      <div className="nm-section__head nm-section__head--row">
        <div>
          <h3 className="nm-section__title" id="nm-invite-title">
            {title}
          </h3>
          <p className="nm-section__sub">{subtitle}</p>
        </div>
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
      </div>

      <div className="nm-friends">
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
                return (
                  <li key={friend.id} className="nm-friend">
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={selected}
                      aria-label={`${friend.name}, ${friend.online ? "online" : "offline"}`}
                      className="nm-friend__btn"
                      disabled={disabled}
                      onClick={() => onToggle(friend.id)}
                    >
                      <span className="nm-friend__avatar">
                        <FriendAvatar friend={friend} selected={selected} />
                        {selected ? (
                          <span className="nm-friend__check" aria-hidden="true">
                            <CheckIcon size={11} strokeWidth={3} />
                          </span>
                        ) : null}
                      </span>
                      <span className="nm-friend__name">{friend.name.split(" ")[0]}</span>
                    </button>
                  </li>
                );
              })}
        </ul>
        <button type="button" className="nm-friend__more" onClick={onOpenMore} disabled={disabled}>
          <span className="nm-friend__more-icon">
            <MoreHorizontalIcon size={20} />
          </span>
          <span className="nm-friend__name">More</span>
        </button>
      </div>
    </section>
  );
}
