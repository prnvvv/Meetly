import { ESSENTIAL_KEYS, SETTING_DEFINITIONS, SettingTile, type MeetingSettings, type SettingKey } from "./MeetingSettingsList";
import { MoreMeetingSettings } from "./MoreMeetingSettings";

interface EssentialMeetingSettingsProps {
  settings: MeetingSettings;
  disabled?: boolean;
  onChange: (key: SettingKey, value: boolean) => void;
}

/** The four settings most hosts touch, in a compact grid, plus the "More settings" popover. */
export function EssentialMeetingSettings({ settings, disabled = false, onChange }: EssentialMeetingSettingsProps) {
  return (
    <section className="nm-section nm-section--settings" aria-labelledby="nm-settings-title">
      <div className="nm-section__head nm-section__head--row">
        <h3 className="nm-section__title" id="nm-settings-title">
          Meeting settings
        </h3>
        <MoreMeetingSettings settings={settings} disabled={disabled} onChange={onChange} />
      </div>
      <ul className="nm-settings">
        {ESSENTIAL_KEYS.map((key) => (
          <SettingTile
            key={key}
            definition={SETTING_DEFINITIONS[key]}
            checked={settings[key]}
            disabled={disabled}
            onChange={onChange}
          />
        ))}
      </ul>
    </section>
  );
}
