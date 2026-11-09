"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useToast } from "@/components/common/ToastProvider";
import { EyeIcon, EyeOffIcon, LinkIcon, VideoIcon } from "@/components/icons";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { toUserMessage } from "@/lib/api-client";
import { STORAGE_KEYS } from "@/lib/constants";
import {
  extractMeetingId,
  validateJoinInput,
  type FieldError,
} from "@/lib/validators";
import { joinMeeting } from "@/services/meetingService";

const FALLBACK_NAME = "Guest";

/** Left card of /join: meeting code, optional name and password, illustration, submit. */
export function JoinForm() {
  const router = useRouter();
  const { toast } = useToast();
  const { user } = useCurrentUser();

  const [values, setValues] = useState({
    meetingId: "",
    password: "",
  });
  // null until the user edits the field; then their text wins over the profile name.
  const [typedName, setTypedName] = useState<string | null>(null);
  const [reveal, setReveal] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const profileName = user?.name?.trim() ?? "";
  const displayName = typedName ?? profileName;

  const errorFor = (field: string) =>
    fieldErrors.find((error) => error.field === field)?.message;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitError(null);

    const meetingId = extractMeetingId(values.meetingId);
    // Name is optional: fall back to the profile name, then a generic guest name.
    const name = displayName.trim() || profileName || FALLBACK_NAME;
    const errors = validateJoinInput({ meetingId, displayName: name });
    setFieldErrors(errors);
    if (errors.length > 0) return;

    setSubmitting(true);
    try {
      await joinMeeting(meetingId, {
        display_name: name,
        password: values.password.trim() || undefined,
      });
      window.sessionStorage.setItem(STORAGE_KEYS.displayName, name);
      if (values.password.trim()) {
        window.sessionStorage.setItem(
          STORAGE_KEYS.meetingPassword(meetingId),
          values.password.trim()
        );
      }
      toast(`Joining as ${name}`, "success");
      router.push(`/meetings/${meetingId}`);
    } catch (error) {
      setSubmitError(toUserMessage(error));
      setSubmitting(false);
    }
  }

  return (
    <form className="nm-card jm-card" onSubmit={onSubmit} noValidate aria-label="Join a meeting">
      {submitError ? (
        <div className="form-error-banner" role="alert">
          {submitError}
        </div>
      ) : null}

      <div className="jm-fields">
        <div className="field">
          <label className="field__label" htmlFor="join-meeting-id">
            Meeting code or invite link
          </label>
          <span className="input-group">
            <span className="input-group__icon" aria-hidden="true">
              <LinkIcon size={16} />
            </span>
            <input
              id="join-meeting-id"
              className="input"
              type="text"
              placeholder="Enter meeting code or paste invite link"
              value={values.meetingId}
              autoComplete="off"
              disabled={submitting}
              aria-invalid={errorFor("meetingId") ? true : undefined}
              aria-describedby={errorFor("meetingId") ? "join-meeting-id-error" : undefined}
              onChange={(event) =>
                setValues((current) => ({ ...current, meetingId: event.target.value }))
              }
            />
          </span>
          {errorFor("meetingId") ? (
            <span className="field__error" id="join-meeting-id-error">
              {errorFor("meetingId")}
            </span>
          ) : null}
        </div>

        <div className="field">
          <label className="field__label" htmlFor="join-display-name">
            Your name <span className="nm-optional">(optional)</span>
          </label>
          <input
            id="join-display-name"
            className="input"
            type="text"
            placeholder="How others will see you"
            value={displayName}
            autoComplete="name"
            disabled={submitting}
            aria-invalid={errorFor("displayName") ? true : undefined}
            aria-describedby={errorFor("displayName") ? "join-display-name-error" : undefined}
            onChange={(event) => setTypedName(event.target.value)}
          />
          {errorFor("displayName") ? (
            <span className="field__error" id="join-display-name-error">
              {errorFor("displayName")}
            </span>
          ) : null}
        </div>

        <div className="field">
          <label className="field__label" htmlFor="join-password">
            Meeting password <span className="nm-optional">(optional)</span>
          </label>
          <div className="input-group nm-pw">
            <input
              id="join-password"
              className="input"
              type={reveal ? "text" : "password"}
              placeholder="Required only if the host set one"
              value={values.password}
              autoComplete="off"
              disabled={submitting}
              onChange={(event) =>
                setValues((current) => ({ ...current, password: event.target.value }))
              }
            />
            <button
              type="button"
              className="input-group__action icon-button nm-pw__toggle"
              aria-label={reveal ? "Hide password" : "Show password"}
              aria-pressed={reveal}
              disabled={submitting}
              onClick={() => setReveal((current) => !current)}
            >
              {reveal ? <EyeOffIcon size={18} /> : <EyeIcon size={18} />}
            </button>
          </div>
        </div>
      </div>

      <div className="jm-art">
        <Image
          className="jm-art__img"
          src="/images/join-meeting/join-meeting-person.png"
          alt="A cheerful person resting their cheek on one hand while looking at a laptop"
          width={1756}
          height={896}
          sizes="(max-width: 1099px) 90vw, 640px"
          priority
        />
      </div>

      <div className="jm-actions">
        <button type="submit" className="btn btn--primary jm-submit" disabled={submitting}>
          <VideoIcon size={18} />
          {submitting ? "Joining…" : "Join Meeting"}
        </button>
        <Link href="/dashboard" className="btn btn--ghost jm-cancel">
          Cancel
        </Link>
      </div>
    </form>
  );
}
