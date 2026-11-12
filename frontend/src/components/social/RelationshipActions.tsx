import type { Person } from "@/types/social";

export type PersonAction =
  | "add"
  | "accept"
  | "decline"
  | "cancel"
  | "remove"
  | "block"
  | "unblock";

interface RelationshipActionsProps {
  person: Person;
  busy: boolean;
  onAction: (action: PersonAction, person: Person) => void | Promise<void>;
  /** Compact buttons for list rows. */
  compact?: boolean;
}

/** The buttons that make sense for the current relationship. Server still enforces every rule. */
export function RelationshipActions({ person, busy, onAction, compact = false }: RelationshipActionsProps) {
  const size = compact ? "btn btn--sm" : "btn";
  const run = (action: PersonAction) => () => void onAction(action, person);
  switch (person.relationship) {
    case "friend":
      return (
        <div className="sd-actions">
          <span className="badge">Friends</span>
          {!compact ? (
            <>
              <button type="button" className={`${size} btn--secondary`} disabled={busy} onClick={run("remove")}>
                Remove
              </button>
              <button type="button" className={`${size} btn--ghost`} disabled={busy} onClick={run("block")}>
                Block
              </button>
            </>
          ) : null}
        </div>
      );
    case "request_sent":
      return (
        <div className="sd-actions">
          <button type="button" className={`${size} btn--secondary`} disabled={busy} onClick={run("cancel")}>
            Cancel request
          </button>
        </div>
      );
    case "request_received":
      return (
        <div className="sd-actions">
          <button type="button" className={`${size} btn--primary`} disabled={busy} onClick={run("accept")}>
            Accept
          </button>
          <button type="button" className={`${size} btn--secondary`} disabled={busy} onClick={run("decline")}>
            Decline
          </button>
        </div>
      );
    case "blocked":
      return (
        <div className="sd-actions">
          <button type="button" className={`${size} btn--secondary`} disabled={busy} onClick={run("unblock")}>
            Unblock
          </button>
        </div>
      );
    default:
      return (
        <div className="sd-actions">
          <button type="button" className={`${size} btn--primary`} disabled={busy} onClick={run("add")}>
            Add friend
          </button>
          {!compact ? (
            <button type="button" className={`${size} btn--ghost`} disabled={busy} onClick={run("block")}>
              Block
            </button>
          ) : null}
        </div>
      );
  }
}
