/** Small pure helpers shared across components. */

export function cx(
  ...values: Array<string | false | null | undefined>
): string {
  return values.filter(Boolean).join(" ");
}

export function getInitials(name: string): string {
  // Ignore annotations such as "(You)" or "(Host)" so "Demo User (You)" is "DU".
  const parts = name
    .replace(/\([^)]*\)/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function toDate(iso: string): Date | null {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(iso: string): string {
  const date = toDate(iso);
  if (!date) return "";
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatDateShort(iso: string): string {
  const date = toDate(iso);
  if (!date) return "";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatTime(iso: string): string {
  const date = toDate(iso);
  if (!date) return "";
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatTimeRange(startIso: string, durationMinutes?: number | null) {
  const start = toDate(startIso);
  if (!start) return { start: "", end: "" };
  const startLabel = formatTime(startIso);
  if (!durationMinutes) return { start: startLabel, end: "" };
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  return {
    start: startLabel,
    end: end.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }),
  };
}

/** "Today" / "Tomorrow" / "Yesterday", otherwise "Mon, Nov 9". */
export function formatDayLabel(iso: string, now: Date = new Date()): string {
  const date = toDate(iso);
  if (!date) return "";
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((startOf(date) - startOf(now)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
}

export function formatDuration(minutes?: number | null): string {
  if (!minutes || minutes <= 0) return "";
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours && mins) return `${hours} hr ${mins} min`;
  if (hours) return `${hours} hr`;
  return `${mins} min`;
}

/** "in 2h 15m" / "in 40s" / "now" for a future ISO timestamp. */
export function formatCountdown(iso: string, now: number = Date.now()): string {
  const target = toDate(iso);
  if (!target) return "";
  const diff = target.getTime() - now;
  if (diff <= 0) return "now";
  const totalSeconds = Math.floor(diff / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

export function greetingForDate(now: Date = new Date()): string {
  const hour = now.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function todayLabel(now: Date = new Date()): string {
  return now.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export function isPast(iso: string, now: number = Date.now()): boolean {
  const target = toDate(iso);
  return target ? target.getTime() < now : false;
}

export function buildInviteUrl(meetingId: string): string {
  if (typeof window === "undefined") return `/meetings/${meetingId}`;
  return `${window.location.origin}/meetings/${meetingId}`;
}

export function statusLabel(status: string): string {
  switch (status) {
    case "scheduled":
      return "Scheduled";
    case "active":
      return "In progress";
    case "ended":
      return "Ended";
    case "cancelled":
      return "Cancelled";
    default:
      return status.charAt(0).toUpperCase() + status.slice(1);
  }
}

export function statusTone(
  status: string
): "success" | "danger" | "warning" | undefined {
  switch (status) {
    case "active":
      return "success";
    case "ended":
      return undefined;
    case "cancelled":
      return "danger";
    case "scheduled":
      return "warning";
    default:
      return undefined;
  }
}

/** Return a human-readable relative time string for an ISO timestamp.
 *
 * Examples (when called from now):
 * - "in 2 minutes"
 * - "in 3 hours"
 * - "2 days ago"
 * - "just now"
 */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const target = toDate(iso);
  if (!target) return "";

  const targetUTC = new Date(
    target.getTime() - target.getTimezoneOffset() * 60000
  );
  const nowUTC = new Date(
    now.getTime() - now.getTimezoneOffset() * 60000
  );
  const deltaSeconds = (targetUTC.getTime() - nowUTC.getTime()) / 1000;

  if (deltaSeconds < -60) {
    deltaSeconds = Math.abs(deltaSeconds);
    if (deltaSeconds < 60) {
      return "just now";
    }
    const minutes = Math.floor(deltaSeconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    if (days === 1) return "1 day ago";
    return `${days} days ago`;
  }

  if (deltaSeconds < 60) {
    const seconds = Math.floor(deltaSeconds);
    if (seconds <= 1) return "just now";
    return `in ${seconds} seconds`;
  }

  const minutes = Math.floor(deltaSeconds / 60);
  const hours = Math.floor(minutes / 60);
  minutes = minutes % 60;

  if (hours === 0) {
    if (minutes === 1) return "in 1 minute";
    return `in ${minutes} minutes`;
  }

  if (hours === 1) {
    if (minutes === 0) return "in 1 hour";
    return `in 1 hour ${minutes} minutes`;
  }

  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;

  const parts: string[] = [];
  if (days === 1) parts.push("1 day");
  else if (days > 1) parts.push(`${days} days`);

  if (remainingHours === 1) parts.push("1 hour");
  else if (remainingHours > 1) parts.push(`${remainingHours} hours`);

  if (minutes === 1) parts.push("1 minute");
  else if (minutes > 1) parts.push(`${minutes} minutes`);

  if (parts.length === 1) return `in ${parts[0]}`;
  return `in ${parts.slice(0, -1).join(", ")} and ${parts[-1]}`;
}

/** Copy helper that falls back to a hidden textarea when the API is blocked. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to legacy path */
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}
