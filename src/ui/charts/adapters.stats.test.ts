import { describe, expect, it } from "vitest";
import { checkpointRounds, DENSE_ROUNDS } from "../../engine/checkpoints";
import { GAME_PRESETS } from "../../engine/games";
import { runMonteCarlo, type MonteCarloResult, type StrategyOutcome } from "../../engine/montecarlo";
import { replaySession } from "../../engine/replay";
import { STRATEGIES } from "../../engine/strategies/registry";
import { sessionConfig } from "../../engine/testUtils";
import {
  fanScales,
  fanSeries,
  histogramPercents,
  histogramScales,
  logSafe,
  logTicks,
  moneyTick,
  countTick,
  endText,
  firstEndingRound,
  nearestIndex,
  replayLayout,
  stripCells,
  zoomFromDrag,
  pctTick,
  nearestPath,
  niceCeil,
  niceTicks,
  referenceLines,
  seriesColorVar,
  placeLabels,
  LABEL_PAD,
  activeRangeEnd,
  zoomedFanScales,
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

describe("tick labels", () => {
  it("money from cents, counts and percents", () => {
    expect([0, 95_000, 110_000, 1_200_000, 150_000_000].map(moneyTick)).toEqual(["$0", "$950", "$1,100", "$12k", "$1.5M"]);
    expect([0, 950, 1000, 25_000, 1_000_000].map(countTick)).toEqual(["0", "950", "1,000", "25k", "1M"]);
    expect([0.1, 0.5, 10, 12.5].map(pctTick)).toEqual(["0.1%", "0.5%", "10%", "12.5%"]);
  });
});

describe("colors", () => {
  it("one CSS variable per instance index, cycling through the palette", () => {
    expect([0, 1, 7, 8].map(seriesColorVar)).toEqual(["--series-0", "--series-1", "--series-7", "--series-0"]);
  });
});

describe("replay layout", () => {
  const european = GAME_PRESETS.find((g) => g.id === "european")!;
  const specs = STRATEGIES.map((strategy) => ({ strategy, config: { ...strategy.defaultConfig } }));

  it("one x range for all stacked strips (0..longest strategy); y ranges start at 0 and cover every strategy", () => {
    const cfg = sessionConfig({ startBankroll: 100_000, baseBet: 1_000, stopWin: 110_000, maxRounds: 1000 });
    const rep = replaySession(european, specs, cfg, 12345, 4);
    const l = replayLayout(rep, { start: cfg.startBankroll, stopWin: cfg.stopWin, stopLoss: null });
    const longest = Math.max(...rep.strategies.map((s) => s.rounds));
    expect(l.x).toEqual({ min: 0, max: longest });
    expect(l.bankrollY.min).toBe(0);
    expect(l.betY.min).toBe(0);
    expect(l.bankrollY.max).toBeGreaterThanOrEqual(110_000);
    for (const s of rep.strategies) {
      for (const v of s.bankroll.bankroll) expect(v).toBeLessThanOrEqual(l.bankrollY.max);
      for (const v of s.bets.bankroll) expect(v).toBeLessThanOrEqual(l.betY.max);
    }
    // Bets are steps: each bet holds over one round.
    const b0 = l.bets[0]!;
    expect([b0.x[0], b0.x[1]]).toEqual([0, 1]);
    expect(b0.y[0]).toBe(b0.y[1]);
    // Per-round strip spans exactly the longest strategy.
    const cells = stripCells(rep);
    expect(cells).toHaveLength(longest);
    expect(cells[cells.length - 1]!.x1).toBe(longest);
    expect(cells.every((c) => c.winRate === 0 || c.winRate === 1)).toBe(true);
  });

  it("bucketed strip (> 5,000 rounds) shades each bucket by its win rate and spans the longest strategy", () => {
    const cfg = sessionConfig({ startBankroll: 1_000_000, baseBet: 1_000, tableMin: 100, maxRounds: 20_000 });
    const rep = replaySession(european, specs, cfg, 777, 0);
    const cells = stripCells(rep);
    const longest = Math.max(...rep.strategies.map((s) => s.rounds));
    expect(cells.length).toBeLessThanOrEqual(500);
    expect(cells[cells.length - 1]!.x1).toBe(longest);
    for (const c of cells) expect(c.winRate >= 0 && c.winRate <= 1).toBe(true);
    const mean = cells.reduce((s, c) => s + c.winRate * (c.x1 - c.x0), 0) / longest;
    // The strip's overall win rate is within 4 SE of 18/37 (SE from the number of rounds shown).
    const p = european.winProb;
    const se = Math.sqrt((p * (1 - p)) / longest);
    console.log(`[strip] ${longest} rounds, win rate ${mean.toFixed(4)} vs ${p.toFixed(4)}, SE ${se.toFixed(4)}, z ${((mean - p) / se).toFixed(2)}`);
    expect(Math.abs(mean - p)).toBeLessThan(4 * se);
  });

  it("endText reads naturally", () => {
    expect(endText("insufficientFunds", 37)).toBe("couldn't cover the next bet after 37 rounds");
    expect(endText("stopWin", 1)).toBe("reached the win target after 1 round");
  });
});

describe("nearestIndex (hover snapping)", () => {
  it("snaps to the closest ascending value, ties to the lower index, clamps at the ends", () => {
    const xs = [0, 10, 20, 40];
    expect(nearestIndex(xs, 4)).toBe(0);
    expect(nearestIndex(xs, 6)).toBe(1);
    expect(nearestIndex(xs, 15)).toBe(1); // tie 10/20 -> lower
    expect(nearestIndex(xs, 16)).toBe(2);
    expect(nearestIndex(xs, -5)).toBe(0);
    expect(nearestIndex(xs, 100)).toBe(3);
    expect(nearestIndex(xs, 20)).toBe(2); // exact hit
    expect(nearestIndex([5], 999)).toBe(0);
    expect(nearestIndex([], 3)).toBe(-1);
  });
});

describe("replay zoom (pure)", () => {
  const rep = (rounds: number[]) => ({ strategies: rounds.map((r) => ({ rounds: r })) }) as unknown as Parameters<typeof firstEndingRound>[0];

  it("firstEndingRound is the earliest strategy end, at least 1", () => {
    expect(firstEndingRound(rep([11, 1000, 37]))).toBe(11);
    expect(firstEndingRound(rep([1000]))).toBe(1000);
    expect(firstEndingRound(rep([0, 5]))).toBe(1); // a strategy that never bet does not zoom to 0
  });

  it("zoomFromDrag orders and clamps the drag, and rejects a too-small span (a click)", () => {
    const full = { min: 0, max: 1000 };
    expect(zoomFromDrag(100, 300, full)).toEqual({ min: 100, max: 300 });
    expect(zoomFromDrag(300, 100, full)).toEqual({ min: 100, max: 300 }); // reversed drag
    expect(zoomFromDrag(-50, 2000, full)).toEqual({ min: 0, max: 1000 }); // clamped to full
    expect(zoomFromDrag(100, 100.5, full)).toBeNull(); // span < 2 rounds
  });
});

describe("placeLabels (reference labels never overlap, never leave the plot)", () => {
  const plot = { left: 58, width: 300, top: 10, height: 186 };
  const req = (label: string, lineY: number, align: "left" | "right", width = 40) => ({ label, lineY, align, width, height: 10 });
  const overlap = (a: { x0: number; x1: number; y0: number; y1: number }, b: typeof a) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

  it("the default spot is just above the line, at its end; left and right labels on the same line both stay above", () => {
    const [start, target] = placeLabels([req("Start", 100, "left"), req("Win target", 100, "right")], plot);
    expect(start!.moved).toBe(false);
    expect(target!.moved).toBe(false);
    expect(start!.y1).toBeLessThanOrEqual(100);
    expect(start!.x0).toBe(plot.left + 2);
    expect(target!.x1).toBe(plot.left + plot.width - 2);
  });

  it("two labels at the same end on nearby lines: the second moves (below its line) instead of overlapping", () => {
    const [a, b] = placeLabels([req("Win target", 100, "right"), req("Loss floor", 103, "right")], plot);
    expect(a!.moved).toBe(false);
    expect(b!.moved).toBe(true);
    expect(overlap(a!, b!)).toBe(false);
  });

  it("a line at the very top of the plot puts its label below the line, inside the plot", () => {
    const [a] = placeLabels([req("Win target", plot.top + 3, "right")], plot);
    expect(a!.moved).toBe(true);
    expect(a!.y0).toBeGreaterThanOrEqual(plot.top);
    expect(a!.y0).toBeGreaterThan(plot.top + 3);
  });

  it("property: 2,000 random sets of up to 5 labels never overlap and stay inside the plot", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
    for (let t = 0; t < 2000; t++) {
      const n = 1 + Math.floor(rnd() * 5);
      const reqs = Array.from({ length: n }, (_, i) => req(`L${i}`, plot.top + rnd() * plot.height, rnd() < 0.5 ? "left" : "right", 20 + rnd() * 60));
      const placed = placeLabels(reqs, plot);
      for (const p of placed) {
        expect(p.y0).toBeGreaterThanOrEqual(plot.top);
        expect(p.y1).toBeLessThanOrEqual(plot.top + plot.height);
      }
      for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) expect(overlap(placed[i]!, placed[j]!), JSON.stringify(reqs)).toBe(false);
    }
  });

  it("the knockout box pads the text on every side", () => {
    const [a] = placeLabels([req("Start", 100, "left", 30)], plot);
    expect(a!.x1 - a!.x0).toBe(30 + 2 * LABEL_PAD);
    expect(a!.y1 - a!.y0).toBe(10 + 2 * LABEL_PAD);
  });
});

