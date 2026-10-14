import { describe, expect, it } from "vitest";
import type { SweepConfig } from "../sweep/sweep";
import { bankrollLines, lineAnswer, meetsTarget, readoutInputOf, sweepReadout, type ReadoutCell, type SweepReadoutInput } from "./sweepReadout";

// Hand-built cells (no simulation): [P(bust), Wilson low, Wilson high].
const c = (p: number, low: number, high: number): ReadoutCell => ({ pBust: p, pBustLow: low, pBustHigh: high });
const BANKROLLS = [200, 400, 600, 800];
const input = (groups: SweepReadoutInput["groups"], targetPct = 5): SweepReadoutInput => ({ targetPct, sessionsPerCell: 2500, bankrolls: BANKROLLS, groups });

describe("sweep readout: smallest bankroll from which every bankroll's P(bust) upper bound is below the target", () => {
  it("a qualifying bankroll is found, and the sentence says the test uses the upper end of the interval", () => {
    const t = sweepReadout(input([{ field: "baseBet", value: 10, cells: [c(0.3, 0.28, 0.32), c(0.09, 0.08, 0.1), c(0.031, 0.025, 0.038), c(0.01, 0.007, 0.014)] }]));
    for (const s of t) console.log(`[readout] ${s}`);
    expect(t[0]).toBe(
      "Target: P(bust) below 5%. A bankroll counts only when the upper end of its 95% interval for P(bust) is below 5%, a conservative test: the estimate alone could make a smaller bankroll look safe. A bankroll is named only when it and every larger bankroll on the grid count, because with many cells one can pass by chance. Each cell is a separate simulation of 2,500 sessions, and bankrolls between grid points were not simulated.",
    );
    expect(t[1]).toBe("With a base bet of $10, the smallest bankroll on this grid that meets it is $600: P(bust) 3.1% (2.5–3.8%), and every larger bankroll on this grid meets it too.");
  });

  it("no bankroll qualifies: 'no bankroll on this grid'", () => {
    const t = sweepReadout(input([{ field: "baseBet", value: 50, cells: [c(0.9, 0.89, 0.91), c(0.6, 0.58, 0.62), c(0.3, 0.28, 0.32), c(0.12, 0.11, 0.13)] }]));
    expect(t[1]).toBe("With a base bet of $50, no bankroll on this grid keeps the upper end of P(bust) below 5%.");
  });

  it("an estimate under the target with an upper bound that is not does NOT qualify, and the sentence says why", () => {
    const close = c(0.04, 0.0319, 0.0501);
    expect(meetsTarget(close, 0.05)).toBe(false);
    const t = sweepReadout(input([{ field: "baseBet", value: 20, cells: [c(0.5, 0.48, 0.52), c(0.2, 0.18, 0.22), c(0.08, 0.07, 0.09), close] }]));
    expect(t[1]).toBe(
      "With a base bet of $20, no bankroll on this grid keeps the upper end of P(bust) below 5%. At $800 the estimate is below 5%, P(bust) 4.0% (3.2–5.0%), but its interval reaches 5% or more, so it does not count.",
    );
    expect(t[1]).not.toContain("smallest bankroll on this grid that meets it");
  });

  it("the point estimate never decides: a cell whose estimate is under the target but upper bound over is skipped for a larger one", () => {
    const cells = [c(0.045, 0.036, 0.056), c(0.02, 0.015, 0.026)];
    expect(lineAnswer(cells, 0.05)).toEqual({ kind: "from", index: 1 });
    const t = sweepReadout({ ...input([{ field: "baseBet", value: 5, cells }]), bankrolls: [300, 700] });
    expect(t[1]).toBe("With a base bet of $5, the smallest bankroll on this grid that meets it is $700: P(bust) 2.0% (1.5–2.6%).");
  });

  // Multiple comparisons (session 21): with ~20 independent cells per line, one borderline cell can
  // pass by chance. The answer must hold for the named bankroll AND every larger one on the line.
  const FAIL = c(0.2, 0.18, 0.22);
  const LUCKY = c(0.04, 0.035, 0.048); // upper bound 4.8%: passes, barely
  const MISS = c(0.05, 0.043, 0.057);
  const PASS = c(0.03, 0.025, 0.036);

  it("a lucky isolated passing cell below a failing one is NOT reported as the answer", () => {
    const cells = [FAIL, LUCKY, MISS, PASS];
    expect(lineAnswer(cells, 0.05)).toEqual({ kind: "unstable", pass: 1, miss: 2 });
    const t = sweepReadout(input([{ field: "baseBet", value: 10, cells }]));
    expect(t[1]).not.toContain("smallest bankroll on this grid that meets it");
    expect(t[1]).not.toMatch(/meets it is \$/);
  });

  it("a contiguous passing run up to the largest bankroll is reported from its first cell", () => {
    expect(lineAnswer([FAIL, MISS, LUCKY, PASS], 0.05)).toEqual({ kind: "from", index: 2 });
    expect(lineAnswer([PASS, PASS, PASS, PASS], 0.05)).toEqual({ kind: "from", index: 0 });
    expect(lineAnswer([FAIL, FAIL, FAIL, PASS], 0.05)).toEqual({ kind: "from", index: 3 });
    const t = sweepReadout(input([{ field: "baseBet", value: 10, cells: [FAIL, MISS, LUCKY, PASS] }]));
    expect(t[1]).toBe("With a base bet of $10, the smallest bankroll on this grid that meets it is $600: P(bust) 4.0% (3.5–4.8%), and every larger bankroll on this grid meets it too.");
    // The largest bankroll alone: no "every larger" clause.
    expect(sweepReadout(input([{ field: "baseBet", value: 10, cells: [FAIL, FAIL, FAIL, PASS] }]))[1]).toBe("With a base bet of $10, the smallest bankroll on this grid that meets it is $800: P(bust) 3.0% (2.5–3.6%).");
  });

  it("non-contiguous passes give the 'unstable' sentence and name no bankroll", () => {
    const t = sweepReadout(input([{ field: "baseBet", value: 10, cells: [LUCKY, MISS, PASS, PASS] }]));
    expect(t[1]).toBe(
      "With a base bet of $10, the result is unstable at this sample size, so no bankroll is named: $200 meets the target (4.0% (3.5–4.8%)) but a larger bankroll on this grid, $400, does not (5.0% (4.3–5.7%)). More sessions per cell would narrow the intervals.",
    );
    // A run that passes and then fails at the largest bankroll is unstable too: no bankroll has every larger one passing.
    expect(lineAnswer([FAIL, PASS, PASS, MISS], 0.05)).toEqual({ kind: "unstable", pass: 1, miss: 3 });
  });

  it("digits never contradict the claim: an upper bound of 4.96% prints as 4.96%, not 5.0%", () => {
    const t = sweepReadout(input([{ field: "baseBet", value: 10, cells: [c(0.3, 0.28, 0.32), c(0.042, 0.035, 0.0496), c(0.01, 0.007, 0.014), c(0.01, 0.007, 0.014)] }]));
    expect(t[1]).toContain("$400: P(bust) 4.20% (3.50–4.96%)");
  });

  it("one line per value of the other axis, any target, and the other axis worded in its unit", () => {
    const t = sweepReadout({
      ...input(
        [
          { field: "maxRounds", value: 100, cells: [c(0.02, 0.01, 0.024), c(0.01, 0.005, 0.015), c(0, 0, 0.0015), c(0, 0, 0.0015)] },
          { field: "maxRounds", value: 1000, cells: [c(0.4, 0.38, 0.42), c(0.2, 0.18, 0.22), c(0.1, 0.09, 0.11), c(0.05, 0.04, 0.06)] },
        ],
        2.5,
      ),
    });
    expect(t).toHaveLength(3);
    expect(t[0]).toMatch(/^Target: P\(bust\) below 2.5%\./);
    expect(t[1]).toBe("With at most 100 rounds per session, the smallest bankroll on this grid that meets it is $200: P(bust) 2.0% (1.0–2.4%), and every larger bankroll on this grid meets it too.");
    expect(t[2]).toBe("With at most 1,000 rounds per session, no bankroll on this grid keeps the upper end of P(bust) below 2.5%.");
  });

  it("no bankroll axis, or cells not run yet: says so instead of answering", () => {
    expect(sweepReadout({ ...input([]), bankrolls: null })).toEqual(["The bankroll readout needs the starting bankroll as one of the two axes."]);
    expect(sweepReadout(input([{ field: "baseBet", value: 10, cells: [c(0.1, 0.09, 0.11), null, null, null] }]))).toEqual(["The bankroll readout appears when every cell has finished."]);
  });

  it("tone: no advice or 'winning' language", () => {
    const t = sweepReadout(input([{ field: "baseBet", value: 10, cells: [c(0.3, 0.28, 0.32), c(0.09, 0.08, 0.1), c(0.031, 0.025, 0.038), c(0.01, 0.007, 0.014)] }])).join(" ");
    for (const re of [/\bsafe bankroll\b/i, /\bguarantee/i, /\bwinn(er|ing)\b/i, /\byou should\b/i, /\brecommend/i, /\bbest\b/i]) expect(t, String(re)).not.toMatch(re);
  });
});

