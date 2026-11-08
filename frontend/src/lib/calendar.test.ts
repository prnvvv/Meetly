import { describe, expect, it } from "vitest";
import { addMonths, buildMonthGrid, dayKey, gridRange, groupByDay, isPastDay } from "./calendar";
import type { Meeting } from "@/types/meeting";

function meeting(id: string, start: string): Meeting {
  return {
    id: 1,
    meeting_id: id,
    host_id: 1,
    title: id,
    description: null,
    start_time: start,
    end_time: null,
    duration: 30,
    status: "scheduled",
    meeting_link: "",
    created_at: start,
  };
}

describe("calendar helpers", () => {
  it("always builds six full weeks starting on Sunday", () => {
    for (const month of [new Date(2026, 1, 1), new Date(2026, 10, 1), new Date(2027, 0, 1)]) {
      const grid = buildMonthGrid(month);
      expect(grid).toHaveLength(42);
      expect(grid[0].date.getDay()).toBe(0);
      expect(grid.filter((cell) => cell.inMonth).length).toBeGreaterThanOrEqual(28);
    }
  });

  it("flags only the target month as inMonth", () => {
    const grid = buildMonthGrid(new Date(2026, 10, 15));
    expect(grid.find((c) => c.key === "2026-11-01")?.inMonth).toBe(true);
    expect(grid.find((c) => c.key === "2026-12-01")?.inMonth).toBe(false);
  });

  it("rolls months across year boundaries", () => {
    expect(dayKey(addMonths(new Date(2026, 11, 20), 1))).toBe("2027-01-01");
    expect(dayKey(addMonths(new Date(2026, 0, 20), -1))).toBe("2025-12-01");
  });

  it("covers the whole 42-day grid in the range window", () => {
    const { start, end } = gridRange(new Date(2026, 10, 1));
    expect(dayKey(start)).toBe(buildMonthGrid(new Date(2026, 10, 1))[0].key);
    expect(Math.round((end.getTime() - start.getTime()) / 86_400_000)).toBe(42);
  });

  it("groups meetings by local day in time order", () => {
    const a = new Date(2026, 10, 9, 15, 0).toISOString();
    const b = new Date(2026, 10, 9, 9, 0).toISOString();
    const c = new Date(2026, 10, 10, 9, 0).toISOString();
    const groups = groupByDay([meeting("a", a), meeting("b", b), meeting("c", c)]);
    expect(groups.get("2026-11-09")?.map((m) => m.meeting_id)).toEqual(["b", "a"]);
    expect(groups.get("2026-11-10")).toHaveLength(1);
  });

  it("treats earlier days as past but not today", () => {
    const now = new Date(2026, 10, 8, 12, 0);
    expect(isPastDay(new Date(2026, 10, 7), now)).toBe(true);
    expect(isPastDay(new Date(2026, 10, 8), now)).toBe(false);
  });
});
