import { describe, expect, it } from "vitest";
import { fitGrid, lastRowStart, pageSlice } from "./gridLayout";

describe("fitGrid", () => {
  it("uses a single cell for one participant", () => {
    expect(fitGrid(1, 1600, 800)).toMatchObject({
      columns: 1,
      rows: 1,
      pageCount: 1,
    });
  });

  it("places two participants side by side", () => {
    expect(fitGrid(2, 1600, 800)).toMatchObject({ columns: 2, rows: 1 });
  });

  it("balances three participants over two columns", () => {
    const fit = fitGrid(3, 1600, 800);
    expect(fit.columns).toBe(2);
    expect(fit.rows).toBe(2);
    expect(fit.pageCount).toBe(1);
  });

  it("builds a 2x2 grid for four participants", () => {
    expect(fitGrid(4, 1600, 800)).toMatchObject({ columns: 2, rows: 2 });
  });

  it("scales to a 3x3 grid for nine participants", () => {
    expect(fitGrid(9, 1920, 1000)).toMatchObject({ columns: 3, rows: 3 });
  });

  it("keeps every tile on one page when space allows", () => {
    const fit = fitGrid(12, 1920, 1000);
    expect(fit.pageCount).toBe(1);
    expect(fit.columns * fit.rows).toBeGreaterThanOrEqual(12);
  });

  it("paginates rather than shrinking tiles below the minimum", () => {
    const fit = fitGrid(60, 700, 400, { minCellWidth: 150, minCellHeight: 96 });
    expect(fit.pageCount).toBeGreaterThan(1);
    expect(fit.columns * fit.rows).toBe(fit.pageSize);
    expect(fit.pageSize).toBeLessThan(60);
  });

  it("never asks for a cell wider than the stage", () => {
    const fit = fitGrid(6, 640, 360);
    const cellWidth = 640 / fit.columns;
    expect(cellWidth).toBeGreaterThan(0);
    expect(fit.columns).toBeLessThanOrEqual(6);
  });

  it("falls back to a count-based estimate before the size is known", () => {
    expect(fitGrid(4, 0, 0)).toMatchObject({ columns: 2, rows: 2 });
    expect(fitGrid(1, 0, 0)).toMatchObject({ columns: 1, rows: 1 });
  });

  it("treats a zero or negative count as one tile", () => {
    expect(fitGrid(0, 800, 600)).toMatchObject({ columns: 1, rows: 1 });
  });

  it("prefers a wider grid over a tall one on a wide stage", () => {
    const fit = fitGrid(8, 1920, 600);
    expect(fit.columns).toBeGreaterThanOrEqual(fit.rows);
  });
});

describe("fitGrid with real video aspect ratios", () => {
  it("still uses one cell for a single participant of any shape", () => {
    expect(fitGrid(1, 1800, 880, { aspects: [4 / 3] })).toMatchObject({ columns: 1, rows: 1 });
    expect(fitGrid(1, 1800, 880, { aspects: [3 / 4] })).toMatchObject({ columns: 1, rows: 1 });
  });

  it("puts two portrait cameras side by side on a wide stage", () => {
    expect(fitGrid(2, 1800, 880, { aspects: [3 / 4, 3 / 4] })).toMatchObject({
      columns: 2,
      rows: 1,
    });
  });

  it("stacks two landscape cameras when the stage is tall and narrow", () => {
    expect(fitGrid(2, 500, 900, { aspects: [16 / 9, 16 / 9] })).toMatchObject({
      columns: 1,
      rows: 2,
    });
  });

  it("covers more area than the 16:9 assumption for portrait sources", () => {
    const area = (columns: number, aspects: number[], w: number, h: number) => {
      const rows = Math.ceil(aspects.length / columns);
      const cw = (w - 12 * (columns - 1)) / columns;
      const ch = (h - 12 * (rows - 1)) / rows;
      return aspects.reduce((sum, ar) => {
        const tw = Math.min(cw, ch * ar);
        return sum + tw * (tw / ar);
      }, 0);
    };
    const aspects = [3 / 4, 3 / 4, 3 / 4];
    const aware = fitGrid(3, 1800, 880, { aspects });
    const legacy = fitGrid(3, 1800, 880);
    expect(area(aware.columns, aspects, 1800, 880)).toBeGreaterThanOrEqual(
      area(legacy.columns, aspects, 1800, 880)
    );
  });

  it("treats avatar tiles (no aspect) as filling their cell", () => {
    expect(fitGrid(4, 1600, 800, { aspects: [null, null, null, null] })).toMatchObject({
      columns: 2,
      rows: 2,
    });
  });

  it("ignores invalid aspects", () => {
    expect(() => fitGrid(2, 1600, 800, { aspects: [0, Number.NaN] })).not.toThrow();
  });
});

describe("lastRowStart", () => {
  it("starts full rows at column one", () => {
    expect(lastRowStart(4, 2)).toBe(1);
    expect(lastRowStart(6, 3)).toBe(1);
  });

  it("centres a single leftover tile", () => {
    expect(lastRowStart(3, 2)).toBe(2);
    expect(lastRowStart(7, 3)).toBe(2);
  });

  it("centres two leftovers in a four column grid", () => {
    expect(lastRowStart(6, 4)).toBe(2);
  });

  it("ignores counts that do not need centring", () => {
    expect(lastRowStart(1, 1)).toBe(1);
    expect(lastRowStart(0, 3)).toBe(1);
  });
});

describe("pageSlice", () => {
  const fit = { columns: 2, rows: 2, pageSize: 4, pageCount: 3 };

  it("returns everything when there is one page", () => {
    const single = { ...fit, pageCount: 1, pageSize: 10 };
    expect(pageSlice([1, 2, 3], 0, single)).toEqual({
      visible: [1, 2, 3],
      start: 0,
    });
  });

  it("slices the requested page", () => {
    expect(pageSlice([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 1, fit)).toEqual({
      visible: [5, 6, 7, 8],
      start: 4,
    });
  });

  it("clamps a page past the end", () => {
    expect(pageSlice([1, 2, 3], 9, fit)).toEqual({ visible: [1, 2, 3], start: 0 });
  });
});