describe("fan zoom (pure): active range and the shared window", () => {
  const rounds = Float64Array.from([0, 5, 10, 15, 20, 25, 30]);
  /** p5..p95 all following `vals` unless overridden. */
  const bands = (vals: number[], p95?: number[]) => {
    const f = (a: number[]) => Float64Array.from(a);
    return { p5: f(vals), p25: f(vals), p50: f(vals), p75: f(vals), p95: f(p95 ?? vals) };
  };

  it("bands that stop changing at checkpoint k give checkpoint k+1", () => {
    // Last change is at index 3 (15 rounds): 1000 -> 990 -> 1010 -> 980, then flat.
    expect(activeRangeEnd(bands([1000, 990, 1010, 980, 980, 980, 980]), rounds)).toBe(rounds[4]); // 20
    // Last change at index 1: end at index 2.
    expect(activeRangeEnd(bands([1000, 900, 900, 900, 900, 900, 900]), rounds)).toBe(rounds[2]);
  });

  it("bands that never stop changing give the full range; bands that never change give the first checkpoint", () => {
    expect(activeRangeEnd(bands([1, 2, 3, 4, 5, 6, 7]), rounds)).toBe(30);
    expect(activeRangeEnd(bands([1, 2, 3, 4, 5, 6, 6]), rounds)).toBe(30); // last change at index 5 -> 5+1 = last
    expect(activeRangeEnd(bands([1000, 1000, 1000, 1000, 1000, 1000, 1000]), rounds)).toBe(5);
  });

  it("any ONE percentile still changing keeps the range open (here only p95 moves late)", () => {
    expect(activeRangeEnd(bands([1000, 990, 990, 990, 990, 990, 990], [1000, 1020, 1020, 1020, 1040, 1040, 1040]), rounds)).toBe(rounds[5]);
  });

  it("zoomedFanScales: one x window for every panel, clamped to the full range; y NEVER changes", () => {
    const scales = { x: { min: 0, max: 1000 }, y: { min: 0, max: 200_000 } };
    expect(zoomedFanScales(scales, null)).toBe(scales);
    const z = zoomedFanScales(scales, { min: 100, max: 300 });
    expect(z).toEqual({ x: { min: 100, max: 300 }, y: scales.y });
    expect(z.y).toBe(scales.y); // the very same global y object
    expect(zoomedFanScales(scales, { min: -50, max: 5000 })).toEqual(scales);
    for (const w of [{ min: 0, max: 30 }, { min: 990, max: 1000 }, { min: 400, max: 401 }]) expect(zoomedFanScales(scales, w).y).toBe(scales.y);
  });

  it("on a real default-scenario run: Martingale's active range is short, Flat's is the full 1,000 rounds", () => {
    const european = GAME_PRESETS.find((g) => g.id === "european")!;
    const specs = STRATEGIES.slice(0, 2).map((strategy) => ({ strategy, config: { ...strategy.defaultConfig } })); // flat, martingale
    const r = runMonteCarlo(european, specs, sessionConfig({ startBankroll: 100_000, baseBet: 1000, stopWin: 110_000, maxRounds: 1000 }), 10_000, 12345);
    const flatEnd = activeRangeEnd(r.perStrategy[0]!.bands, r.bands.rounds);
    const martEnd = activeRangeEnd(r.perStrategy[1]!.bands, r.bands.rounds);
    console.log(`[fan zoom] default scenario active range: flat ${flatEnd}, martingale ${martEnd} rounds`);
    expect(flatEnd).toBe(1000);
    expect(martEnd).toBeLessThan(100);
    expect(martEnd).toBeGreaterThan(0);
    // Session 12: the fit window [0, martEnd] holds EVERY round up to min(martEnd, 64) as a checkpoint.
    const inWindow = Array.from(r.bands.rounds).filter((x) => x <= martEnd);
    console.log(`[fan zoom] martingale fit window 0-${martEnd}: ${inWindow.length} band checkpoints`);
    if (martEnd <= DENSE_ROUNDS) expect(inWindow).toEqual(Array.from({ length: martEnd + 1 }, (_, i) => i));
  });
});

