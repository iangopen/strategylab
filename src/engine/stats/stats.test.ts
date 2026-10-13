import { describe, expect, it } from "vitest";
import { GAME_PRESETS } from "../games";
import { sessionSeed } from "../rng";
import { runSession } from "../runner";
import { flat } from "../strategies/flat";
import { evPerWageredWithSE, sessionConfig, testCtx } from "../testUtils";
import type { SessionResult } from "../types";
import { addSession, createAccumulator, sortedColumn } from "./accumulator";
import { evPerWageredSE, STATS } from "./registry";

function session(finalBankroll: number, totalWagered: number, rounds: number, endReason: SessionResult["endReason"]): SessionResult {
  return { finalBankroll, totalWagered, rounds, endReason, peak: 0, maxDrawdown: 0, longestLosingStreak: 0 };
}

function computeAll(results: SessionResult[], start: number) {
  const acc = createAccumulator(results.length, start);
  for (const r of results) addSession(acc, r);
  const ctx = testCtx(results.length, start);
  return { acc, values: Object.fromEntries(STATS.map((s) => [s.id, s.compute(acc, ctx)])) };
}

describe("accumulator columns", () => {
  it("stores finals, max drawdowns and longest streaks per session, in session order", () => {
    const acc = createAccumulator(3, 1000);
    addSession(acc, { ...session(900, 100, 1, "maxRounds"), maxDrawdown: 300, longestLosingStreak: 4 });
    addSession(acc, { ...session(1500, 100, 1, "stopWin"), maxDrawdown: 50, longestLosingStreak: 1 });
    expect(Array.from(acc.finals.subarray(0, acc.count))).toEqual([900, 1500]);
    expect(Array.from(acc.maxDrawdowns.subarray(0, acc.count))).toEqual([300, 50]);
    expect(Array.from(acc.longestStreaks.subarray(0, acc.count))).toEqual([4, 1]);
  });

  it("sorts each column once and reuses it; adding a session invalidates the cache", () => {
    const acc = createAccumulator(3, 1000);
    addSession(acc, session(900, 100, 1, "maxRounds"));
    addSession(acc, session(100, 100, 1, "maxRounds"));
    const s1 = sortedColumn(acc, "finals");
    expect(Array.from(s1)).toEqual([100, 900]);
    expect(sortedColumn(acc, "finals")).toBe(s1); // same object: sorted once
    expect(Array.from(acc.finals.subarray(0, 2))).toEqual([900, 100]); // original order untouched
    addSession(acc, session(500, 100, 1, "maxRounds"));
    expect(Array.from(sortedColumn(acc, "finals"))).toEqual([100, 500, 900]);
  });
});

describe("accumulator + registered stats", () => {
  it("computes every registered stat on a hand-built set of sessions", () => {
    const { acc, values } = computeAll(
      [session(1200, 1000, 10, "stopWin"), session(0, 3000, 30, "ruin"), session(900, 2000, 20, "maxRounds"), session(1100, 2000, 5, "maxRounds")],
      1000,
    );
    expect(acc.count).toBe(4);
    expect(Array.from(acc.finals)).toEqual([1200, 0, 900, 1100]);
    expect(values.meanFinal).toBe(800);
    expect(values.medianFinal).toBe(1000); // (900 + 1100) / 2
    expect(values.meanWagered).toBe(2000);
    expect(values.evPerWagered).toBe((800 - 1000) / 2000);
    expect(values.meanRounds).toBe(16.25);
    expect(values.end_stopWin).toBe(0.25);
    expect(values.end_ruin).toBe(0.25);
    expect(values.end_maxRounds).toBe(0.5);
    expect(values.end_stopLoss).toBe(0);
    expect(values.end_insufficientFunds).toBe(0);
    expect(values.end_strategyStop).toBe(0);
  });

  it("odd-count median and NaN when nothing was wagered", () => {
    const { values } = computeAll([session(5, 0, 0, "insufficientFunds"), session(1, 0, 0, "insufficientFunds"), session(3, 0, 0, "insufficientFunds")], 10);
    expect(values.medianFinal).toBe(3);
    expect(values.evPerWagered).toBeNaN();
  });

  it("has exactly one emphasized stat: EV per $ wagered", () => {
    expect(STATS.filter((s) => s.emphasis).map((s) => s.id)).toEqual(["evPerWagered"]);
    expect(new Set(STATS.map((s) => s.id)).size).toBe(STATS.length);
  });

  it("evPerWageredSE from running sums matches the SE computed from samples", () => {
    const game = GAME_PRESETS.find((g) => g.id === "european")!;
    const cfg = sessionConfig({ startBankroll: 10_000, baseBet: 100, stopWin: 15_000, stopLoss: 5_000, maxRounds: 500 });
    const results = Array.from({ length: 5000 }, (_, i) => runSession(game, flat, { units: 1 }, cfg, sessionSeed(9, i)));
    const { acc, values } = computeAll(results, cfg.startBankroll);
    const fromSamples = evPerWageredWithSE(results, cfg.startBankroll);
    expect(values.evPerWagered).toBeCloseTo(fromSamples.ev, 12);
    expect(evPerWageredSE(acc) / fromSamples.se).toBeCloseTo(1, 9);
  });
});