describe("readout lines from a grid", () => {
  const grid = { xValues: [5, 10], yValues: [100, 200, 300], cells: 6, sessionsPerCell: 1000 };
  const sweep: SweepConfig = { x: { field: "baseBet", start: 5, end: 10, steps: 2 }, y: { field: "startBankroll", start: 100, end: 300, steps: 3 }, strategyUid: "u", targetPct: 5 };

  it("bankroll on rows: one line per column, cells in ascending bankroll order", () => {
    expect(bankrollLines(sweep, grid)).toEqual([
      { field: "baseBet", value: 5, cells: [0, 2, 4] },
      { field: "baseBet", value: 10, cells: [1, 3, 5] },
    ]);
    const cells = [0, 1, 2, 3, 4, 5].map((k) => c(k / 10, k / 10, k / 10));
    const r = readoutInputOf(sweep, grid, cells);
    expect(r.bankrolls).toEqual([100, 200, 300]);
    expect(r.groups[1]!.cells.map((x) => x!.pBust)).toEqual([0.1, 0.3, 0.5]);
  });

  it("bankroll on columns: one line per row; no bankroll axis: none", () => {
    const across: SweepConfig = { ...sweep, x: sweep.y, y: sweep.x };
    expect(bankrollLines(across, { ...grid, xValues: [100, 200, 300], yValues: [5, 10] })).toEqual([
      { field: "baseBet", value: 5, cells: [0, 1, 2] },
      { field: "baseBet", value: 10, cells: [3, 4, 5] },
    ]);
    expect(bankrollLines({ ...sweep, y: { field: "maxRounds", start: 1, end: 3, steps: 3 } }, grid)).toBeNull();
  });
});
