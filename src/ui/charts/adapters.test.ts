import { describe, expect, it } from "vitest";
import { GAME_PRESETS } from "../../engine/games";
import { runMonteCarlo, type MonteCarloResult, type StrategyOutcome } from "../../engine/montecarlo";
import { STRATEGIES } from "../../engine/strategies/registry";
import { sessionConfig } from "../../engine/testUtils";
import {
  fanScales,
  fanSeries,
  histogramPercents,
  histogramScales,
  logSafe,
  logTicks,
  nearestPath,
  niceCeil,
  niceTicks,
  referenceLines,
  seriesColorVar,
} from "./adapters";

/** Minimal hand-built result: only the fields the adapters read. */
function fakeResult(parts: { p95: number[]; paths: number[][]; counts: number[] }[], rounds: number[], edges: number[]): MonteCarloResult {
  const f = (a: number[]) => Float64Array.from(a);
  return {
    nSessions: 0,
    masterSeed: 0,
    histogram: { edges: f(edges) },
    bands: { rounds: f(rounds), sessions: 0 },
    perStrategy: parts.map(
      (p): StrategyOutcome => ({
        strategyId: "x",
        stats: {},
        endReasonCounts: { ruin: 0, insufficientFunds: 0, stopWin: 0, stopLoss: 0, maxRounds: 0, strategyStop: 0 },
        samplePaths: p.paths.map((b) => ({ rounds: b.map((_, i) => i), bankroll: b })),
        histogramCounts: Uint32Array.from(p.counts),
        bands: { p5: f(p.p95.map(() => 0)), p25: f(p.p95.map(() => 0)), p50: f(p.p95.map(() => 0)), p75: f(p.p95.map(() => 0)), p95: f(p.p95) },
      }),
    ),
  };
}

describe("nice numbers and ticks", () => {
  it("niceCeil rounds up to 1, 2, 2.5, 5 × 10^k", () => {
    expect([0, 0.9, 1, 1.01, 2.2, 3, 7, 11, 240, 260, 100_001].map(niceCeil)).toEqual([0, 1, 1, 2, 2.5, 5, 10, 20, 250, 500, 200_000]);
  });

  it("niceTicks covers the range with round steps", () => {
    expect(niceTicks(0, 1000, 5)).toEqual([0, 200, 400, 600, 800, 1000]);
    expect(niceTicks(0, 110_000, 4)).toEqual([0, 50_000, 100_000]);
    expect(niceTicks(5, 5)).toEqual([5]);
  });

  it("logTicks lists powers of ten inside a positive range", () => {
    expect(logTicks(0.01, 100)).toEqual([0.01, 0.1, 1, 10, 100]);
  });
});

describe("fan scales are SHARED across all strategies and start at 0", () => {
  it("y max covers every strategy's p95 and sample paths, the start and the win target; x = 0..maxRounds", () => {
    const r = fakeResult(
      [
        { p95: [1000, 1200], paths: [[1000, 1100]], counts: [1] },
        { p95: [1000, 900], paths: [[1000, 4300]], counts: [1] }, // the tallest point is another strategy's path
      ],
      [0, 500],
      [0, 1],
    );
    const s = fanScales(r, { start: 1000, stopWin: 1100, stopLoss: null });
    expect(s.x).toEqual({ min: 0, max: 500 });
    expect(s.y.min).toBe(0);
    expect(s.y.max).toBe(5000); // niceCeil(4300 × 1.02)
    // The win target alone can set the top.
    expect(fanScales(r, { start: 1000, stopWin: 9000, stopLoss: null }).y.max).toBe(10_000);
  });

  it("on a real run, every panel's data fits the one shared range", () => {
    const european = GAME_PRESETS.find((g) => g.id === "european")!;
    const cfg = sessionConfig({ startBankroll: 100_000, baseBet: 1_000, stopWin: 110_000, maxRounds: 1000 });
    const specs = STRATEGIES.map((strategy) => ({ strategy, config: { ...strategy.defaultConfig } }));
    const r = runMonteCarlo(european, specs, cfg, 3000, 12345);
    const s = fanScales(r, { start: cfg.startBankroll, stopWin: cfg.stopWin, stopLoss: null });
    expect(s.y.min).toBe(0);
    expect(s.x.max).toBe(1000);
    let globalMax = 0;
    for (const o of r.perStrategy) {
      const f = fanSeries(o, r.bands.rounds);
      for (const p of f.paths) for (let i = 0; i < p.y.length; i++) globalMax = Math.max(globalMax, p.y[i]!);
      for (let i = 0; i < f.outer.hi.length; i++) globalMax = Math.max(globalMax, f.outer.hi[i]!);
    }
    expect(globalMax).toBeLessThanOrEqual(s.y.max);
    expect(s.y.max).toBeLessThanOrEqual(niceCeil(globalMax * 1.02)); // not padded beyond one nice step
  });
});

