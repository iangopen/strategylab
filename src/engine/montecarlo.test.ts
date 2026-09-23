import { describe, expect, it } from "vitest";
import { GAME_PRESETS } from "./games";
import { MAX_PATH_POINTS, runMonteCarlo, SAMPLE_PATH_COUNT } from "./montecarlo";
import { STATS } from "./stats/registry";
import type { StatDef } from "./stats/types";
import { flat } from "./strategies/flat";
import { sessionConfig } from "./testUtils";

const european = GAME_PRESETS.find((g) => g.id === "european")!;
const cfg = sessionConfig({ startBankroll: 5000, baseBet: 100, stopWin: 7000, maxRounds: 300 });

describe("runMonteCarlo", () => {
  it("determinism (test 1): same masterSeed gives bit-identical results", () => {
    const specs = [{ strategy: flat, config: { units: 1 } }, { strategy: flat, config: { units: 3 } }];
    const a = runMonteCarlo(european, specs, cfg, 2000, 777);
    const b = runMonteCarlo(european, specs, cfg, 2000, 777);
    const c = runMonteCarlo(european, specs, cfg, 2000, 778);
    expect(b).toEqual(a);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(c.perStrategy[0]!.stats).not.toEqual(a.perStrategy[0]!.stats);
  });

  it("CRN: two identical strategy instances produce identical outcomes", () => {
    const r = runMonteCarlo(european, [{ strategy: flat, config: { units: 1 } }, { strategy: flat, config: { units: 1 } }], cfg, 1000, 5);
    expect(r.perStrategy[1]).toEqual(r.perStrategy[0]);
  });

  it("returns every registered stat, raw endReason counts, and 50 sample paths", () => {
    const r = runMonteCarlo(european, [{ strategy: flat, config: { units: 1 } }], cfg, 500, 1);
    const out = r.perStrategy[0]!;
    expect(Object.keys(out.stats)).toEqual(STATS.map((s) => s.id));
    expect(Object.values(out.endReasonCounts).reduce((x, y) => x + y, 0)).toBe(500);
    expect(out.samplePaths).toHaveLength(SAMPLE_PATH_COUNT);
  });

  it("reports progress about every 2%, ending at 1", () => {
    const seen: number[] = [];
    runMonteCarlo(european, [{ strategy: flat, config: { units: 1 } }], cfg, 1000, 1, (f) => seen.push(f));
    expect(seen.length).toBeGreaterThanOrEqual(50);
    expect(seen.length).toBeLessThanOrEqual(51);
    expect(seen[seen.length - 1]).toBe(1);
    for (let k = 1; k < seen.length; k++) expect(seen[k]!).toBeGreaterThan(seen[k - 1]!);
  });

  it("rejects bad inputs", () => {
    const specs = [{ strategy: flat, config: { units: 1 } }];
    expect(() => runMonteCarlo(european, specs, cfg, 0, 1)).toThrow();
    expect(() => runMonteCarlo(european, specs, cfg, 1_000_001, 1)).toThrow();
    expect(() => runMonteCarlo(european, specs, cfg, 10, -1)).toThrow();
    expect(() => runMonteCarlo(european, [], cfg, 10, 1)).toThrow();
    expect(() => runMonteCarlo(european, [{ strategy: flat, config: { units: -1 } }], cfg, 10, 1)).toThrow();
  });

  it("stats plug-in (test 5): a throwaway StatDef appears in the output with no other code changes", () => {
    const throwaway: StatDef = { id: "throwaway", label: "Sessions counted", format: "int", compute: (acc, ctx) => acc.count + 1000 * ctx.nSessions };
    const r = runMonteCarlo(european, [{ strategy: flat, config: { units: 1 } }], cfg, 321, 1, undefined, { stats: [...STATS, throwaway] });
    expect(r.perStrategy[0]!.stats.throwaway).toBe(321 + 1000 * 321); // uses both acc and ctx
    expect(r.perStrategy[0]!.stats.evPerWagered).toBeDefined();
  });

  it(
    "memory (test 6): 100k sessions × 1000 rounds keeps only the 50 sample paths",
    { timeout: 180_000 }, // explicit: the run is NOT shrunk to fit the default timeout
    () => {
      const proc = (globalThis as { process?: { memoryUsage(): { heapUsed: number } } }).process;
      const heapBefore = proc?.memoryUsage().heapUsed ?? 0;
      const big = sessionConfig({ startBankroll: 10_000_000, baseBet: 100, maxRounds: 1000 });
      const t0 = performance.now();
      const r = runMonteCarlo(european, [{ strategy: flat, config: { units: 1 } }], big, 100_000, 2024);
      const seconds = (performance.now() - t0) / 1000;
      const heapAfter = proc?.memoryUsage().heapUsed ?? 0;
      const out = r.perStrategy[0]!;
      const retainedPoints = out.samplePaths.reduce((s, p) => s + p.bankroll.length, 0);
      console.log(
        `[test 6] 100,000 × 1000 rounds in ${seconds.toFixed(1)}s; heap delta ${((heapAfter - heapBefore) / 1e6).toFixed(1)} MB; ` +
          `retained path points ${retainedPoints}`,
      );
      expect(out.endReasonCounts.maxRounds).toBe(100_000);
      expect(out.stats.meanRounds).toBe(1000);
      expect(out.samplePaths).toHaveLength(SAMPLE_PATH_COUNT);
      for (const p of out.samplePaths) expect(p.bankroll.length).toBeLessThanOrEqual(MAX_PATH_POINTS + 1);
      // Full paths for every session would be 100k × 1001 numbers (>= 800 MB).
      expect(retainedPoints).toBeLessThanOrEqual(SAMPLE_PATH_COUNT * (MAX_PATH_POINTS + 1));
      if (proc) expect(heapAfter - heapBefore).toBeLessThan(400e6);
    },
  );
});
