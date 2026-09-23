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

describe("registry row order", () => {
  it("renders in the specified order, with P(profit > 0) directly under the headline block", () => {
    expect(STATS.map((s) => s.id)).toEqual([
      "evPerWagered", "evSE", "evTheory", "evZ",
      "pProfit", "pBust", "pHitWin",
      "finalP5", "finalP25", "medianFinal", "finalP75", "finalP95", "meanFinal",
      "meanMaxDrawdown", "p95MaxDrawdown", "meanLongestStreak", "maxLongestStreak",
      "meanWagered", "meanRounds",
      "end_ruin", "end_insufficientFunds", "end_stopWin", "end_stopLoss", "end_maxRounds", "end_strategyStop",
    ]);
  });
});