describe("non-uniform checkpoints (session 12): every chart path uses the real x values", () => {
  const rounds = checkpointRounds(1000); // 0..64 every round, then 69, 74, ... 994, 999, 1000

  it("hover snapping picks the nearest ACTUAL checkpoint, wherever the spacing changes", () => {
    const at = (x: number) => rounds[nearestIndex(rounds, x)];
    expect(at(10.4)).toBe(10); // dense part: every round
    expect(at(66)).toBe(64); // 64 -> 69 gap: 66 is nearer 64
    expect(at(67)).toBe(69);
    expect(at(66.5)).toBe(64); // tie goes low
    expect(at(502)).toBe(nearest(502));
    expect(at(999.6)).toBe(1000); // the last gap is 1 (999 -> 1000), not 5
    for (let x = 0; x <= 1000; x += 0.37) expect(at(x)).toBe(nearest(x));
  });
  function nearest(x: number): number {
    let best = rounds[0]!;
    for (const r of rounds) if (Math.abs(r - x) < Math.abs(best - x)) best = r;
    return best;
  }

  it("activeRangeEnd returns an actual checkpoint round, including in the geometric/capped part", () => {
    const k = rounds.indexOf(74);
    const flatAfter = (i: number) => Float64Array.from(rounds, (_, j) => (j <= i ? 1000 - j : 1000 - i));
    const b = (i: number) => ({ p5: flatAfter(i), p25: flatAfter(i), p50: flatAfter(i), p75: flatAfter(i), p95: flatAfter(i) });
    expect(activeRangeEnd(b(k), rounds)).toBe(rounds[k + 1]); // 79, not 74 + 5 assumed
    expect(activeRangeEnd(b(20), rounds)).toBe(21);
    expect(activeRangeEnd(b(64), rounds)).toBe(69);
  });

  it("fanSeries hands the renderer the checkpoint rounds themselves as x (no index-based spacing)", () => {
    const fake = { strategyId: "x", stats: {}, endReasonCounts: {}, samplePaths: [], histogramCounts: new Uint32Array(0), bands: { p5: new Float64Array(rounds.length), p25: new Float64Array(rounds.length), p50: new Float64Array(rounds.length), p75: new Float64Array(rounds.length), p95: new Float64Array(rounds.length) } } as unknown as Parameters<typeof fanSeries>[0];
    const f = fanSeries(fake, rounds);
    expect(f.outer.x).toBe(rounds);
    expect(f.inner.x).toBe(rounds);
    expect(f.median.x).toBe(rounds);
  });
});
