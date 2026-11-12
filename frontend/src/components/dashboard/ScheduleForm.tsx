"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState, type FormEvent } from "react";
import { useToast } from "@/components/common/ToastProvider";
import { CalendarIcon, EyeIcon, EyeOffIcon } from "@/components/icons";
import { FriendsDialog } from "@/components/meeting/FriendsDialog";
import { InvitePeopleSection } from "@/components/meeting/InvitePeopleSection";
import { useFriends } from "@/hooks/useFriends";
import { describeInviteOutcome, inviteSelectedFriends } from "@/lib/inviteFriends";
import { toUserMessage } from "@/lib/api-client";
import {
  MAX_DESCRIPTION_LENGTH,
  MAX_DURATION_MINUTES,
  MAX_TITLE_LENGTH,
  STORAGE_KEYS,
} from "@/lib/constants";
import { saveMeetingConfig } from "@/lib/meetingConfig";
import {
  toLocalDateInputValue,
  toLocalTimeInputValue,
  validateScheduleForm,
  type FieldError,
} from "@/lib/validators";
import { scheduleMeeting } from "@/services/scheduleService";

const DEFAULT_TITLE = "Scheduled Meeting";
const DEFAULT_DURATION = 30;
const DURATION_PRESETS = [15, 30, 45, 60, 90, 120] as const;
const MAX_OCCURRENCES = 12;

type Repeat = "none" | "daily" | "weekly" | "monthly";

const REPEAT_LABELS: Record<Repeat, string> = {
  none: "Does not repeat",
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
};

/** Next quarter hour, at least an hour out, so the default is always valid. */
function defaultStart(): Date {
  const start = new Date(Date.now() + 60 * 60 * 1000);
  start.setMinutes(Math.ceil(start.getMinutes() / 15) * 15, 0, 0);
  return start;
}

/** The nth occurrence of a repeating meeting, keeping the same local clock time. */
function occurrenceStart(date: string, time: string, repeat: Repeat, index: number): string | null {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const when = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (repeat === "daily") when.setDate(when.getDate() + index);
  else if (repeat === "weekly") when.setDate(when.getDate() + index * 7);
  else if (repeat === "monthly") {
    // Clamp to the month's last day so Jan 31 + 1 month is Feb 28/29, not Mar 3.
    const targetMonth = month - 1 + index;
    const lastDay = new Date(year, targetMonth + 1, 0).getDate();
    when.setMonth(targetMonth, Math.min(day, lastDay));
  }
  return Number.isNaN(when.getTime()) ? null : when.toISOString();
}

