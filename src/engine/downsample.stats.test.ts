import { describe, expect, it } from "vitest";
import { DOWNSAMPLE_BUCKETS, MinMaxDownsampler } from "./downsample";
import { GAME_PRESETS } from "./games";
import { MAX_PATH_POINTS, runMonteCarlo, SAMPLE_PATH_COUNT } from "./montecarlo";
import { runSession } from "./runner";
import { flat } from "./strategies/flat";
import { sessionConfig } from "./testUtils";

const CAP = 2 * DOWNSAMPLE_BUCKETS + 2;

/** Checks every kept point is a real point of the generator, in strictly increasing round order. */
function expectRealPoints(path: { rounds: number[]; bankroll: number[] }, gen: (r: number) => number) {
  for (let k = 0; k < path.rounds.length; k++) {
    if (k > 0) expect(path.rounds[k]!).toBeGreaterThan(path.rounds[k - 1]!);
    expect(path.bankroll[k]).toBe(gen(path.rounds[k]!));
  }
}

describe("MinMaxDownsampler (streaming)", () => {
  it("1,000,000-round synthetic path that busts at round 777,777: keeps global max, min, the bust round (final point), a lone deep dip, and stays under the cap", () => {
    const maxRounds = 1_000_000;
    const bust = 777_777;
    // Deterministic wiggle around 500,000 cents, plus a one-round spike, a one-round dip, and a bust to 0.
    const gen = (r: number) => {
      if (r === 123_457) return 2_000_000; // global max, one round only
      if (r === 654_321) return 1; // deep one-round dip
      if (r === bust) return 0; // bust: global min and final point
      return 500_000 + ((r * 7919) % 20_001) - 10_000;
    };
    const ds = new MinMaxDownsampler(maxRounds);
    for (let r = 0; r <= bust; r++) ds.observer(r, gen(r)); // streamed: nothing per-round is stored
    const p = ds.result();

    expect(p.rounds.length).toBeLessThanOrEqual(CAP);
    expect(CAP).toBeLessThanOrEqual(MAX_PATH_POINTS);
    expectRealPoints(p, gen);
    expect(p.rounds[0]).toBe(0);
    expect(p.rounds[p.rounds.length - 1]).toBe(bust); // the exact bust round survives
    expect(p.bankroll[p.bankroll.length - 1]).toBe(0);
    expect(Math.max(...p.bankroll)).toBe(2_000_000);
    expect(p.rounds[p.bankroll.indexOf(2_000_000)]).toBe(123_457);
    expect(Math.min(...p.bankroll)).toBe(0);
    expect(p.rounds).toContain(654_321);
    console.log(`[downsample] 1M-round synthetic: ${p.rounds.length} points kept (cap ${CAP})`);
  });

  it("a session that runs all 1,000,000 rounds keeps its final point at round 1,000,000", () => {
    const ds = new MinMaxDownsampler(1_000_000);
    const gen = (r: number) => 1000 + (r % 97);
    for (let r = 0; r <= 1_000_000; r++) ds.observer(r, gen(r));
    const p = ds.result();
    expect(p.rounds.length).toBeLessThanOrEqual(CAP);
    expect(p.rounds[p.rounds.length - 1]).toBe(1_000_000);
    expectRealPoints(p, gen);
  });

  it("is lossless while every bucket holds at most 2 rounds (maxRounds <= 998)", () => {
    const cfg = sessionConfig({ startBankroll: 1_000_000, baseBet: 100, maxRounds: 2 * DOWNSAMPLE_BUCKETS });
    const european = GAME_PRESETS.find((g) => g.id === "european")!;
    const ds = new MinMaxDownsampler(cfg.maxRounds);
    const full = runSession(european, flat, { units: 1 }, cfg, 5, { recordPath: true, observer: ds.observer }).path!;
    expect(full.rounds).toHaveLength(2 * DOWNSAMPLE_BUCKETS + 1); // the session played every round
    expect(ds.result()).toEqual(full);
  });
});

describe("observed sessions at the maxRounds hard cap", () => {
  it("maxRounds 1,000,000: memory per observed session is independent of maxRounds", () => {
    const proc = (globalThis as { process?: { memoryUsage(): { heapUsed: number } } }).process;
    const european = GAME_PRESETS.find((g) => g.id === "european")!;
    // Bankroll large enough that flat $1 bets play all 1,000,000 rounds.
    const cfg = sessionConfig({ startBankroll: 1_000_000_000, baseBet: 100, maxRounds: 1_000_000 });
    const n = 60; // > 50 sample paths; all 60 are band-subset sessions (observed every round)
    const heapBefore = proc?.memoryUsage().heapUsed ?? 0;
    const t0 = performance.now();
    const r = runMonteCarlo(european, [{ strategy: flat, config: { units: 1 } }], cfg, n, 11);
    const seconds = (performance.now() - t0) / 1000;
    const heapAfter = proc?.memoryUsage().heapUsed ?? 0;
    const growthMB = (heapAfter - heapBefore) / 1e6;
    const out = r.perStrategy[0]!;
    const points = out.samplePaths.reduce((s, p) => s + p.rounds.length, 0);
    // Full paths would be 60 sessions × 1,000,001 rounds × 2 numbers × 8 bytes ≈ 960 MB.
    console.log(`[1M observed] ${n} sessions × 1,000,000 rounds in ${seconds.toFixed(1)}s; heap growth ${growthMB.toFixed(1)} MB; sample path points ${points}; band checkpoints ${r.bands.rounds.length}`);
    expect(out.stats.meanRounds).toBe(1_000_000);
    expect(out.samplePaths).toHaveLength(SAMPLE_PATH_COUNT);
    for (const p of out.samplePaths) {
      expect(p.rounds.length).toBeLessThanOrEqual(MAX_PATH_POINTS);
      expect(p.rounds[p.rounds.length - 1]).toBe(1_000_000);
    }
    if (proc) expect(growthMB).toBeLessThan(50);
  });
});
