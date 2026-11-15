// The comparison between two strategies: what the paired interval detects that the old overlap rule
// missed, and how often each rule calls a difference "clear" when there is none. Every data set is
// seeded (mulberry32), so each rate printed here is the same on every run. Rates are checked against
// the nominal 5% with a tolerance of 4 binomial standard errors, computed here and printed.
import { describe, expect, it } from "vitest";
import { evDifference, bustDifference, evInterval, overlaps, pairCount, takeaways, type TakeawayInput } from "./takeaways";
import { GAME_PRESETS } from "../engine/games";
import { runMonteCarlo } from "../engine/montecarlo";
import { mulberry32, type Rng } from "../engine/rng";
import { flat } from "../engine/strategies/flat";
import { martingale } from "../engine/strategies/martingale";
import { sessionConfig, testCtx } from "../engine/testUtils";
import type { SessionResult } from "../engine/types";
import { addSession, bustCount, createAccumulator, type Accumulator } from "../engine/stats/accumulator";
import { pairedComparison, pairedComparisons } from "../engine/stats/paired";
import { STATS } from "../engine/stats/registry";

const START = 100_000; // cents
const WAGERED = 10_000; // cents wagered per synthetic session (constant, so EV per $ = mean profit / WAGERED)
const NOMINAL = 0.05;

