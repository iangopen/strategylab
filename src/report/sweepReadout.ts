// The sweep readout: "what is the smallest bankroll on this grid that keeps P(bust) under X%", per value
// of the other axis. Pure (no React, no DOM), next to takeaways.ts and in its hedging style:
// - a bankroll counts only when the UPPER end of its 95% Wilson interval for P(bust) is below the
//   target, and the sentences say so (an estimate alone below the target is not enough);
// - "on this grid": bankrolls between grid points were not simulated, and each cell is its own run;
// - a bankroll is named only when it AND every larger bankroll on the line count. Each line checks up
//   to 20 independent cells, so one borderline cell can pass by chance below a larger one that fails;
//   when the bankrolls that count are not one unbroken run up to the largest, the sentence says the
//   result is unstable at this sample size and names no bankroll (session 21).
import { formatAxisValue, type SweepConfig, type SweepField, type SweepGrid } from "../sweep/sweep";
import { formatInterval } from "../ui/format";

export interface ReadoutCell {
  pBust: number;
  pBustLow: number;
  pBustHigh: number;
}

export interface ReadoutGroup {
  /** The other axis's setting and value for this line (e.g. base bet $10). */
  field: SweepField;
  value: number;
  /** One cell per bankroll, aligned with `bankrolls`; null while a cell has not run. */
  cells: readonly (ReadoutCell | null)[];
}

export interface SweepReadoutInput {
  /** Target in percent (5 = 5%). */
  targetPct: number;
  sessionsPerCell: number;
  /** The bankroll axis values in dollars, ascending; null when neither axis is the starting bankroll. */
  bankrolls: readonly number[] | null;
  groups: readonly ReadoutGroup[];
}

/** A cell meets the target only when its interval's upper bound is below it (the conservative rule). */
export function meetsTarget(cell: ReadoutCell, target: number): boolean {
  return cell.pBustHigh < target;
}

/**
 * One line's answer, `cells` in ascending bankroll order:
 * - "from": every bankroll from `index` up to the largest meets the target, and none below it does;
 * - "none": no bankroll meets it;
 * - "unstable": some meet it but they are not one unbroken run up to the largest. `pass` is the
 *   smallest that meets it and `miss` the first larger one that does not.
 */
export type LineAnswer = { kind: "from"; index: number } | { kind: "none" } | { kind: "unstable"; pass: number; miss: number };

export function lineAnswer(cells: readonly ReadoutCell[], target: number): LineAnswer {
  const pass = cells.findIndex((c) => meetsTarget(c, target));
  if (pass < 0) return { kind: "none" };
  const miss = cells.findIndex((c, j) => j > pass && !meetsTarget(c, target));
  return miss < 0 ? { kind: "from", index: pass } : { kind: "unstable", pass, miss };
}

const targetText = (pct: number) => `${Number(pct.toPrecision(6))}%`;

/**
 * Digits for the interval text so the printed numbers never contradict the claim: an upper bound of
 * 4.96% is printed "4.96%", not "5.0%", next to "below 5%".
 */
function digitsFor(cell: ReadoutCell, target: number): number {
  for (let d = 1; d < 4; d++) {
    const shown = (v: number) => Math.round(v * 100 * 10 ** d) / 10 ** d / 100;
    if ([cell.pBust, cell.pBustHigh].every((v) => v < target === shown(v) < target)) return d;
  }
  return 4;
}

const show = (c: ReadoutCell, target: number) => formatInterval(c.pBust, c.pBustLow, c.pBustHigh, digitsFor(c, target));

function groupPhrase(field: SweepField, value: number): string {
  switch (field) {
    case "baseBet":
      return `With a base bet of ${formatAxisValue(field, value)}`;
    case "maxRounds":
      return `With at most ${formatAxisValue(field, value)} rounds per session`;
    case "startBankroll":
      return `With a starting bankroll of ${formatAxisValue(field, value)}`;
  }
}

/** The readout sentences: an explanation of the rule, then one sentence per value of the other axis. */
export function sweepReadout(input: SweepReadoutInput): string[] {
  const { targetPct, bankrolls, groups } = input;
  const t = targetText(targetPct);
  const target = targetPct / 100;
  if (bankrolls === null) return [`The bankroll readout needs the starting bankroll as one of the two axes.`];
  if (groups.some((g) => g.cells.some((c) => c === null))) return ["The bankroll readout appears when every cell has finished."];
  const money = (i: number) => formatAxisValue("startBankroll", bankrolls[i]!);

  const out = [
    `Target: P(bust) below ${t}. A bankroll counts only when the upper end of its 95% interval for P(bust) is below ${t}, a conservative test: the estimate alone could make a smaller bankroll look safe. A bankroll is named only when it and every larger bankroll on the grid count, because with many cells one can pass by chance. Each cell is a separate simulation of ${input.sessionsPerCell.toLocaleString("en-US")} sessions, and bankrolls between grid points were not simulated.`,
  ];
  for (const g of groups) {
    const cells = g.cells as readonly ReadoutCell[];
    const lead = groupPhrase(g.field, g.value);
    const a = lineAnswer(cells, target);
    if (a.kind === "from") {
      const rest = a.index === cells.length - 1 ? "" : ", and every larger bankroll on this grid meets it too";
      out.push(`${lead}, the smallest bankroll on this grid that meets it is ${money(a.index)}: P(bust) ${show(cells[a.index]!, target)}${rest}.`);
      continue;
    }
    if (a.kind === "unstable") {
      out.push(
        `${lead}, the result is unstable at this sample size, so no bankroll is named: ${money(a.pass)} meets the target (${show(cells[a.pass]!, target)}) but a larger bankroll on this grid, ${money(a.miss)}, does not (${show(cells[a.miss]!, target)}). More sessions per cell would narrow the intervals.`,
      );
      continue;
    }
    let s = `${lead}, no bankroll on this grid keeps the upper end of P(bust) below ${t}.`;
    const near = cells.findIndex((c) => c.pBust < target);
    if (near >= 0) s += ` At ${money(near)} the estimate is below ${t}, P(bust) ${show(cells[near]!, target)}, but its interval reaches ${t} or more, so it does not count.`;
    out.push(s);
  }
  return out;
}

/**
 * The cell indices of each readout line, in ascending bankroll order: one line per value of the other
 * axis (cells are numbered row * columns + column). Null when neither axis is the starting bankroll.
 */
export function bankrollLines(sweep: SweepConfig, grid: SweepGrid): { field: SweepField; value: number; cells: number[] }[] | null {
  const nx = grid.xValues.length;
  if (sweep.x.field === "startBankroll") return grid.yValues.map((value, r) => ({ field: sweep.y.field, value, cells: grid.xValues.map((_, c) => r * nx + c) }));
  if (sweep.y.field === "startBankroll") return grid.xValues.map((value, c) => ({ field: sweep.x.field, value, cells: grid.yValues.map((_, r) => r * nx + c) }));
  return null;
}

/** The readout input for a sweep's grid; `cells` is in cell order, null for a cell that has not run. */
export function readoutInputOf(sweep: SweepConfig, grid: SweepGrid, cells: readonly (ReadoutCell | null)[]): SweepReadoutInput {
  const lines = bankrollLines(sweep, grid);
  const base = { targetPct: sweep.targetPct, sessionsPerCell: grid.sessionsPerCell };
  if (!lines) return { ...base, bankrolls: null, groups: [] };
  return { ...base, bankrolls: sweep.x.field === "startBankroll" ? grid.xValues : grid.yValues, groups: lines.map((l) => ({ field: l.field, value: l.value, cells: l.cells.map((k) => cells[k] ?? null) })) };
}
