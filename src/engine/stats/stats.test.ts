import { describe, expect, it } from "vitest";
import { GAME_PRESETS } from "../games";
import { sessionSeed } from "../rng";
import { runSession } from "../runner";
import { flat } from "../strategies/flat";
import { evPerWageredWithSE, sessionConfig } from "../testUtils";
import type { SessionResult } from "../types";
import { addSession, createAccumulator } from "./accumulator";
import { evPerWageredSE, STATS } from "./registry";

function session(finalBankroll: number, totalWagered: number, rounds: number, endReason: SessionResult["endReason"]): SessionResult {
  return { finalBankroll, totalWagered, rounds, endReason, peak: 0, maxDrawdown: 0, longestLosingStreak: 0 };
}

function computeAll(results: SessionResult[], start: number) {
  const acc = createAccumulator(results.length, start);
  for (const r of results) addSession(acc, r);
  return { acc, values: Object.fromEntries(STATS.map((s) => [s.id, s.compute(acc)])) };
}

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