/** Schedule form: details on the left; illustration, invitees and options on the right. */
export function ScheduleForm() {
  const router = useRouter();
  const { toast } = useToast();
  const { friends, loading: friendsLoading } = useFriends();

  const [values, setValues] = useState(() => {
    const start = defaultStart();
    return {
      title: "",
      description: "",
      date: toLocalDateInputValue(start),
      time: toLocalTimeInputValue(start),
      duration: DEFAULT_DURATION,
    };
  });
  const [customDuration, setCustomDuration] = useState(false);
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState(false);
  const [repeat, setRepeat] = useState<Repeat>("none");
  const [occurrences, setOccurrences] = useState(4);
  const [selectedFriends, setSelectedFriends] = useState<ReadonlySet<string>>(() => new Set());
  const [friendsOpen, setFriendsOpen] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const timeZone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return "";
    }
  }, []);
  const today = useMemo(() => toLocalDateInputValue(new Date()), []);

  const errorFor = (field: string) => fieldErrors.find((error) => error.field === field)?.message;

  const setValue = (field: keyof typeof values, value: string | number) =>
    setValues((current) => ({ ...current, [field]: value }));

  const toggleFriend = useCallback((id: string) => {
    setSelectedFriends((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const clearFriends = useCallback(() => setSelectedFriends(new Set()), []);
  const closeFriends = useCallback(() => setFriendsOpen(false), []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitError(null);

    // The topic is optional: an untitled meeting gets a default name.
    const title = values.title.trim() || DEFAULT_TITLE;
    const errors = validateScheduleForm({ ...values, title });
    setFieldErrors(errors);
    if (errors.length > 0) return;

    const count = repeat === "none" ? 1 : occurrences;
    const starts: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const start = occurrenceStart(values.date, values.time, repeat, i);
      if (!start) {
        setFieldErrors([{ field: "date", message: "That date and time is not valid." }]);
        return;
      }
      starts.push(start);
    }

    setSubmitting(true);
    const secret = password.trim();
    let created = 0;
    let invitedTotal = 0;
    let inviteProblem: string | null = null;
    try {
      // The API has no recurrence concept, so each occurrence is its own scheduled meeting.
      for (const start_time of starts) {
        const meeting = await scheduleMeeting({
          title,
          description: values.description.trim() || undefined,
          start_time,
          duration: Number(values.duration),
          password: secret || undefined,
        });
        created += 1;
        if (secret) {
          window.sessionStorage.setItem(STORAGE_KEYS.meetingPassword(meeting.meeting_id), secret);
        }
        saveMeetingConfig(meeting.meeting_id, {
          settings: {},
          invitedFriendIds: [...selectedFriends],
        });
        const outcome = await inviteSelectedFriends(meeting.meeting_id, selectedFriends);
        if (outcome.error) inviteProblem = outcome.error;
        invitedTotal = Math.max(invitedTotal, outcome.invited);
      }
      toast(created > 1 ? `${created} meetings scheduled` : "Meeting scheduled", "success");
      const invited = describeInviteOutcome({ invited: invitedTotal, skipped: 0, error: inviteProblem });
      if (invited) toast(invited.text, invited.kind);
      router.push("/dashboard");
    } catch (error) {
      const message = toUserMessage(error);
      setSubmitError(
        created > 0 ? `${created} of ${count} meetings were scheduled before an error: ${message}` : message
      );
      setSubmitting(false);
    }
  }

  const durationValue = Number(values.duration);

  return (
    <>
      <form className="nm-grid sm-grid" onSubmit={onSubmit} noValidate aria-label="Schedule a meeting">
        <section className="nm-card sm-details" aria-labelledby="sm-details-title">
          <h2 className="sr-only" id="sm-details-title">
            Meeting details
          </h2>
          {submitError ? (
            <div className="form-error-banner" role="alert">
              {submitError}
            </div>
          ) : null}

          <div className="field">
            <label className="field__label" htmlFor="schedule-title">
              Meeting topic <span className="nm-optional">(optional)</span>
            </label>
            <input
              id="schedule-title"
              className="input"
              type="text"
              placeholder="Give your meeting a name (optional)"
              value={values.title}
              maxLength={MAX_TITLE_LENGTH}
              autoComplete="off"
              disabled={submitting}
              aria-invalid={errorFor("title") ? true : undefined}
              aria-describedby={errorFor("title") ? "schedule-title-error" : undefined}
              onChange={(event) => setValue("title", event.target.value)}
            />
            {errorFor("title") ? (
              <span className="field__error" id="schedule-title-error">
                {errorFor("title")}
              </span>
            ) : null}
          </div>

          <div className="field sm-description">
            <label className="field__label" htmlFor="schedule-description">
              Description <span className="nm-optional">(optional)</span>
            </label>
            <textarea
              id="schedule-description"
              className="textarea"
              placeholder="Agenda, dial-in notes, links"
              value={values.description}
              maxLength={MAX_DESCRIPTION_LENGTH}
              disabled={submitting}
              aria-invalid={errorFor("description") ? true : undefined}
              aria-describedby={errorFor("description") ? "schedule-description-error" : undefined}
              onChange={(event) => setValue("description", event.target.value)}
            />
            {errorFor("description") ? (
              <span className="field__error" id="schedule-description-error">
                {errorFor("description")}
              </span>
            ) : null}
          </div>

          <div className="sm-row">
            <div className="field">
              <label className="field__label" htmlFor="schedule-date">
                Date
              </label>
              <input
                id="schedule-date"
                className="input"
                type="date"
                min={today}
                value={values.date}
                disabled={submitting}
                aria-invalid={errorFor("date") ? true : undefined}
                aria-describedby={errorFor("date") ? "schedule-date-error" : undefined}
                onChange={(event) => setValue("date", event.target.value)}
              />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="schedule-time">
                Time
              </label>
              <input
                id="schedule-time"
                className="input"
                type="time"
                value={values.time}
                disabled={submitting}
                aria-invalid={errorFor("time") ? true : undefined}
                aria-describedby={errorFor("time") ? "schedule-time-error" : undefined}
                onChange={(event) => setValue("time", event.target.value)}
              />
            </div>
            {errorFor("date") || errorFor("time") ? (
              <span className="field__error sm-row__error" id="schedule-date-error" role="alert">
                {errorFor("date") ?? errorFor("time")}
              </span>
            ) : timeZone ? (
              <span className="field__hint sm-row__error">Times are in your time zone ({timeZone}).</span>
            ) : null}
          </div>

          <div className="field">
            <span className="field__label" id="schedule-duration-label">
              Duration
            </span>
            <div className="sm-durations" role="radiogroup" aria-labelledby="schedule-duration-label">
              {DURATION_PRESETS.map((minutes) => {
                const active = !customDuration && durationValue === minutes;
                return (
                  <button
                    key={minutes}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    disabled={submitting}
                    className={active ? "sm-chip sm-chip--active" : "sm-chip"}
                    onClick={() => {
                      setCustomDuration(false);
                      setValue("duration", minutes);
                    }}
                  >
                    {minutes} min
                  </button>
                );
              })}
              <button
                type="button"
                role="radio"
                aria-checked={customDuration}
                disabled={submitting}
                className={customDuration ? "sm-chip sm-chip--active" : "sm-chip"}
                onClick={() => setCustomDuration(true)}
              >
                Custom
              </button>
            </div>
            {customDuration ? (
              <input
                id="schedule-duration"
                className="input sm-custom"
                type="number"
                min={1}
                max={MAX_DURATION_MINUTES}
                step={1}
                aria-label="Custom duration in minutes"
                placeholder="Minutes"
                value={Number.isFinite(durationValue) ? values.duration : ""}
                disabled={submitting}
                aria-invalid={errorFor("duration") ? true : undefined}
                onChange={(event) => setValue("duration", Number(event.target.value))}
              />
            ) : null}
            {errorFor("duration") ? (
              <span className="field__error" id="schedule-duration-error">
                {errorFor("duration")}
              </span>
            ) : null}
          </div>

          <div className="sm-actions">
            <button type="submit" className="btn btn--primary btn--lg" disabled={submitting}>
              <CalendarIcon size={18} />
              {submitting ? "Scheduling…" : "Schedule Meeting"}
            </button>
            <Link href="/dashboard" className="btn btn--ghost btn--lg">
              Cancel
            </Link>
          </div>
        </section>

        <section className="nm-card sm-config" aria-label="Meeting configuration">
          <div className="sm-art" aria-hidden="true">
            <Image
              className="sm-art__img"
              src="/images/schedule-meeting/people-collaboration-illustration.png"
              alt=""
              width={1536}
              height={1024}
              sizes="(max-width: 1099px) 90vw, 520px"
            />
          </div>

          <InvitePeopleSection
            title="Invite Friends"
            subtitle="Add people to your scheduled meeting."
            friends={friends}
            loading={friendsLoading}
            selectedIds={selectedFriends}
            disabled={submitting}
            onToggle={toggleFriend}
            onClear={clearFriends}
            onOpenMore={() => setFriendsOpen(true)}
          />

          <section className="nm-section" aria-labelledby="sm-options-title">
            <div className="nm-section__head">
              <h3 className="nm-section__title" id="sm-options-title">
                Meeting options
              </h3>
              <p className="nm-section__sub">Protect the room and set how often it repeats.</p>
            </div>
            <div className={repeat === "none" ? "sm-options" : "sm-options sm-options--repeat"}>
              <div className="field">
                <label className="field__label" htmlFor="schedule-password">
                  Password <span className="nm-optional">(optional)</span>
                </label>
                <div className="input-group nm-pw">
                  <input
                    id="schedule-password"
                    className="input"
                    type={reveal ? "text" : "password"}
                    placeholder="Leave blank for an open meeting"
                    maxLength={128}
                    value={password}
                    autoComplete="off"
                    disabled={submitting}
                    onChange={(event) => setPassword(event.target.value)}
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
              <div className="field">
                <label className="field__label" htmlFor="schedule-repeat">
                  Repeat
                </label>
                <select
                  id="schedule-repeat"
                  className="input"
                  value={repeat}
                  disabled={submitting}
                  onChange={(event) => setRepeat(event.target.value as Repeat)}
                >
                  {(Object.keys(REPEAT_LABELS) as Repeat[]).map((key) => (
                    <option key={key} value={key}>
                      {REPEAT_LABELS[key]}
                    </option>
                  ))}
                </select>
              </div>
              {repeat !== "none" ? (
                <div className="field">
                  <label className="field__label" htmlFor="schedule-occurrences">
                    Times
                  </label>
                  <select
                    id="schedule-occurrences"
                    className="input"
                    value={occurrences}
                    disabled={submitting}
                    onChange={(event) => setOccurrences(Number(event.target.value))}
                  >
                    {Array.from({ length: MAX_OCCURRENCES - 1 }, (_, i) => i + 2).map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
            </div>
          </section>
        </section>
      </form>

      <FriendsDialog
        open={friendsOpen}
        friends={friends}
        selectedIds={selectedFriends}
        onToggle={toggleFriend}
        onClose={closeFriends}
        onInviteSelected={() => {
          setFriendsOpen(false);
          const n = selectedFriends.size;
          toast(`${n} ${n === 1 ? "friend" : "friends"} will be invited when you schedule the meeting`, "success");
        }}
      />
    </>
  );
}
