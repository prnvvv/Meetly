"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ErrorState } from "@/components/common/ErrorState";
import { useToast } from "@/components/common/ToastProvider";
import { SearchIcon, XIcon } from "@/components/icons";
import { toUserMessage } from "@/lib/api-client";
import {
  acceptRequest,
  blockUser,
  cancelRequest,
  discoverPeople,
  incomingRequests,
  listBlocked,
  listFriendsPage,
  outgoingRequests,
  rejectRequest,
  removeFriend,
  searchPeople,
  sendFriendRequest,
  unblockUser,
} from "@/services/socialService";
import type { FriendRequest, Person, RelationshipState } from "@/types/social";
import { PersonRow } from "./PersonRow";
import { ProfileDetail } from "./ProfileDetail";
import { RelationshipActions, type PersonAction } from "./RelationshipActions";

export type Tab = "friends" | "requests" | "find" | "blocked";

interface FriendsDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Bumps whenever the server says something changed (realtime hint). */
  changeTick: number;
  /** Tab to show each time the drawer opens. */
  initialTab?: Tab;
}

const TABS: { id: Tab; label: string }[] = [
  { id: "friends", label: "Friends" },
  { id: "requests", label: "Requests" },
  { id: "find", label: "Find people" },
  { id: "blocked", label: "Blocked" },
];

const CONFIRM_COPY: Partial<Record<PersonAction, { title: string; message: (n: string) => string; label: string }>> = {
  remove: {
    title: "Remove friend?",
    message: (n) => `${n} will be removed from your friends. You can send a new request later.`,
    label: "Remove",
  },
  block: {
    title: "Block this person?",
    message: (n) =>
      `${n} will be removed from your friends and requests, and won't be able to find you or contact you. People already in a meeting with you stay there.`,
    label: "Block",
  },
};

