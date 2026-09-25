import { describe, expect, it } from "vitest";
import { GAME_PRESETS } from "../games";
import { runMonteCarlo } from "../montecarlo";
import { STRATEGIES } from "../strategies/registry";
import { INVARIANT_SCENARIO } from "../testUtils";
import { sortedColumn } from "./accumulator";
import { HISTOGRAM_BINS, sharedHistogram } from "./histogram";
import { STATS } from "./registry";
import type { StatDef } from "./types";

const col = (xs: number[]) => ({ values: Float64Array.from(xs), count: xs.length });

describe("sharedHistogram", () => {
  it("one set of edges over [min, max] across ALL columns; max lands in the last bin", () => {
    const h = sharedHistogram([col([0, 10, 20]), col([50, 100])], 10);
    expect(Array.from(h.edges)).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    expect(Array.from(h.counts[0]!)).toEqual([1, 1, 1, 0, 0, 0, 0, 0, 0, 0]);
    expect(Array.from(h.counts[1]!)).toEqual([0, 0, 0, 0, 0, 1, 0, 0, 0, 1]); // 100 = max -> last bin
  });

  it("uses only the first `count` values of each column", () => {
    const h = sharedHistogram([{ values: Float64Array.from([1, 2, 999]), count: 2 }], 1);
    expect(Array.from(h.edges)).toEqual([1, 2]);
    expect(Array.from(h.counts[0]!)).toEqual([2]);
  });

  it("identical values: range widened by 1 cent each side, all counts in one bin", () => {
    const h = sharedHistogram([col([500, 500, 500])], 50);
    expect(h.edges[0]).toBe(499);
    expect(h.edges[50]).toBe(501);
    expect(h.counts[0]!.reduce((a, b) => a + b, 0)).toBe(3);
    expect(h.counts[0]![25]).toBe(3);
  });
});

describe("histogram in runMonteCarlo", () => {
  it("50 shared bins; counts sum to nSessions per strategy; the overall max is in the last bin", () => {
    const european = GAME_PRESETS.find((g) => g.id === "european")!;
    const specs = STRATEGIES.map((strategy) => ({ strategy, config: { ...strategy.defaultConfig } }));
    const n = 3000;
    // Throwaway plug-in stats expose each strategy's exact min and max final bankroll.
    const minF: StatDef = { id: "minFinal", label: "min", format: "money", compute: (a) => sortedColumn(a, "finals")[0]! };
    const maxF: StatDef = { id: "maxFinal", label: "max", format: "money", compute: (a) => sortedColumn(a, "finals")[a.count - 1]! };
    const r = runMonteCarlo(european, specs, INVARIANT_SCENARIO, n, 99, undefined, { stats: [...STATS, minF, maxF] });
    const { edges } = r.histogram;
    expect(edges).toHaveLength(HISTOGRAM_BINS + 1);
    for (let i = 1; i < edges.length; i++) expect(edges[i]!).toBeGreaterThan(edges[i - 1]!);
    const globalMin = Math.min(...r.perStrategy.map((s) => s.stats.minFinal!));
    const globalMax = Math.max(...r.perStrategy.map((s) => s.stats.maxFinal!));
    expect(edges[0]).toBe(globalMin);
    expect(edges[HISTOGRAM_BINS]).toBe(globalMax);
    for (const s of r.perStrategy) {
      expect(s.histogramCounts).toHaveLength(HISTOGRAM_BINS);
      expect(s.histogramCounts.reduce((a, b) => a + b, 0)).toBe(n);
      if (s.stats.maxFinal === globalMax) expect(s.histogramCounts[HISTOGRAM_BINS - 1]).toBeGreaterThan(0);
      if (s.stats.minFinal === globalMin) expect(s.histogramCounts[0]).toBeGreaterThan(0);
    }
  });
});
