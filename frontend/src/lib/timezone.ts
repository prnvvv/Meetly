/** Time zone helpers for scheduling: wall-clock time in a chosen IANA zone -> UTC instant. */

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Current names for zones some engines only list under a legacy alias (e.g. Asia/Calcutta). */
const MODERN_NAMES = [
  "Asia/Kolkata",
  "Asia/Ho_Chi_Minh",
  "Asia/Yangon",
  "Europe/Kyiv",
  "America/Nuuk",
  "Atlantic/Faroe",
  "Pacific/Kanton",
];

/** IANA zones for the picker, with the browser's own zone always included. */
export function listTimeZones(): string[] {
  let zones: string[] = [];
  try {
    const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
    zones = supported ? supported("timeZone") : [];
  } catch {
    zones = [];
  }
  const own = browserTimeZone();
  const set = new Set(["UTC", own, ...zones, ...MODERN_NAMES.filter(isValidTimeZone)]);
  return [...set].sort((a, b) => a.localeCompare(b));
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Offset (ms) of `timeZone` from UTC at the instant `utcMs`. */
function offsetAt(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/**
 * The UTC instant at which the wall clock in `timeZone` reads the given date
 * and time. `month` is 1-12. Returns null for an invalid zone or date.
 * Handles daylight-saving changes (a skipped hour resolves forward).
 */
export function zonedWallTimeToIso(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string
): string | null {
  if (![year, month, day, hour, minute].every(Number.isFinite) || !isValidTimeZone(timeZone)) return null;
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  if (Number.isNaN(guess)) return null;
  let utc = guess - offsetAt(guess, timeZone);
  utc = guess - offsetAt(utc, timeZone);
  const result = new Date(utc);
  return Number.isNaN(result.getTime()) ? null : result.toISOString();
}