export function FriendsDrawer({ open, onClose, changeTick, initialTab = "friends" }: FriendsDrawerProps) {
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>("friends");
  const [detail, setDetail] = useState<Person | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ action: PersonAction; person: Person } | null>(null);

  const [friends, setFriends] = useState<Person[] | null>(null);
  const [friendQuery, setFriendQuery] = useState("");
  const [incoming, setIncoming] = useState<FriendRequest[] | null>(null);
  const [outgoing, setOutgoing] = useState<FriendRequest[] | null>(null);
  const [blocked, setBlocked] = useState<Person[] | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Person[] | null>(null);
  const [searchMore, setSearchMore] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  const loadFriends = useCallback(async (q: string) => {
    const page = await listFriendsPage(q, 0, 20);
    setFriends(page.items);
  }, []);

  const loadAll = useCallback(async () => {
    try {
      setError(null);
      await Promise.all([
        loadFriends(""),
        incomingRequests().then(setIncoming),
        outgoingRequests().then(setOutgoing),
        listBlocked().then((p) => setBlocked(p.items)),
      ]);
    } catch (e) {
      setError(toUserMessage(e));
    }
  }, [loadFriends]);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTab(initialTab);
      setDetail(null);
    }
  }, [open, initialTab]);

  // Load when opened and whenever the server pushes a change.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) void loadAll();
  }, [open, changeTick, loadAll]);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !confirm) {
        if (detail) setDetail(null);
        else onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose, detail, confirm]);

  // Debounced friend filter.
  useEffect(() => {
    if (!open || tab !== "friends") return;
    const t = setTimeout(() => void loadFriends(friendQuery.trim()).catch(() => undefined), 300);
    return () => clearTimeout(t);
  }, [friendQuery, open, tab, loadFriends]);

  // Debounced people search; empty query shows suggestions from shared meetings.
  useEffect(() => {
    if (!open || tab !== "find") return;
    const q = query.trim();
    let active = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSearching(true);
    const t = setTimeout(
      () => {
        const request = q.length >= 2 ? searchPeople(q) : q.length === 0 ? discoverPeople() : null;
        if (!request) {
          setResults([]);
          setSearchMore(false);
          setSearching(false);
          return;
        }
        request
          .then((page) => {
            if (!active) return;
            setResults(page.items);
            setSearchMore(page.has_more);
          })
          .catch((e) => active && toast(toUserMessage(e), "error"))
          .finally(() => active && setSearching(false));
      },
      q ? 350 : 0
    );
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [query, open, tab, toast, changeTick]);

  const loadMoreResults = async () => {
    const q = query.trim();
    if (q.length < 2 || !results) return;
    try {
      const page = await searchPeople(q, results.length);
      setResults([...results, ...page.items]);
      setSearchMore(page.has_more);
    } catch (e) {
      toast(toUserMessage(e), "error");
    }
  };

  const setRelationship = (userId: number, relationship: RelationshipState, requestId: number | null) => {
    const patch = (p: Person): Person => (p.user_id === userId ? { ...p, relationship, request_id: requestId } : p);
    setResults((cur) => cur && cur.map(patch));
    setDetail((cur) => (cur && cur.user_id === userId ? patch(cur) : cur));
  };

  const execute = async (action: PersonAction, person: Person) => {
    setBusy(true);
    try {
      switch (action) {
        case "add": {
          const r = await sendFriendRequest(person.user_id);
          const done = r.status === "ACCEPTED";
          setRelationship(person.user_id, done ? "friend" : "request_sent", done ? null : r.request_id);
          toast(done ? `You and ${person.display_name} are now friends` : "Friend request sent", "success");
          break;
        }
        case "accept":
          await acceptRequest(person.request_id!);
          setRelationship(person.user_id, "friend", null);
          toast(`You and ${person.display_name} are now friends`, "success");
          break;
        case "decline":
          await rejectRequest(person.request_id!);
          setRelationship(person.user_id, "none", null);
          break;
        case "cancel":
          await cancelRequest(person.request_id!);
          setRelationship(person.user_id, "none", null);
          toast("Request cancelled", "success");
          break;
        case "remove":
          await removeFriend(person.user_id);
          setRelationship(person.user_id, "none", null);
          toast(`${person.display_name} removed`, "success");
          break;
        case "block":
          await blockUser(person.user_id);
          setRelationship(person.user_id, "blocked", null);
          toast(`${person.display_name} blocked`, "success");
          break;
        case "unblock":
          await unblockUser(person.user_id);
          setRelationship(person.user_id, "none", null);
          toast(`${person.display_name} unblocked`, "success");
          break;
      }
      await loadAll();
    } catch (e) {
      toast(toUserMessage(e), "error");
      void loadAll();
    } finally {
      setBusy(false);
    }
  };

  const onAction = async (action: PersonAction, person: Person) => {
    if (CONFIRM_COPY[action]) setConfirm({ action, person });
    else await execute(action, person);
  };

  if (!open) return null;

  const pending = incoming?.length ?? 0;
  const confirmCopy = confirm ? CONFIRM_COPY[confirm.action] : undefined;

  return (
    <div
      className="sd-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside className="sd" role="dialog" aria-modal="true" aria-labelledby="sd-title">
        <header className="sd__head">
          <h2 className="sd__title" id="sd-title">
            Friends
          </h2>
          <button ref={closeRef} type="button" className="icon-button" onClick={onClose} aria-label="Close friends panel">
            <XIcon />
          </button>
        </header>

        {detail ? (
          <div className="sd__body">
            <ProfileDetail person={detail} busy={busy} onBack={() => setDetail(null)} onAction={onAction} />
          </div>
        ) : (
          <>
            <div className="sd-tabs" role="tablist" aria-label="Friends sections">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  id={`sd-tab-${t.id}`}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  aria-controls="sd-panel"
                  className={tab === t.id ? "sd-tab sd-tab--active" : "sd-tab"}
                  onClick={() => setTab(t.id)}
                >
                  {t.label}
                  {t.id === "requests" && pending > 0 ? <span className="sd-count">{pending}</span> : null}
                </button>
              ))}
            </div>

            <div className="sd__body" id="sd-panel" role="tabpanel" aria-labelledby={`sd-tab-${tab}`}>
              {error ? <ErrorState title="Could not load" message={error} onRetry={() => void loadAll()} /> : null}

              {!error && tab === "friends" ? (
                <>
                  <SearchBox value={friendQuery} onChange={setFriendQuery} label="Search your friends" />
                  <List
                    items={friends}
                    empty={friendQuery ? "No friends match your search." : "You have no friends yet. Use Find people to add some."}
                    render={(p) => (
                      <PersonRow key={p.user_id} person={p} onOpen={setDetail}>
                        <button
                          type="button"
                          className="btn btn--sm btn--ghost"
                          onClick={() => void onAction("remove", p)}
                          disabled={busy}
                        >
                          Remove
                        </button>
                      </PersonRow>
                    )}
                  />
                </>
              ) : null}

              {!error && tab === "requests" ? (
                <>
                  <h3 className="sd-section">Incoming</h3>
                  <List
                    items={incoming?.map((r) => ({ ...r.person, request_id: r.id, relationship: "request_received" as const })) ?? null}
                    empty="No incoming requests."
                    render={(p) => (
                      <PersonRow key={p.request_id} person={p} onOpen={setDetail}>
                        <RelationshipActions person={p} busy={busy} onAction={onAction} compact />
                      </PersonRow>
                    )}
                  />
                  <h3 className="sd-section">Sent</h3>
                  <List
                    items={outgoing?.map((r) => ({ ...r.person, request_id: r.id, relationship: "request_sent" as const })) ?? null}
                    empty="No pending requests you sent."
                    render={(p) => (
                      <PersonRow key={p.request_id} person={p} onOpen={setDetail}>
                        <RelationshipActions person={p} busy={busy} onAction={onAction} compact />
                      </PersonRow>
                    )}
                  />
                </>
              ) : null}

              {!error && tab === "find" ? (
                <>
                  <SearchBox value={query} onChange={setQuery} label="Search by username or name" />
                  {query.trim().length === 0 ? <h3 className="sd-section">People you may know</h3> : null}
                  {query.trim().length === 1 ? <p className="field__hint">Type at least 2 characters.</p> : null}
                  <List
                    items={searching && !results ? null : results}
                    empty={
                      query.trim()
                        ? "No one found. Check the spelling, or they may have a private profile."
                        : "No suggestions yet. Search for a username or name."
                    }
                    render={(p) => (
                      <PersonRow key={p.user_id} person={p} onOpen={setDetail}>
                        <RelationshipActions person={p} busy={busy} onAction={onAction} compact />
                      </PersonRow>
                    )}
                  />
                  {searchMore ? (
                    <button type="button" className="btn btn--secondary btn--block" onClick={() => void loadMoreResults()}>
                      Show more
                    </button>
                  ) : null}
                </>
              ) : null}

              {!error && tab === "blocked" ? (
                <List
                  items={blocked}
                  empty="You have not blocked anyone."
                  render={(p) => (
                    <PersonRow key={p.user_id} person={p}>
                      <button type="button" className="btn btn--sm btn--secondary" disabled={busy} onClick={() => void onAction("unblock", p)}>
                        Unblock
                      </button>
                    </PersonRow>
                  )}
                />
              ) : null}
            </div>
          </>
        )}
      </aside>

      <ConfirmDialog
        open={!!confirm && !!confirmCopy}
        title={confirmCopy?.title ?? ""}
        message={confirm && confirmCopy ? confirmCopy.message(confirm.person.display_name) : ""}
        confirmLabel={confirmCopy?.label}
        destructive
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const pending = confirm;
          setConfirm(null);
          if (pending) void execute(pending.action, pending.person);
        }}
      />
    </div>
  );
}

function SearchBox({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <div className="input-group sd-search">
      <span className="input-group__icon">
        <SearchIcon size={18} />
      </span>
      <input
        className="input"
        type="search"
        value={value}
        maxLength={64}
        placeholder={label}
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function List({
  items,
  empty,
  render,
}: {
  items: Person[] | null;
  empty: string;
  render: (p: Person) => React.ReactNode;
}) {
  if (items === null) {
    return (
      <ul className="sd-list" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <li key={i} className="skeleton skeleton--block" style={{ height: 56, marginBottom: 10 }} aria-hidden="true" />
        ))}
      </ul>
    );
  }
  if (items.length === 0) return <p className="sd-empty">{empty}</p>;
  return <ul className="sd-list">{items.map(render)}</ul>;
}
