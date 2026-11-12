"use client";

import { useState } from "react";
import { useToast } from "@/components/common/ToastProvider";
import { CheckIcon, ClockIcon, XIcon } from "@/components/icons";
import { toUserMessage } from "@/lib/api-client";
import type { WaitingRoomControls } from "@/hooks/useMeeting";
import { timeAgo } from "@/components/social/NotificationsMenu";
import { cx } from "@/lib/utils";

/**
 * Host-only block inside the participants panel: the on/off switch and the people
 * waiting. Buttons only call the API; the server checks that the caller is the host.
 */
export function WaitingRoomPanel({ controls }: { controls: WaitingRoomControls }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const { enabled, entries } = controls;

  const run = async (work: () => Promise<void>, failure: string) => {
    setBusy(true);
    try {
      await work();
    } catch (error) {
      toast(`${failure}: ${toUserMessage(error)}`, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="wr-panel" aria-label="Waiting room">
      <div className="wr-panel__head">
        <span className="room-panel__hostbar-label">
          <ClockIcon size={14} />
          Waiting room
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Waiting room"
          className={enabled ? "nm-switch nm-switch--on" : "nm-switch"}
          disabled={busy}
          onClick={() =>
            void run(
              () => controls.setEnabled(!enabled),
              "Could not change the waiting room"
            )
          }
        >
          <span className="nm-switch__thumb" />
        </button>
      </div>

      {!enabled ? (
        <p className="wr-panel__hint">
          Off: anyone with the link (and password) joins directly. Turn it on to approve each
          person first. People already in the meeting stay.
        </p>
      ) : entries.length === 0 ? (
        <p className="wr-panel__hint">No one is waiting.</p>
      ) : (
        <>
          <ul className="wr-list" aria-live="polite">
            {entries.map((entry) => (
              <li key={entry.id} className="wr-item">
                <div className="wr-item__text">
                  <span className="wr-item__name">{entry.display_name}</span>
                  <span className="wr-item__meta">
                    {entry.username ? `@${entry.username} · ` : ""}
                    {timeAgo(entry.requested_at)}
                  </span>
                </div>
                <div className="wr-item__actions">
                  <button
                    type="button"
                    className="room-icon-button"
                    aria-label={`Admit ${entry.display_name}`}
                    title="Admit"
                    disabled={busy}
                    onClick={() => void run(() => controls.admit(entry.id), "Could not admit")}
                  >
                    <CheckIcon size={16} />
                  </button>
                  <button
                    type="button"
                    className="room-icon-button room-icon-button--danger"
                    aria-label={`Reject ${entry.display_name}`}
                    title="Reject"
                    disabled={busy}
                    onClick={() => void run(() => controls.reject(entry.id), "Could not reject")}
                  >
                    <XIcon size={16} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {entries.length > 1 ? (
            <button
              type="button"
              className={cx("room__chip", "wr-panel__all")}
              disabled={busy}
              onClick={() => void run(() => controls.admitAll(), "Could not admit everyone")}
            >
              <CheckIcon size={14} />
              Admit all ({entries.length})
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}
