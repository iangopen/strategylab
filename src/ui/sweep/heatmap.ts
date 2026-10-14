// Pure heatmap helpers (no DOM): the colour scale, text contrast, hit-testing, labels. Unit-tested.
import { bankrollLines, smallestQualifying, type ReadoutCell } from "../../report/sweepReadout";
import type { SweepCellResult } from "../../sweep/run";
import { SWEEP_FIELD_LABELS, SWEEP_FIELD_UNITS, type SweepConfig, type SweepGrid } from "../../sweep/sweep";
import { formatInterval } from "../format";

/** Viridis (matplotlib), sampled at 0, 1/8, ..., 1: perceptually uniform and colourblind-safe, dark to light. */
const VIRIDIS: readonly (readonly [number, number, number])[] = [
  [0x44, 0x01, 0x54],
  [0x48, 0x28, 0x78],
  [0x3e, 0x49, 0x89],
  [0x31, 0x68, 0x8e],
  [0x26, 0x82, 0x8e],
  [0x1f, 0x9e, 0x89],
  [0x35, 0xb7, 0x79],
  [0x6e, 0xce, 0x58],
  [0xfd, 0xe7, 0x25],
];

function viridis(t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t)) * (VIRIDIS.length - 1);
  const i = Math.min(VIRIDIS.length - 2, Math.floor(x));
  const f = x - i;
  const a = VIRIDIS[i]!;
  const b = VIRIDIS[i + 1]!;
  return [0, 1, 2].map((c) => Math.round(a[c]! + (b[c]! - a[c]!) * f)) as [number, number, number];
}

/**
 * The colour of a P(bust) on the FIXED 0-100% scale (never rescaled to the data, so two sweeps' colours
 * mean the same thing): 0% is light yellow, 100% dark purple, so darker always means more busts.
 */
export function bustColor(p: number): [number, number, number] {
  return viridis(1 - p);
}

export const rgb = ([r, g, b]: readonly [number, number, number]): string => `rgb(${r}, ${g}, ${b})`;

/** WCAG relative luminance of an sRGB colour. */
export function luminance([r, g, b]: readonly [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Black or white text, whichever contrasts more with the cell colour. */
export function textOn(color: readonly [number, number, number]): "#000" | "#fff" {
  const l = luminance(color);
  return (l + 0.05) / 0.05 >= 1.05 / (l + 0.05) ? "#000" : "#fff";
}

/** CSS gradient for the legend, 0% at the left to 100% at the right. */
export function legendGradient(): string {
  const stops = Array.from({ length: 11 }, (_, i) => `${rgb(bustColor(i / 10))} ${i * 10}%`);
  return `linear-gradient(to right, ${stops.join(", ")})`;
}

/** Label every k-th column so labels about `labelWidth` px wide never overlap in cells `cellWidth` px wide. */
export function labelStride(cellWidth: number, labelWidth: number): number {
  return Math.max(1, Math.ceil((labelWidth + 6) / Math.max(1, cellWidth)));
}

export interface GridBox {
  left: number;
  top: number;
  cellW: number;
  cellH: number;
  cols: number;
  rows: number;
}

/** The cell under a point, or null. Row 0 (the smallest y value) is drawn at the BOTTOM. Returns the cell index. */
export function cellAt(g: GridBox, px: number, py: number): number | null {
  const col = Math.floor((px - g.left) / g.cellW);
  const fromTop = Math.floor((py - g.top) / g.cellH);
  if (col < 0 || col >= g.cols || fromTop < 0 || fromTop >= g.rows) return null;
  const row = g.rows - 1 - fromTop;
  return row * g.cols + col;
}

export const axisTitle = (a: SweepConfig["x"]) => `${SWEEP_FIELD_LABELS[a.field]} (${SWEEP_FIELD_UNITS[a.field]})`;

/** One cell's numbers in words, for the hover / tap readout and the table. */
export function cellText(c: SweepCellResult | null): string {
  if (!c) return "not run yet";
  return formatInterval(c.stats.pBust, c.stats.pBustLow, c.stats.pBustHigh, 1);
}

/** Cells that are the smallest bankroll meeting the target on their line (the readout's answer), once every cell on the line has run. */
export function markedCells(sweep: SweepConfig, grid: SweepGrid, cells: readonly (SweepCellResult | null)[]): Set<number> {
  const out = new Set<number>();
  const t = sweep.targetPct / 100;
  for (const line of bankrollLines(sweep, grid) ?? []) {
    const results = line.cells.map((k) => cells[k] ?? null);
    if (results.some((c) => c === null)) continue;
    const i = smallestQualifying(results.map((c) => readoutCell(c!)), t);
    if (i !== null) out.add(line.cells[i]!);
  }
  return out;
}

/** The three numbers the readout uses, from a cell's statistics. */
export function readoutCell(c: SweepCellResult): ReadoutCell {
  return { pBust: c.stats.pBust!, pBustLow: c.stats.pBustLow!, pBustHigh: c.stats.pBustHigh! };
}
