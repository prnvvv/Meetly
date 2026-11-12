import { describe, expect, it } from "vitest";
import { isValidTimeZone, listTimeZones, zonedWallTimeToIso } from "./timezone";

describe("zonedWallTimeToIso", () => {
  it("converts New York winter (UTC-5) and summer (UTC-4) times", () => {
    expect(zonedWallTimeToIso(2027, 1, 15, 9, 0, "America/New_York")).toBe("2027-01-15T14:00:00.000Z");
    expect(zonedWallTimeToIso(2027, 7, 15, 9, 0, "America/New_York")).toBe("2027-07-15T13:00:00.000Z");
  });
  it("handles half-hour zones and UTC", () => {
    expect(zonedWallTimeToIso(2027, 3, 1, 10, 30, "Asia/Kolkata")).toBe("2027-03-01T05:00:00.000Z");
    expect(zonedWallTimeToIso(2027, 3, 1, 10, 30, "UTC")).toBe("2027-03-01T10:30:00.000Z");
  });
  it("crosses the date line correctly", () => {
    expect(zonedWallTimeToIso(2027, 3, 1, 1, 0, "Pacific/Auckland")).toBe("2027-02-28T12:00:00.000Z");
  });
  it("rejects bad zones and dates", () => {
    expect(zonedWallTimeToIso(2027, 1, 1, 1, 0, "Nope/Zone")).toBeNull();
    expect(zonedWallTimeToIso(NaN, 1, 1, 1, 0, "UTC")).toBeNull();
    expect(isValidTimeZone("Europe/Paris")).toBe(true);
  });
  it("lists zones including UTC", () => {
    expect(listTimeZones()).toContain("UTC");
  });
});

import { buildStartTimestamp } from "./validators";

describe("buildStartTimestamp with a zone", () => {
  it("uses the chosen zone instead of the browser's", () => {
    expect(buildStartTimestamp("2027-07-15", "09:00", "America/New_York")).toBe("2027-07-15T13:00:00.000Z");
    expect(buildStartTimestamp("2027-07-15", "09:00", "Asia/Kolkata")).toBe("2027-07-15T03:30:00.000Z");
  });
});
