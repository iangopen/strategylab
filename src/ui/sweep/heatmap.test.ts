import { describe, expect, it } from "vitest";
import type { SweepCellResult } from "../../sweep/run";
import type { SweepConfig } from "../../sweep/sweep";
import { bustColor, cellAt, labelStride, luminance, markedCells, textOn } from "./heatmap";

describe("heatmap colour scale", () => {
  it("is fixed 0-100%: light yellow at 0%, dark purple at 100% (viridis), clamped outside", () => {
    expect(bustColor(0)).toEqual([0xfd, 0xe7, 0x25]);
    expect(bustColor(1)).toEqual([0x44, 0x01, 0x54]);
    expect(bustColor(-1)).toEqual(bustColor(0));
    expect(bustColor(2)).toEqual(bustColor(1));
  });

  it("is sequential: luminance falls steadily as P(bust) rises, so darker always means more busts (also in grey)", () => {
    const l = Array.from({ length: 101 }, (_, i) => luminance(bustColor(i / 100)));
    for (let i = 1; i < l.length; i++) expect(l[i]!, `at ${i}%`).toBeLessThan(l[i - 1]!);
  });

  it("cell text is black on light cells and white on dark ones", () => {
    expect(textOn(bustColor(0))).toBe("#000");
    expect(textOn(bustColor(1))).toBe("#fff");
  });
});

describe("heatmap geometry", () => {
  const g = { left: 64, top: 6, cellW: 20, cellH: 15, cols: 3, rows: 2 };
  it("hit-testing: row 0 is at the bottom; outside the grid is null", () => {
    expect(cellAt(g, 65, 6 + 15 + 1)).toBe(0); // bottom-left
    expect(cellAt(g, 64 + 2 * 20 + 1, 7)).toBe(5); // top-right
    expect(cellAt(g, 63, 10)).toBeNull();
    expect(cellAt(g, 64 + 60, 10)).toBeNull();
    expect(cellAt(g, 70, 6 + 30)).toBeNull();
  });

  it("axis labels are thinned so they never overlap", () => {
    expect(labelStride(80, 40)).toBe(1);
    expect(labelStride(14, 40)).toBe(4);
  });
});

describe("readout markers", () => {
  const cell = (index: number, high: number): SweepCellResult => ({ index, nSessions: 1000, stats: { pBust: high - 0.01, pBustLow: high - 0.02, pBustHigh: high } });
  const sweep: SweepConfig = { x: { field: "startBankroll", start: 100, end: 300, steps: 3 }, y: { field: "baseBet", start: 5, end: 10, steps: 2 }, strategyUid: "u", targetPct: 5 };
  const grid = { xValues: [100, 200, 300], yValues: [5, 10], cells: 6, sessionsPerCell: 1000 };

  it("mark the smallest bankroll per line whose upper bound is below the target, only for finished lines", () => {
    const cells = [cell(0, 0.2), cell(1, 0.04), cell(2, 0.01), cell(3, 0.3), cell(4, 0.2), cell(5, 0.1)];
    expect([...markedCells(sweep, grid, cells)]).toEqual([1]);
    expect([...markedCells(sweep, grid, [cell(0, 0.01), null, null, null, null, null])]).toEqual([]);
    expect([...markedCells({ ...sweep, x: { ...sweep.x, field: "maxRounds" } }, grid, cells)]).toEqual([]);
  });
});
