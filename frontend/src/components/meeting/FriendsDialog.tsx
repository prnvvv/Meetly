"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckIcon, SearchIcon } from "@/components/icons";
import type { Friend } from "@/lib/friends";
import { FriendAvatar } from "./FriendAvatar";

interface FriendsDialogProps {
  open: boolean;
  friends: Friend[];
  selectedIds: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onClose: () => void;
  /** Confirms the current selection; the host app decides what "invite" means. */
  onInviteSelected: () => void;
}

/** Compact searchable picker over the same selection the friends row uses. */
export function FriendsDialog({
  open,
  friends,
  selectedIds,
  onToggle,
  onClose,
  onInviteSelected,
}: FriendsDialogProps) {
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    searchRef.current?.focus();
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle
      ? friends.filter(
          (f) => f.name.toLowerCase().includes(needle) || f.username.toLowerCase().includes(needle)
        )
      : friends;
  }, [friends, query]);

  if (!open) return null;

  const count = selectedIds.size;

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="dialog nm-dialog" role="dialog" aria-modal="true" aria-labelledby="nm-friends-title">
        <h2 className="dialog__title" id="nm-friends-title">
          Invite people
        </h2>
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

        <ul className="nm-dialog__list">
          {visible.length === 0 ? (
            <li className="nm-dialog__empty">{friends.length === 0 ? "You have no friends yet. Add people from the Friends panel." : `No friends match “${query.trim()}”.`}</li>
          ) : (
            visible.map((friend) => {
              const selected = selectedIds.has(friend.id);
              return (
                <li key={friend.id}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={selected}
                    className={selected ? "nm-pick nm-pick--selected" : "nm-pick"}
                    onClick={() => onToggle(friend.id)}
                  >
                    <FriendAvatar friend={friend} size={40} />
                    <span className="nm-pick__text">
                      <span className="nm-pick__name">{friend.name}</span>
                      <span className="nm-pick__status">@{friend.username}</span>
                    </span>
                    <span className="nm-pick__box" aria-hidden="true">
                      {selected ? <CheckIcon size={13} strokeWidth={3} /> : null}
                    </span>
                  </button>
                </li>
              );
            })
          )}
        </ul>

        <div className="dialog__actions nm-dialog__actions">
          <span className="nm-dialog__count" aria-live="polite">
            {count} selected
          </span>
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" onClick={onInviteSelected} disabled={count === 0}>
            Invite Selected
          </button>
        </div>
      </div>
    </div>
  );
}
