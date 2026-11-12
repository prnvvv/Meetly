import { zonedWallTimeToIso } from "./timezone";
import {
  MAX_DESCRIPTION_LENGTH,
  MAX_DISPLAY_NAME_LENGTH,
  MAX_DURATION_MINUTES,
  MAX_TITLE_LENGTH,
  MEETING_ID_LENGTH,
  MEETING_ID_MAX_INPUT,
} from "./constants";

/**
 * The public meeting ID is exactly nine digits with no leading zero — the
 * server rejects anything else with `Meeting ID must be a 9-digit number`.
 * Validating client-side stops users submitting IDs that will 400.
 */
const MEETING_ID_PATTERN = /^[1-9]\d{8}$/;

/**
 * A shape loose enough to recognise "the user typed something that might be a
 * meeting ID". Extraction stays permissive so the field echoes the input back
 * and `validateJoinInput` can show a precise message; only
 * {@link isValidMeetingId} judges validity.
 */
const MEETING_ID_CANDIDATE = new RegExp(
  `^[A-Za-z0-9_-]{1,${MEETING_ID_MAX_INPUT}}$`
);

export function isValidMeetingId(value: string): boolean {
  return MEETING_ID_PATTERN.test(value.trim());
}

/**
 * Accepts a raw meeting ID, an invite link, or a path such as
 * `https://host/meetings/839452761` and returns the meeting ID.
 */
export function extractMeetingId(input: string): string {
  const raw = input.trim();
  if (!raw) return "";

  if (MEETING_ID_CANDIDATE.test(raw)) return raw;

  try {
    const url = new URL(raw);
    const segments = url.pathname.split("/").filter(Boolean);
    const idx = segments.lastIndexOf("meetings");
    if (idx !== -1 && segments[idx + 1]) {
      return decodeURIComponent(segments[idx + 1]);
    }
  } catch {
    /* not a URL - fall through to path parsing */
  }

  const pathMatch = raw.match(/meetings\/([^/?#\s]+)/i);
  if (pathMatch) return decodeURIComponent(pathMatch[1]);

  return "";
}

export interface FieldError {
  field: string;
  message: string;
}

export function validateJoinInput(values: {
  meetingId: string;
  displayName: string;
}): FieldError[] {
  const errors: FieldError[] = [];
  const id = values.meetingId.trim();
  if (!id) {
    errors.push({ field: "meetingId", message: "Enter a meeting ID or invite link." });
  } else if (!isValidMeetingId(id)) {
    errors.push({
      field: "meetingId",
      message: `Meeting IDs are ${MEETING_ID_LENGTH} digits, with no leading zero.`,
    });
  }

  const name = values.displayName.trim();
  if (!name) {
    errors.push({ field: "displayName", message: "Enter your name to join." });
  } else if (name.length > MAX_DISPLAY_NAME_LENGTH) {
    errors.push({
      field: "displayName",
      message: `Names are limited to ${MAX_DISPLAY_NAME_LENGTH} characters.`,
    });
  }

  return errors;
}

export interface ScheduleValues {
  title: string;
  description: string;
  date: string;
  time: string;
  duration: number;
  /** IANA zone the date and time are in; the browser's zone when omitted. */
  timeZone?: string;
}

export function validateScheduleForm(values: ScheduleValues): FieldError[] {
  const errors: FieldError[] = [];

  if (!values.title.trim()) {
    errors.push({ field: "title", message: "Give your meeting a title." });
  } else if (values.title.trim().length > MAX_TITLE_LENGTH) {
    errors.push({
      field: "title",
      message: `Titles are limited to ${MAX_TITLE_LENGTH} characters.`,
    });
  }

  if (values.description.length > MAX_DESCRIPTION_LENGTH) {
    errors.push({
      field: "description",
      message: `Descriptions are limited to ${MAX_DESCRIPTION_LENGTH} characters.`,
    });
  }

  if (!values.date) {
    errors.push({ field: "date", message: "Choose a date." });
  }

  if (!values.time) {
    errors.push({ field: "time", message: "Choose a start time." });
  }

  const duration = Number(values.duration);
  if (!Number.isFinite(duration) || duration <= 0) {
    errors.push({ field: "duration", message: "Duration must be greater than 0." });
  } else if (duration > MAX_DURATION_MINUTES) {
    errors.push({
      field: "duration",
      message: "Durations cannot exceed 24 hours.",
    });
  }

  if (errors.length === 0) {
    const startIso = buildStartTimestamp(values.date, values.time, values.timeZone);
    if (startIso) {
      const start = new Date(startIso);
      // Allow a small grace period for clocks and double submits.
      if (start.getTime() < Date.now() - 60_000) {
        errors.push({
          field: "date",
          message: "Pick a start time in the future.",
        });
      }
    } else {
      errors.push({ field: "date", message: "That date and time is not valid." });
    }
  }

  return errors;
}

/**
 * Combines `<input type=date>` and `<input type=time>` values into a
 * timezone-aware ISO 8601 string (the API rejects naive timestamps).
 */
export function buildStartTimestamp(date: string, time: string, timeZone?: string): string | null {
  if (!date || !time) return null;
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(hour) ||
    !Number.isFinite(minute)
  ) {
    return null;
  }
  if (timeZone) return zonedWallTimeToIso(year, month, day, hour, minute, timeZone);
  const composed = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (Number.isNaN(composed.getTime())) return null;
  return composed.toISOString();
}

/**
 * Clamps a display name to the server's limit.
 *
 * The REST and persistence layers cap names at 100 characters, but the socket
 * `join` schema accepts more. A name above the cap that reaches the socket is
 * stored, and then `GET /participants` cannot serialise it and returns 500 for
 * the whole room. Clamping here means no entry path — including a direct link
 * to `/meetings/{id}` that skips the join form — can trigger that.
 */
export function clampDisplayName(name: string): string {
  return name.trim().slice(0, MAX_DISPLAY_NAME_LENGTH);
}

export function toLocalDateInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function toLocalTimeInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
