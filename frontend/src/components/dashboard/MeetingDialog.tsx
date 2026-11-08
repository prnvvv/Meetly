"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useToast } from "@/components/common/ToastProvider";
import { XIcon } from "@/components/icons";
import { toUserMessage } from "@/lib/api-client";
import {
  MAX_DESCRIPTION_LENGTH,
  MAX_DURATION_MINUTES,
  MAX_TITLE_LENGTH,
} from "@/lib/constants";
import {
  buildStartTimestamp,
  toLocalDateInputValue,
  toLocalTimeInputValue,
  validateScheduleForm,
  type FieldError,
} from "@/lib/validators";
import { scheduleMeeting, updateScheduledMeeting } from "@/services/scheduleService";
import type { Meeting } from "@/types/meeting";

interface MeetingDialogProps {
  /** Present when editing; absent when scheduling a new meeting. */
  meeting?: Meeting;
  /** Pre-selected day for a new meeting. */
  date?: Date;
  onClose: () => void;
  /** Called after the API accepted the change, so the caller can refetch. */
  onSaved: (meeting: Meeting) => void;
}

/** Next quarter hour at least an hour away, so the default is always valid. */
function defaultStart(day?: Date): Date {
  const soon = new Date(Date.now() + 60 * 60 * 1000);
  soon.setMinutes(Math.ceil(soon.getMinutes() / 15) * 15, 0, 0);
  if (!day) return soon;
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9, 0, 0, 0);
  // Today: use the next valid slot. A later day: a sensible 9:00 start.
  return start.getTime() > soon.getTime() ? start : soon;
}

/** Schedule or edit a meeting without leaving the dashboard. */
export function MeetingDialog({ meeting, date, onClose, onSaved }: MeetingDialogProps) {
  const { toast } = useToast();
  const editing = Boolean(meeting);

  const [values, setValues] = useState(() => {
    const start = meeting ? new Date(meeting.start_time) : defaultStart(date);
    return {
      title: meeting?.title ?? "",
      description: meeting?.description ?? "",
      date: toLocalDateInputValue(start),
      time: toLocalTimeInputValue(start),
      duration: meeting?.duration ?? 30,
    };
  });
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const titleRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    titleRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const errorFor = (field: string) =>
    fieldErrors.find((error) => error.field === field)?.message;
  const setValue = (field: keyof typeof values, value: string | number) =>
    setValues((current) => ({ ...current, [field]: value }));

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError(null);

    const errors = validateScheduleForm(values);
    setFieldErrors(errors);
    if (errors.length > 0) return;

    const start_time = buildStartTimestamp(values.date, values.time);
    if (!start_time) {
      setFieldErrors([{ field: "date", message: "That date and time is not valid." }]);
      return;
    }

    setSubmitting(true);
    try {
      const saved = meeting
        ? await updateScheduledMeeting(meeting.meeting_id, {
            title: values.title.trim(),
            description: values.description.trim() || null,
            start_time,
            duration: Number(values.duration),
          })
        : await scheduleMeeting({
            title: values.title.trim(),
            description: values.description.trim() || undefined,
            start_time,
            duration: Number(values.duration),
          });
      toast(editing ? "Meeting updated" : "Meeting scheduled", "success");
      onSaved(saved);
    } catch (error) {
      setSubmitError(toUserMessage(error));
      setSubmitting(false);
    }
  }

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form
        className="dialog dialog--form"
        role="dialog"
        aria-modal="true"
        aria-labelledby="meeting-dialog-title"
        onSubmit={onSubmit}
        noValidate
      >
        <div className="dialog__head">
          <h2 className="dialog__title" id="meeting-dialog-title">
            {editing ? "Edit meeting" : "Schedule a meeting"}
          </h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <XIcon size={18} />
          </button>
        </div>

        {submitError ? (
          <div className="form-error-banner" role="alert">
            {submitError}
          </div>
        ) : null}

        <div className="form-grid">
          <div className="field form-grid__span">
            <label className="field__label" htmlFor="md-title">
              Topic
            </label>
            <input
              id="md-title"
              ref={titleRef}
              className="input"
              type="text"
              placeholder="Weekly standup"
              value={values.title}
              maxLength={MAX_TITLE_LENGTH}
              autoComplete="off"
              aria-invalid={errorFor("title") ? true : undefined}
              onChange={(event) => setValue("title", event.target.value)}
            />
            {errorFor("title") ? <span className="field__error">{errorFor("title")}</span> : null}
          </div>

          <div className="field">
            <label className="field__label" htmlFor="md-date">
              Date
            </label>
            <input
              id="md-date"
              className="input"
              type="date"
              value={values.date}
              aria-invalid={errorFor("date") ? true : undefined}
              onChange={(event) => setValue("date", event.target.value)}
            />
            {errorFor("date") ? <span className="field__error">{errorFor("date")}</span> : null}
          </div>

          <div className="field">
            <label className="field__label" htmlFor="md-time">
              Time
            </label>
            <input
              id="md-time"
              className="input"
              type="time"
              value={values.time}
              aria-invalid={errorFor("time") ? true : undefined}
              onChange={(event) => setValue("time", event.target.value)}
            />
            {errorFor("time") ? <span className="field__error">{errorFor("time")}</span> : null}
          </div>

          <div className="field form-grid__span">
            <label className="field__label" htmlFor="md-duration">
              Duration (minutes)
            </label>
            <input
              id="md-duration"
              className="input"
              type="number"
              min={1}
              max={MAX_DURATION_MINUTES}
              step={1}
              value={values.duration}
              aria-invalid={errorFor("duration") ? true : undefined}
              onChange={(event) => setValue("duration", Number(event.target.value))}
            />
            {errorFor("duration") ? (
              <span className="field__error">{errorFor("duration")}</span>
            ) : null}
          </div>

          <div className="field form-grid__span">
            <label className="field__label" htmlFor="md-description">
              Description
            </label>
            <textarea
              id="md-description"
              className="textarea"
              placeholder="Agenda, notes (optional)"
              value={values.description}
              maxLength={MAX_DESCRIPTION_LENGTH}
              rows={3}
              onChange={(event) => setValue("description", event.target.value)}
            />
          </div>
        </div>

        <div className="dialog__actions">
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={submitting}>
            {submitting ? "Saving…" : editing ? "Save changes" : "Schedule"}
          </button>
        </div>
      </form>
    </div>
  );
}
