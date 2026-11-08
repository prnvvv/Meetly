import { describe, expect, it } from "vitest";
import {
  buildInviteUrl,
  cx,
  formatCountdown,
  formatDuration,
  formatDate,
  formatDayLabel,
  getInitials,
  greetingForDate,
  isPast,
  statusLabel,
  statusTone,
} from "./utils";

const NOW = Date.UTC(2026, 0, 1, 0, 0, 0);

describe("cx", () => {
  it("joins truthy values", () => {
    expect(cx("a", "b")).toBe("a b");
  });

  it("drops false, null and undefined", () => {
    expect(cx("a", false, null, undefined, "b")).toBe("a b");
    expect(cx(false, null, undefined)).toBe("");
  });
});

describe("getInitials", () => {
  it("uses first and last name", () => {
    expect(getInitials("Pri Verma")).toBe("PV");
  });

  it("uses the first two letters for a single word", () => {
    expect(getInitials("alice")).toBe("AL");
  });

  it("collapses whitespace", () => {
    expect(getInitials("  ada   lovelace  ")).toBe("AL");
    expect(getInitials("Demo User (You)")).toBe("DU");
    expect(getInitials("(You)")).toBe("?");
  });

  it("falls back for an empty name", () => {
    expect(getInitials("   ")).toBe("?");
  });
});

describe("formatDuration", () => {
  it("formats minutes only", () => {
    expect(formatDuration(45)).toBe("45 min");
  });

  it("formats exact hours", () => {
    expect(formatDuration(60)).toBe("1 hr");
    expect(formatDuration(120)).toBe("2 hr");
  });

  it("formats hours and minutes together", () => {
    expect(formatDuration(90)).toBe("1 hr 30 min");
  });

  it("returns an empty string for missing values", () => {
    expect(formatDuration(null)).toBe("");
    expect(formatDuration(0)).toBe("");
    expect(formatDuration(undefined)).toBe("");
  });
});

describe("formatCountdown", () => {
  it("counts down seconds", () => {
    expect(formatCountdown(new Date(NOW + 40_000).toISOString(), NOW)).toBe(
      "40s"
    );
  });

  it("counts down hours and minutes", () => {
    const target = NOW + 2 * 3_600_000 + 15 * 60_000;
    expect(formatCountdown(new Date(target).toISOString(), NOW)).toBe(
      "2h 15m"
    );
  });

  it("counts down days", () => {
    const target = NOW + 2 * 86_400_000 + 3 * 3_600_000;
    expect(formatCountdown(new Date(target).toISOString(), NOW)).toBe(
      "2d 3h"
    );
  });

  it("reads now once the target has passed", () => {
    expect(formatCountdown(new Date(NOW - 5_000).toISOString(), NOW)).toBe(
      "now"
    );
    expect(formatCountdown(new Date(NOW).toISOString(), NOW)).toBe("now");
  });

  it("returns an empty string for unparseable input", () => {
    expect(formatCountdown("not-a-date", NOW)).toBe("");
  });
});

describe("greetingForDate", () => {
  it("greets by time of day", () => {
    expect(greetingForDate(new Date(2026, 0, 1, 9, 0))).toBe("Good morning");
    expect(greetingForDate(new Date(2026, 0, 1, 12, 0))).toBe(
      "Good afternoon"
    );
    expect(greetingForDate(new Date(2026, 0, 1, 17, 59))).toBe(
      "Good afternoon"
    );
    expect(greetingForDate(new Date(2026, 0, 1, 18, 0))).toBe("Good evening");
    expect(greetingForDate(new Date(2026, 0, 1, 23, 30))).toBe(
      "Good evening"
    );
  });
});

describe("formatDate", () => {
  it("formats a valid timestamp", () => {
    expect(formatDate("2026-06-15T10:00:00.000Z")).not.toBe("");
  });

  it("returns an empty string for invalid input", () => {
    expect(formatDate("nope")).toBe("");
    expect(formatDate("")).toBe("");
  });
});

describe("isPast", () => {
  it("compares against the supplied now", () => {
    expect(isPast(new Date(NOW - 1_000).toISOString(), NOW)).toBe(true);
    expect(isPast(new Date(NOW + 1_000).toISOString(), NOW)).toBe(false);
  });

  it("treats unparseable input as not past", () => {
    expect(isPast("nope", NOW)).toBe(false);
  });
});

describe("statusLabel", () => {
  it("maps known statuses", () => {
    expect(statusLabel("scheduled")).toBe("Scheduled");
    expect(statusLabel("active")).toBe("In progress");
    expect(statusLabel("ended")).toBe("Ended");
    expect(statusLabel("cancelled")).toBe("Cancelled");
  });

  it("capitalises unknown statuses", () => {
    expect(statusLabel("paused")).toBe("Paused");
  });
});

describe("statusTone", () => {
  it("maps statuses to badge tones", () => {
    expect(statusTone("active")).toBe("success");
    expect(statusTone("scheduled")).toBe("warning");
    expect(statusTone("cancelled")).toBe("danger");
    expect(statusTone("ended")).toBeUndefined();
    expect(statusTone("unknown")).toBeUndefined();
  });
});

describe("buildInviteUrl", () => {
  it("builds an absolute link in the browser", () => {
    expect(buildInviteUrl("839452761")).toBe(
      `${window.location.origin}/meetings/839452761`
    );
  });
});

describe("formatDayLabel", () => {
  const now = new Date(2026, 10, 8, 14, 30); // 8 Nov 2026, 14:30 local

  it("labels today, tomorrow and yesterday relative to local midnight", () => {
    expect(formatDayLabel(new Date(2026, 10, 8, 0, 5).toISOString(), now)).toBe("Today");
    expect(formatDayLabel(new Date(2026, 10, 8, 23, 59).toISOString(), now)).toBe("Today");
    expect(formatDayLabel(new Date(2026, 10, 9, 11, 0).toISOString(), now)).toBe("Tomorrow");
    expect(formatDayLabel(new Date(2026, 10, 7, 20, 0).toISOString(), now)).toBe("Yesterday");
  });

  it("falls back to a short date, adding the year only when it differs", () => {
    const sameYear = formatDayLabel(new Date(2026, 10, 5, 9, 0).toISOString(), now);
    expect(sameYear).not.toMatch(/2026/);
    expect(sameYear).toMatch(/5/);
    expect(formatDayLabel(new Date(2025, 10, 5, 9, 0).toISOString(), now)).toMatch(/2025/);
  });

  it("returns an empty string for an invalid date", () => {
    expect(formatDayLabel("not a date", now)).toBe("");
  });
});
