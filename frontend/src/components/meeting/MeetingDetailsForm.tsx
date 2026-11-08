"use client";

import { useState } from "react";
import { EyeIcon, EyeOffIcon } from "@/components/icons";

interface MeetingDetailsFormProps {
  name: string;
  password: string;
  disabled?: boolean;
  onNameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
}

/** Two optional fields, both empty by default. */
export function MeetingDetailsForm({
  name,
  password,
  disabled = false,
  onNameChange,
  onPasswordChange,
}: MeetingDetailsFormProps) {
  const [reveal, setReveal] = useState(false);
  return (
    <div className="nm-details">
      <div className="field">
        <label className="field__label" htmlFor="nm-name">
          Meeting name <span className="nm-optional">(optional)</span>
        </label>
        <input
          id="nm-name"
          className="input"
          type="text"
          placeholder="Give your meeting a name (optional)"
          maxLength={255}
          value={name}
          disabled={disabled}
          autoComplete="off"
          onChange={(event) => onNameChange(event.target.value)}
        />
      </div>
      <div className="field">
        <label className="field__label" htmlFor="nm-password">
          Password <span className="nm-optional">(optional)</span>
        </label>
        <div className="input-group nm-pw">
          <input
            id="nm-password"
            className="input"
            type={reveal ? "text" : "password"}
            placeholder="Leave blank for an open meeting"
            maxLength={128}
            value={password}
            disabled={disabled}
            autoComplete="off"
            onChange={(event) => onPasswordChange(event.target.value)}
          />
          <button
            type="button"
            className="input-group__action icon-button nm-pw__toggle"
            aria-label={reveal ? "Hide password" : "Show password"}
            aria-pressed={reveal}
            disabled={disabled}
            onClick={() => setReveal((current) => !current)}
          >
            {reveal ? <EyeOffIcon size={18} /> : <EyeIcon size={18} />}
          </button>
        </div>
      </div>
    </div>
  );
}