describe("session 3 stats on a hand-built accumulator", () => {
  // start = 1000 cents. Columns: final, wagered, rounds, endReason, maxDrawdown, longestLosingStreak.
  const rows: [number, number, number, SessionResult["endReason"], number, number][] = [
    [1200, 1000, 10, "stopWin", 100, 2],
    [0, 3000, 30, "ruin", 1000, 9],
    [900, 2000, 20, "maxRounds", 300, 4],
    [1000, 2000, 5, "insufficientFunds", 200, 3], // final === start: NOT a profit
    [1100, 2000, 15, "maxRounds", 0, 1],
  ];
  const results = rows.map(([f, w, r, e, dd, ls]) => ({ ...session(f, w, r, e), maxDrawdown: dd, longestLosingStreak: ls }));
  const acc = createAccumulator(results.length, 1000);
  for (const r of results) addSession(acc, r);
  const ctx = testCtx(results.length, 1000, { stopWin: 1200 });
  const v = Object.fromEntries(STATS.map((s) => [s.id, s.compute(acc, ctx)]));

  it("headline: EV, SE, theory, z", () => {
    expect(v.evPerWagered).toBe((840 - 1000) / 2000); // mean final 4200/5 = 840, mean wagered 2000
    const fromSamples = evPerWageredWithSE(results, 1000);
    expect(v.evSE).toBeCloseTo(fromSamples.se, 12);
    expect(v.evTheory).toBe(-ctx.edge);
    expect(v.evTheory).toBeCloseTo(-1 / 37, 15);
    expect(v.evZ).toBeCloseTo((v.evPerWagered! + 1 / 37) / fromSamples.se, 9);
  });

  it("risk: P(profit) is strict, P(bust) = ruin + insufficientFunds, P(hit win target)", () => {
    expect(v.pProfit).toBe(2 / 5); // 1200 and 1100 only; the session ending at exactly 1000 is not a profit
    expect(v.pBust).toBe(2 / 5);
    expect(v.pHitWin).toBe(1 / 5);
    const noTarget = STATS.find((s) => s.id === "pHitWin")!.compute(acc, testCtx(5, 1000, { stopWin: null }));
    expect(noTarget).toBeNaN(); // shown as a dash when the win target is off
  });

  it("risk: 95% Wilson intervals on P(profit) and P(bust), from the same counts as the point values", () => {
    // 2 of 5 for both; reference values computed independently from the Wilson formula.
    for (const id of ["pProfit", "pBust"]) {
      expect(v[`${id}Low`]).toBeCloseTo(0.117618, 5);
      expect(v[`${id}High`]).toBeCloseTo(0.76928, 5);
      expect(v[`${id}Low`]!).toBeLessThan(v[id]!);
      expect(v[`${id}High`]!).toBeGreaterThan(v[id]!);
    }
  });

  it("risk: rounds to bust counts busted sessions only (ruin at 30 rounds, couldn't cover at 5)", () => {
    expect(v.bustRoundsMedian).toBe(17.5); // [5, 30], h = 0.5
    expect(v.bustRoundsP10).toBeCloseTo(7.5, 12); // h = 0.1: 5 + 0.1 * 25
  });

  it("pain: P(max drawdown ≥ 50% of start) over drawdowns [100, 1000, 300, 200, 0]", () => {
    expect(v.pDrawdownHalf).toBe(1 / 5);
  });

  it("final bankroll percentiles are type 7 on the sorted finals [0, 900, 1000, 1100, 1200]", () => {
    expect(v.finalP5).toBeCloseTo(180, 9); // h = 0.2
    expect(v.finalP25).toBe(900); // h = 1
    expect(v.medianFinal).toBe(1000); // h = 2
    expect(v.finalP75).toBe(1100); // h = 3
    expect(v.finalP95).toBeCloseTo(1180, 9); // h = 3.8
    expect(v.meanFinal).toBe(840);
  });

  it("pain: drawdown [0, 100, 200, 300, 1000] and streaks [1, 2, 3, 4, 9]", () => {
    expect(v.meanMaxDrawdown).toBe(320);
    expect(v.p95MaxDrawdown).toBeCloseTo(860, 9); // h = 3.8: 300 + 0.8 * 700
    expect(v.meanLongestStreak).toBe(3.8);
    expect(v.maxLongestStreak).toBe(9);
  });

  it("volume and end reasons", () => {
    expect(v.meanWagered).toBe(2000);
    expect(v.meanRounds).toBe(16);
    expect([v.end_stopWin, v.end_ruin, v.end_maxRounds, v.end_insufficientFunds, v.end_stopLoss, v.end_strategyStop]).toEqual([0.2, 0.2, 0.4, 0.2, 0, 0]);
  });

  it("z is NaN (a dash) when the SE is 0", () => {
    const flatAcc = createAccumulator(2, 1000);
    addSession(flatAcc, session(900, 100, 1, "maxRounds"));
    addSession(flatAcc, session(900, 100, 1, "maxRounds"));
    expect(STATS.find((s) => s.id === "evZ")!.compute(flatAcc, testCtx(2, 1000))).toBeNaN();
  });
});