/** Standard normal draws (Box-Muller) from a seeded uniform stream. */
function normal(rng: Rng): number {
  const u = 1 - rng(); // (0, 1]
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

function session(profit: number, bust = false): SessionResult {
  return { finalBankroll: START + profit, rounds: 10, totalWagered: WAGERED, peak: START, maxDrawdown: 0, longestLosingStreak: 0, endReason: bust ? "ruin" : "maxRounds" };
}

function accumulate(results: readonly SessionResult[]): Accumulator {
  const acc = createAccumulator(results.length, START);
  for (const r of results) addSession(acc, r);
  return acc;
}

/** Takeaway input for hand-built accumulators: every registered stat, plus the paired comparisons when `paired`. */
function inputOf(accs: readonly Accumulator[], paired: boolean): TakeawayInput {
  const n = accs[0]!.count;
  const ctx = testCtx(n, START);
  return {
    edge: ctx.edge,
    nSessions: n,
    strategies: accs.map((acc, k) => ({ label: `S${k + 1}`, stats: Object.fromEntries(STATS.map((s) => [s.id, s.compute(acc, ctx)])) })),
    ...(paired ? { comparisons: pairedComparisons(accs) } : {}),
  };
}

/** n sessions for k strategies that share one luck term per session (sd `shared`) plus their own noise (sd `own`); strategy j's mean profit is shift[j]. */
function sharedNoise(rng: Rng, n: number, shifts: readonly number[], shared: number, own: number): Accumulator[] {
  const cols: SessionResult[][] = shifts.map(() => []);
  for (let i = 0; i < n; i++) {
    const luck = shared * normal(rng);
    shifts.forEach((shift, j) => cols[j]!.push(session(luck + shift + own * normal(rng))));
  }
  return cols.map(accumulate);
}

/** Binomial standard error of a rate estimated from `reps` repetitions at the nominal level. */
const rateSE = (reps: number) => Math.sqrt((NOMINAL * (1 - NOMINAL)) / reps);
const pct = (v: number) => `${(100 * v).toFixed(2)}%`;

describe("paired comparison: a small known difference under shared noise", () => {
  // Both strategies ride the same luck (sd $10.00 per session); B is worse by a known 10 cents per
  // session, i.e. 0.10 percentage points of EV per $ on $100 wagered. Own noise is sd $0.50.
  const DELTA = 10;
  const TRUE_DIFF = DELTA / WAGERED;
  const accs = sharedNoise(mulberry32(20261114), 2000, [0, -DELTA], 1000, 50);
  const paired = inputOf(accs, true);
  const unpaired = inputOf(accs, false);

  it("the old overlap rule says 'not clear'; the paired interval detects the difference and covers its true size", () => {
    const [a, b] = paired.strategies;
    const ivA = evInterval(a!.stats)!;
    const ivB = evInterval(b!.stats)!;
    expect(overlaps(ivA, ivB), "old rule: the two 95% intervals overlap").toBe(true);

    const v = evDifference(paired, 0, 1)!;
    console.log(
      `[paired] true difference ${pct(TRUE_DIFF)}; separate SEs ${pct(a!.stats.evSE!)} and ${pct(b!.stats.evSE!)} (intervals overlap); ` +
        `paired difference ${pct(v.diff)} (${pct(v.low)} to ${pct(v.high)}), paired SE ${pct(paired.comparisons![0]!.evDiffSE)}, n ${v.n}`,
    );
    expect(v.method).toBe("paired");
    expect(v.n).toBe(2000);
    expect(v.clear).toBe(true);
    expect(v.low).toBeGreaterThan(0);
    expect(v.low).toBeLessThanOrEqual(TRUE_DIFF);
    expect(v.high).toBeGreaterThanOrEqual(TRUE_DIFF);
    // The pairing is what finds it: the same numbers as independent samples stay unclear.
    const w = evDifference(unpaired, 0, 1)!;
    expect(w.method).toBe("independent");
    expect(w.clear).toBe(false);
  });

  it("the paired SE is the plain standard error of the per-session differences (checked independently)", () => {
    const [A, B] = accs;
    const n = A!.count;
    const d = Array.from({ length: n }, (_, i) => (A!.finals[i]! - B!.finals[i]!) / WAGERED);
    const mean = d.reduce((s, x) => s + x, 0) / n;
    const se = Math.sqrt(d.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1) / n);
    const cmp = pairedComparison(A!, B!, 0, 1);
    expect(cmp.evDiff).toBeCloseTo(mean, 12);
    expect(cmp.evDiffSE).toBeCloseTo(se, 12);
  });

  it("the sentences say which interval ran, the difference with its interval, and the sessions", () => {
    const ev = takeaways(paired)[1]!;
    console.log(`[paired] ${ev}`);
    expect(ev).toMatch(/over the same 2,000 sessions \(paired t-interval\), S2's EV per \$ minus S1's is -0\.\d\d percentage points \(95% interval -0\.\d\d to -0\.\d\d\), which excludes zero: S2 measured a lower EV per \$ than S1\.$/);
    const fallback = takeaways(unpaired)[1]!;
    expect(fallback).toMatch(/as independent samples of 2,000 sessions each \(Welch interval\), .* which includes zero: the difference between the strategies isn't clear at this sample size\.$/);
  });

  it("a strategy compared with an identical copy: difference exactly 0, never 'clear'", () => {
    const same = inputOf([accs[0]!, accs[0]!], true);
    const cmp = same.comparisons![0]!;
    expect([cmp.evDiff, cmp.evDiffSE, cmp.bustOnlyA, cmp.bustOnlyB]).toEqual([0, 0, 0, 0]);
    expect(evDifference(same, 0, 1)!.clear).toBe(false);
    expect(bustDifference(same, 0, 1, 0, 0)!.clear).toBe(false);
  });
});

describe("no true difference: how often each rule says 'clear' (nominal 5%)", () => {
  it("paired EV difference: the false-'clear' rate is within 4 SE of 5%; the overlap rule almost never fires", () => {
    const REPS = 4000;
    const rng = mulberry32(1);
    let pairedClear = 0;
    let overlapClear = 0;
    for (let r = 0; r < REPS; r++) {
      const input = inputOf(sharedNoise(rng, 200, [0, 0], 1000, 300), true);
      if (evDifference(input, 0, 1)!.clear) pairedClear++;
      if (!overlaps(evInterval(input.strategies[0]!.stats)!, evInterval(input.strategies[1]!.stats)!)) overlapClear++;
    }
    const rate = pairedClear / REPS;
    const se = rateSE(REPS);
    console.log(`[null, paired EV] ${REPS} repetitions × 200 sessions: paired false-clear ${pct(rate)} (nominal ${pct(NOMINAL)}, SE ${pct(se)}); old overlap rule ${pct(overlapClear / REPS)}`);
    expect(Math.abs(rate - NOMINAL)).toBeLessThan(4 * se);
    expect(overlapClear / REPS).toBeLessThan(NOMINAL - 4 * se); // the old rule was far below its stated level
  });

  it("paired bust-rate difference: the false-'clear' rate is not above 5% (within 4 SE), and a real difference is found", () => {
    const REPS = 4000;
    const N = 500;
    const rng = mulberry32(2);
    /** Both strategies bust on the shared bad sessions (10%); each also flips its own outcome with probability `flip[j]`. */
    const run = (flip: readonly [number, number]) => {
      const cols: [SessionResult[], SessionResult[]] = [[], []];
      for (let i = 0; i < N; i++) {
        const bad = rng() < 0.1;
        for (const j of [0, 1] as const) cols[j].push(session(0, rng() < flip[j] ? !bad : bad));
      }
      const accs = cols.map(accumulate);
      return bustDifference(inputOf(accs, true), 0, 1, bustCount(accs[0]!), bustCount(accs[1]!))!;
    };
    let nullClear = 0;
    let realClear = 0;
    for (let r = 0; r < REPS; r++) {
      if (run([0.03, 0.03]).clear) nullClear++;
      if (run([0.03, 0.1]).clear) realClear++;
    }
    const se = rateSE(REPS);
    console.log(`[null, paired bust] ${REPS} repetitions × ${N} sessions: false-clear ${pct(nullClear / REPS)} (nominal ${pct(NOMINAL)}, SE ${pct(se)}); a real 5.6-point difference found in ${pct(realClear / REPS)}`);
    expect(nullClear / REPS).toBeLessThan(NOMINAL + 4 * se);
    expect(nullClear / REPS).toBeGreaterThan(NOMINAL / 2); // not so cautious that it is useless
    expect(realClear / REPS).toBeGreaterThan(0.9);
  });

  it("few discordant sessions: 5 against 0 is not called a difference, 6 against 0 is (matching the exact sign test)", () => {
    const build = (onlyA: number) => {
      const a = Array.from({ length: 1000 }, (_, i) => session(0, i < onlyA));
      const b = Array.from({ length: 1000 }, () => session(0, false));
      return bustDifference(inputOf([accumulate(a), accumulate(b)], true), 0, 1, onlyA, 0)!;
    };
    // Exact two-sided sign test: 5 of 5 has p = 0.0625, 6 of 6 has p = 0.03125.
    expect(build(3).clear).toBe(false); // plain Wald would call this clear
    expect(build(5).clear).toBe(false);
    expect(build(6).clear).toBe(true);
  });

  it("largest gap among five strategies: unadjusted it is 'clear' far too often; widened for all 10 pairs it stays at or below 5%", () => {
    const REPS = 2000;
    const rng = mulberry32(3);
    let plain = 0;
    let widened = 0;
    for (let r = 0; r < REPS; r++) {
      const input = inputOf(sharedNoise(rng, 200, [0, 0, 0, 0, 0], 1000, 300), true);
      const evs = input.strategies.map((s) => s.stats.evPerWagered!);
      const lo = evs.indexOf(Math.min(...evs));
      const hi = evs.indexOf(Math.max(...evs));
      if (evDifference(input, lo, hi, 1)!.clear) plain++;
      if (evDifference(input, lo, hi, pairCount(5))!.clear) widened++;
    }
    const se = rateSE(REPS);
    console.log(`[null, 5 strategies] ${REPS} repetitions: lowest-vs-highest false-clear ${pct(plain / REPS)} unadjusted, ${pct(widened / REPS)} widened for 10 pairs (nominal ${pct(NOMINAL)}, SE ${pct(se)})`);
    expect(plain / REPS).toBeGreaterThan(NOMINAL + 4 * se);
    expect(widened / REPS).toBeLessThan(NOMINAL + 4 * se);
  });
});

describe("unpaired data: the fallback treats the samples as independent", () => {
  it("Welch on EV: false-'clear' within 4 SE of 5%, and it finds a real difference more often than the overlap rule", () => {
    const REPS = 2000;
    const N = 200;
    const rng = mulberry32(4);
    const sd = 1000;
    const shift = 3.3 * (sd / Math.sqrt(N)); // 3.3 single-sample SEs: between Welch's threshold (2.77) and overlap's (3.92)
    let nullClear = 0;
    let welchFound = 0;
    let overlapFound = 0;
    const independent = (mean: number) => accumulate(Array.from({ length: N }, () => session(mean + sd * normal(rng))));
    for (let r = 0; r < REPS; r++) {
      if (evDifference(inputOf([independent(0), independent(0)], false), 0, 1)!.clear) nullClear++;
      const real = inputOf([independent(0), independent(-shift)], false);
      const v = evDifference(real, 0, 1)!;
      expect(v.method).toBe("independent");
      if (v.clear) welchFound++;
      if (!overlaps(evInterval(real.strategies[0]!.stats)!, evInterval(real.strategies[1]!.stats)!)) overlapFound++;
    }
    const se = rateSE(REPS);
    console.log(`[unpaired, Welch] ${REPS} repetitions × ${N} sessions each: false-clear ${pct(nullClear / REPS)} (nominal ${pct(NOMINAL)}, SE ${pct(se)}); real difference found by Welch ${pct(welchFound / REPS)}, by overlap ${pct(overlapFound / REPS)}`);
    expect(Math.abs(nullClear / REPS - NOMINAL)).toBeLessThan(4 * se);
    expect(welchFound).toBeGreaterThan(overlapFound);
  });

  it("Newcombe on bust rates: handled without pairing data, 'clear' for a real gap and not for equal rates", () => {
    const bustEvery = (k: number) => accumulate(Array.from({ length: 2000 }, (_, i) => session(0, i % k === 0)));
    const equal = [bustEvery(10), bustEvery(10)];
    const gap = [bustEvery(10), bustEvery(5)];
    const same = bustDifference(inputOf(equal, false), 0, 1, bustCount(equal[0]!), bustCount(equal[1]!))!;
    const diff = bustDifference(inputOf(gap, false), 1, 0, bustCount(gap[1]!), bustCount(gap[0]!))!;
    expect(same.method).toBe("independent");
    expect(same.clear).toBe(false);
    expect(diff.clear).toBe(true);
    expect(diff.diff).toBeCloseTo(0.1, 12);
    expect(takeaways(inputOf(gap, false))[2]).toMatch(/as independent samples of 2,000 sessions each \(Newcombe interval\), S2's bust rate minus S1's is 10\.0 percentage points \(95% interval \d+\.\d to \d+\.\d\), which excludes zero: S2 went bust more often than S1\.$/);
  });
});

describe("the real engine: Flat against Martingale on European roulette", () => {
  // The core truth says both have the SAME EV per $ wagered (−edge), so any "clear" EV difference
  // here is a false one. Martingale's profit is heavily skewed, so this checks the t-interval on the
  // kind of data it actually sees, not on normal draws.
  it("the paired EV comparison says 'clear' no more than the nominal 5% of the time (within 4 SE), across master seeds", () => {
    const REPS = 400;
    const SESSIONS = 1000;
    const european = GAME_PRESETS.find((g) => g.id === "european")!;
    const cfg = sessionConfig({ startBankroll: 20_000, baseBet: 100, maxRounds: 100 });
    const specs = [{ strategy: flat, config: flat.defaultConfig }, { strategy: martingale, config: martingale.defaultConfig }];
    let clear = 0;
    let overlapClear = 0;
    let seRatio = 0;
    for (let seed = 1; seed <= REPS; seed++) {
      const r = runMonteCarlo(european, specs, cfg, SESSIONS, seed);
      const input: TakeawayInput = { edge: 1 / 37, nSessions: SESSIONS, strategies: r.perStrategy.map((o) => ({ label: o.strategyId, stats: o.stats })), comparisons: r.comparisons };
      if (evDifference(input, 0, 1)!.clear) clear++;
      if (!overlaps(evInterval(r.perStrategy[0]!.stats)!, evInterval(r.perStrategy[1]!.stats)!)) overlapClear++;
      seRatio += r.comparisons[0]!.evDiffSE / Math.hypot(r.perStrategy[0]!.stats.evSE!, r.perStrategy[1]!.stats.evSE!);
    }
    const se = rateSE(REPS);
    console.log(
      `[engine, Flat vs Martingale] ${REPS} master seeds × ${SESSIONS} sessions: paired false-clear ${pct(clear / REPS)} (nominal ${pct(NOMINAL)}, SE ${pct(se)}); ` +
        `old overlap rule ${pct(overlapClear / REPS)}; paired SE / independent SE averaged ${(seRatio / REPS).toFixed(3)}`,
    );
    expect(clear / REPS).toBeLessThan(NOMINAL + 4 * se);
  });

  it("same master seed, same comparisons, bit for bit", () => {
    const european = GAME_PRESETS.find((g) => g.id === "european")!;
    const cfg = sessionConfig({ startBankroll: 20_000, baseBet: 100, maxRounds: 100 });
    const specs = [{ strategy: flat, config: flat.defaultConfig }, { strategy: martingale, config: martingale.defaultConfig }, { strategy: flat, config: { units: 2 } }];
    const a = runMonteCarlo(european, specs, cfg, 500, 99);
    const b = runMonteCarlo(european, specs, cfg, 500, 99);
    expect(a.comparisons.map((c) => [c.a, c.b])).toEqual([[0, 1], [0, 2], [1, 2]]);
    expect(JSON.stringify(b.comparisons)).toBe(JSON.stringify(a.comparisons));
    expect(JSON.stringify(runMonteCarlo(european, specs, cfg, 500, 100).comparisons)).not.toBe(JSON.stringify(a.comparisons));
    for (const c of a.comparisons) expect(c.n).toBe(500);
  });
});
