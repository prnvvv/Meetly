"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDownIcon } from "@/components/icons";
import { MORE_GROUPS, SETTING_DEFINITIONS, SettingTile, type MeetingSettings, type SettingKey } from "./MeetingSettingsList";

interface MoreMeetingSettingsProps {
  settings: MeetingSettings;
  disabled?: boolean;
  onChange: (key: SettingKey, value: boolean) => void;
}

/**
 * Compact modal with the remaining settings. It is fixed over the page, so
 * opening it never changes the layout height or pushes the actions away.
 */
export function MoreMeetingSettings({ settings, disabled = false, onChange }: MoreMeetingSettingsProps) {
  const [open, setOpen] = useState(false);
  const doneRef = useRef<HTMLButtonElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelId = useId();

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKeyDown);
    doneRef.current?.focus();
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <div className="nm-more">
      <button
        ref={triggerRef}
        type="button"
        className={open ? "nm-more__trigger nm-more__trigger--open" : "nm-more__trigger"}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        More settings
        <ChevronDownIcon size={16} />
      </button>

      {open ? (
        <div
          className="dialog-backdrop"
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <div className="dialog nm-moredialog" id={panelId} role="dialog" aria-modal="true" aria-labelledby={`${panelId}-title`}>
            <h2 className="dialog__title" id={`${panelId}-title`}>
              More settings
            </h2>
            <div className="nm-moredialog__groups">
              {MORE_GROUPS.map((group) => (
                <div key={group.label} className="nm-group">
                  <h3 className="nm-group__label">{group.label}</h3>
                  <ul className="nm-settings nm-settings--list">
                    {group.keys.map((key) => (
                      <SettingTile
                        key={key}
                        definition={SETTING_DEFINITIONS[key]}
                        checked={settings[key]}
                        disabled={disabled}
                        onChange={onChange}
                      />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <p className="nm-more__note">
              <span className="nm-soon">Soon</span> settings are saved with your meeting but not enforced by the server yet.
            </p>
            <div className="dialog__actions">
              <button ref={doneRef} type="button" className="btn btn--primary" onClick={close}>
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