describe("rounds to bust: busted sessions only", () => {
  const stat = (id: string) => STATS.find((s) => s.id === id)!;
  const build = (rows: [number, SessionResult["endReason"]][]) => {
    const acc = createAccumulator(rows.length, 1000);
    for (const [rounds, end] of rows) addSession(acc, session(500, 100, rounds, end));
    return acc;
  };

  it("excludes stopWin and maxRounds sessions: busts [5, 12, 30] give median 12 and p10 6.4", () => {
    // Over ALL five sessions ([5, 12, 30, 50, 1000]) the answers would be 30 and 7.8 instead.
    const acc = build([[30, "ruin"], [50, "stopWin"], [5, "insufficientFunds"], [1000, "maxRounds"], [12, "insufficientFunds"]]);
    const ctx = testCtx(5, 1000);
    expect(stat("bustRoundsMedian").compute(acc, ctx)).toBe(12);
    expect(stat("bustRoundsP10").compute(acc, ctx)).toBeCloseTo(6.4, 12);
  });

  it("the column holds rounds for busted sessions and NaN otherwise; sorting puts the NaNs last", () => {
    const acc = build([[30, "ruin"], [50, "stopWin"], [5, "insufficientFunds"]]);
    expect(Array.from(acc.bustRounds.subarray(0, 3))).toEqual([30, NaN, 5]);
    expect(Array.from(sortedColumn(acc, "bustRounds"))).toEqual([5, 30, NaN]);
  });

  it("NaN (a dash) when no session busted, including strategyStop and stopLoss endings", () => {
    const acc = build([[10, "stopWin"], [0, "strategyStop"], [7, "stopLoss"]]);
    expect(stat("bustRoundsMedian").compute(acc, testCtx(3, 1000))).toBeNaN();
    expect(stat("bustRoundsP10").compute(acc, testCtx(3, 1000))).toBeNaN();
  });
});

describe("P(max drawdown ≥ 50% of start): the boundary counts", () => {
  const stat = STATS.find((s) => s.id === "pDrawdownHalf")!;
  const withDrawdowns = (dds: number[]) => {
    const acc = createAccumulator(dds.length, 1000);
    for (const dd of dds) addSession(acc, { ...session(500, 100, 1, "maxRounds"), maxDrawdown: dd });
    return stat.compute(acc, testCtx(dds.length, 1000));
  };
  it("exactly 50% counts, just under does not, just over does", () => {
    expect(withDrawdowns([500])).toBe(1);
    expect(withDrawdowns([499])).toBe(0);
    expect(withDrawdowns([501])).toBe(1);
    expect(withDrawdowns([499, 500, 501, 1000, 0])).toBe(3 / 5);
  });
  it("odd starting bankroll: 50% of 1001 is 500.5, so 500 does not count and 501 does", () => {
    const acc = createAccumulator(2, 1001);
    addSession(acc, { ...session(500, 100, 1, "maxRounds"), maxDrawdown: 500 });
    addSession(acc, { ...session(500, 100, 1, "maxRounds"), maxDrawdown: 501 });
    expect(stat.compute(acc, testCtx(2, 1001))).toBe(1 / 2);
  });
});

describe("registry row order", () => {
  it("renders in the specified order, with P(profit > 0) directly under the headline block", () => {
    expect(STATS.map((s) => s.id)).toEqual([
      "evPerWagered", "evSE", "evTheory", "evZ",
      "pProfit", "pProfitLow", "pProfitHigh",
      "pBust", "pBustLow", "pBustHigh", "bustRoundsMedian", "bustRoundsP10",
      "pHitWin",
      "finalP5", "finalP25", "medianFinal", "finalP75", "finalP95", "meanFinal",
      "meanMaxDrawdown", "p95MaxDrawdown", "pDrawdownHalf", "meanLongestStreak", "maxLongestStreak",
      "meanWagered", "meanRounds",
      "end_ruin", "end_insufficientFunds", "end_stopWin", "end_stopLoss", "end_maxRounds", "end_strategyStop",
    ]);
  });
});