describe("fanSeries and reference lines", () => {
  it("bands start at round 0 at one point, and sample paths map 1:1 to sessions", () => {
    const european = GAME_PRESETS.find((g) => g.id === "european")!;
    const r = runMonteCarlo(european, [{ strategy: STRATEGIES[1]!, config: { multiplier: 2 } }], sessionConfig({ startBankroll: 100_000, baseBet: 1000 }), 200, 1);
    const f = fanSeries(r.perStrategy[0]!, r.bands.rounds);
    expect(f.outer.x[0]).toBe(0);
    expect([f.outer.lo[0], f.outer.hi[0], f.inner.lo[0], f.inner.hi[0], f.median.y[0]]).toEqual([100_000, 100_000, 100_000, 100_000, 100_000]);
    expect(f.paths).toHaveLength(50);
    expect(f.paths[7]!.y).toBe(r.perStrategy[0]!.samplePaths[7]!.bankroll);
  });

  it("start always; win target and floor only when set", () => {
    expect(referenceLines({ start: 1000, stopWin: null, stopLoss: null }).map((l) => l.kind)).toEqual(["start"]);
    expect(referenceLines({ start: 1000, stopWin: 1100, stopLoss: 500 })).toEqual([
      { kind: "start", label: "Start", value: 1000 },
      { kind: "winTarget", label: "Win target", value: 1100 },
      { kind: "floor", label: "Loss floor", value: 500 },
    ]);
  });
});

describe("histogram", () => {
  const r = fakeResult(
    [
      { p95: [0], paths: [], counts: [1, 0, 3] }, // 25%, 0%, 75%
      { p95: [0], paths: [], counts: [0, 0, 8] }, // 0%, 0%, 100%
      { p95: [0], paths: [], counts: [199, 1, 0] }, // 99.5%, 0.5%, 0%
    ],
    [0],
    [0, 100, 200, 300],
  );

  it("% of sessions sums to 100 per strategy", () => {
    const pcts = histogramPercents(r);
    expect(Array.from(pcts[0]!)).toEqual([25, 0, 75]);
    for (const p of pcts) expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 10);
  });

  it("linear: y is shared, starts at 0, and tops every strategy's tallest bin; x = shared bin edges", () => {
    const s = histogramScales(r, histogramPercents(r), "linear");
    expect(s.y).toEqual({ min: 0, max: 100 });
    expect(s.x).toEqual({ min: 0, max: 300 });
  });

  it("log: zero-count bins become gaps (never log 0); axis spans the smallest nonzero to the largest bin", () => {
    const pcts = histogramPercents(r);
    expect(logSafe(pcts[0]!)).toEqual([25, null, 75]);
    const s = histogramScales(r, pcts, "log");
    expect(s.y).toEqual({ min: 0.1, max: 100 }); // smallest nonzero 0.5% -> 0.1
    for (const p of pcts) for (const v of logSafe(p)) if (v !== null) expect(Math.log10(v)).toBeGreaterThanOrEqual(Math.log10(s.y.min));
  });

  it("on a real run, the % arrays use the run's shared bins", () => {
    const european = GAME_PRESETS.find((g) => g.id === "european")!;
    const specs = STRATEGIES.slice(0, 2).map((strategy) => ({ strategy, config: { ...strategy.defaultConfig } }));
    const run = runMonteCarlo(european, specs, sessionConfig({ startBankroll: 100_000, baseBet: 1000, stopWin: 110_000 }), 2000, 3);
    const pcts = histogramPercents(run);
    for (const p of pcts) {
      expect(p).toHaveLength(run.histogram.edges.length - 1);
      expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 9);
    }
  });
});

describe("nearestPath (click to pick a session)", () => {
  const paths = [
    { x: [0, 10], y: [0, 0] },
    { x: [0, 10], y: [5, 5] },
  ];
  const toPx = (x: number, y: number): [number, number] => [x * 10, 100 - y * 10];
  it("picks the closest path within tolerance, in pixels", () => {
    expect(nearestPath(paths, 50, 99, toPx)).toBe(0);
    expect(nearestPath(paths, 50, 52, toPx)).toBe(1);
    expect(nearestPath(paths, 50, 75, toPx)).toBeNull(); // 25 px from both
  });
});

describe("colors", () => {
  it("one CSS variable per instance index, cycling through the palette", () => {
    expect([0, 1, 7, 8].map(seriesColorVar)).toEqual(["--series-0", "--series-1", "--series-7", "--series-0"]);
  });
});
