// The comparison between two strategies: what the paired interval detects that the old overlap rule
// missed, and how often each rule calls a difference "clear" when there is none. Every data set is
// seeded (mulberry32), so each rate printed here is the same on every run. Rates are checked against
// the nominal 5% with a tolerance of 4 binomial standard errors, computed here and printed.
import { describe, expect, it } from "vitest";
import { evClaim, evDifference, bustDifference, evInterval, overlaps, pairCount, takeaways, type TakeawayInput } from "./takeaways";
import { GAME_PRESETS } from "../engine/games";
import { runMonteCarlo } from "../engine/montecarlo";
import { mulberry32, type Rng } from "../engine/rng";
import { fibonacci } from "../engine/strategies/fibonacci";
import { flat } from "../engine/strategies/flat";
import { martingale } from "../engine/strategies/martingale";
import { paroli } from "../engine/strategies/paroli";
import { sessionConfig, testCtx } from "../engine/testUtils";
import type { SessionResult } from "../engine/types";
import { addSession, bustCount, createAccumulator, type Accumulator } from "../engine/stats/accumulator";
import { pairedComparison, pairedComparisons } from "../engine/stats/paired";
import { STATS } from "../engine/stats/registry";

// Cents. Five times the per-session luck (sd 1,000 below): the worst-case-session check weighs a
// whole-bankroll loss against the sample, so a bankroll far larger than anything a session does would
// make every synthetic difference "fragile" (that case is tested on purpose below).
const START = 5_000;
const WAGERED = 10_000; // cents wagered per synthetic session (constant, so EV per $ = mean profit / WAGERED)
const NOMINAL = 0.05;

/** Standard normal draws (Box-Muller) from a seeded uniform stream. */
function normal(rng: Rng): number {
  const u = 1 - rng(); // (0, 1]
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

function session(profit: number, bust = false): SessionResult {
  return { finalBankroll: START + Math.max(profit, -START), rounds: 10, totalWagered: WAGERED, peak: START, maxDrawdown: 0, longestLosingStreak: 0, endReason: bust ? "ruin" : "maxRounds" };
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
  const accs = sharedNoise(mulberry32(20261114), 5000, [0, -DELTA], 1000, 50);
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
    expect(v.n).toBe(5000);
    expect([v.excludesZero, v.fragile, v.clear]).toEqual([true, false, true]);
    expect(v.low).toBeGreaterThan(0);
    expect(v.low).toBeLessThanOrEqual(TRUE_DIFF);
    expect(v.high).toBeGreaterThanOrEqual(TRUE_DIFF);
    // The pairing is what finds it: the same numbers as independent samples stay unclear.
    const w = evDifference(unpaired, 0, 1)!;
    expect(w.method).toBe("independent");
    expect(w.clear).toBe(false);
  });

  it("the same data with a bankroll 100 times larger is 'fragile': one unseen bankroll loss would outweigh the whole difference", () => {
    const cmp = paired.comparisons![0]!;
    const v = evDifference({ ...paired, comparisons: [{ ...cmp, worstA: cmp.worstA * 100, worstB: cmp.worstB * 100 }] }, 0, 1)!;
    expect([v.excludesZero, v.fragile, v.clear]).toEqual([true, true, false]);
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
    expect(ev).toMatch(/over the same 5,000 sessions \(paired t-interval\), S2's EV per \$ minus S1's is -0\.\d\d percentage points \(95% interval -0\.\d\d to -0\.\d\d\), which excludes zero: S2 measured a lower EV per \$ than S1\.$/);
    const fallback = takeaways(unpaired)[1]!;
    expect(fallback).toMatch(/as independent samples of 5,000 sessions each \(Welch interval\), .* which includes zero: the difference between the strategies isn't clear at this sample size\.$/);
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
    let pairedClear = 0; // the t-interval alone
    let guardedClear = 0; // with the worst-case-session check: what the report says
    let overlapClear = 0;
    for (let r = 0; r < REPS; r++) {
      const input = inputOf(sharedNoise(rng, 200, [0, 0], 1000, 300), true);
      const v = evDifference(input, 0, 1)!;
      if (v.excludesZero) pairedClear++;
      if (v.clear) guardedClear++;
      if (!overlaps(evInterval(input.strategies[0]!.stats)!, evInterval(input.strategies[1]!.stats)!)) overlapClear++;
    }
    const rate = pairedClear / REPS;
    const se = rateSE(REPS);
    console.log(`[null, paired EV] ${REPS} repetitions × 200 sessions: paired t-interval excludes zero ${pct(rate)} (nominal ${pct(NOMINAL)}, SE ${pct(se)}); reported clear after the worst-case check ${pct(guardedClear / REPS)}; old overlap rule ${pct(overlapClear / REPS)}`);
    expect(Math.abs(rate - NOMINAL)).toBeLessThan(4 * se);
    expect(guardedClear).toBeLessThanOrEqual(pairedClear); // the check can only withhold a verdict
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
      if (evDifference(input, lo, hi, 1)!.excludesZero) plain++;
      if (evDifference(input, lo, hi, pairCount(5))!.excludesZero) widened++;
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
    let excludes = 0;
    let clear = 0;
    let overlapClear = 0;
    let seRatio = 0;
    for (let seed = 1; seed <= REPS; seed++) {
      const r = runMonteCarlo(european, specs, cfg, SESSIONS, seed);
      const input: TakeawayInput = { edge: 1 / 37, nSessions: SESSIONS, strategies: r.perStrategy.map((o) => ({ label: o.strategyId, stats: o.stats })), comparisons: r.comparisons };
      const v = evDifference(input, 0, 1)!;
      if (v.excludesZero) excludes++;
      if (v.clear) clear++;
      if (!overlaps(evInterval(r.perStrategy[0]!.stats)!, evInterval(r.perStrategy[1]!.stats)!)) overlapClear++;
      seRatio += r.comparisons[0]!.evDiffSE / Math.hypot(r.perStrategy[0]!.stats.evSE!, r.perStrategy[1]!.stats.evSE!);
    }
    const se = rateSE(REPS);
    console.log(
      `[engine, Flat vs Martingale] ${REPS} master seeds × ${SESSIONS} sessions: paired t-interval excludes zero ${pct(excludes / REPS)}, reported clear ${pct(clear / REPS)} (nominal ${pct(NOMINAL)}, SE ${pct(se)}); ` +
        `old overlap rule ${pct(overlapClear / REPS)}; paired SE / independent SE averaged ${(seRatio / REPS).toFixed(3)}`,
    );
    expect(excludes / REPS).toBeLessThan(NOMINAL + 4 * se);
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

describe("small session counts, rare busts (session 23)", () => {
  const SMALL_N = [30, 50, 100, 250] as const;

  // Bonett-Price on rare busts with NO true difference. "independent": each strategy busts on its own
  // with probability `own` (every bust is a discordant session). "shared": both bust together on a
  // shared bad session (probability `shared`) and each also busts alone with probability `own`.
  // The interval depends only on the discordant counts and n, so the comparison record is built directly.
  it("paired bust interval: false-'clear' stays at or below 5% for true rates of 1% to 3% at 30 to 250 sessions", () => {
    const REPS = 20_000;
    const se = rateSE(REPS);
    const regimes = [
      { name: "independent, 1% each", shared: 0, own: 0.01 },
      { name: "independent, 2% each", shared: 0, own: 0.02 },
      { name: "independent, 3% each", shared: 0, own: 0.03 },
      { name: "1% shared + 0.5% own (1.5% each)", shared: 0.01, own: 0.005 },
      { name: "1.5% shared + 1.5% own (3% each)", shared: 0.015, own: 0.015 },
    ];
    for (const [k, g] of regimes.entries()) {
      for (const n of SMALL_N) {
        const rng = mulberry32(230_000 + 1000 * k + n);
        let clear = 0;
        for (let r = 0; r < REPS; r++) {
          let onlyA = 0;
          let onlyB = 0;
          for (let i = 0; i < n; i++) {
            const bad = rng() < g.shared;
            const bustA = bad || rng() < g.own;
            const bustB = bad || rng() < g.own;
            if (bustA && !bustB) onlyA++;
            else if (bustB && !bustA) onlyB++;
          }
          const input: TakeawayInput = { edge: 0, nSessions: n, strategies: [], comparisons: [{ a: 0, b: 1, n, evDiff: NaN, evDiffSE: NaN, bustOnlyA: onlyA, bustOnlyB: onlyB, worstA: NaN, worstB: NaN }] };
          if (bustDifference(input, 0, 1, 0, 0)!.clear) clear++;
        }
        console.log(`[small n, paired bust] ${g.name}, n ${n}, ${REPS} repetitions: false-clear ${pct(clear / REPS)} (nominal ${pct(NOMINAL)}, SE ${pct(se)})`);
        expect(clear / REPS, `${g.name}, n ${n}`).toBeLessThan(NOMINAL + 4 * se);
      }
    }
  });

  // The real engine on European roulette: every strategy's true EV per $ is −1/37, so every true
  // difference is zero. Each regime sets how rare a bust is. Four strategies with different bust
  // behaviour run on the same sessions (Flat rarely busts, Martingale busts suddenly, Fibonacci climbs
  // more slowly, Paroli raises its bet only after wins). Two things are measured per session count:
  //  - pairs: how often a difference is called clear. "t alone" is the paired t-interval; "reported"
  //    adds the worst-case-session check and is what the report says.
  //  - single strategies: how often the sentences claim something false. "Above theory": the interval
  //    lies wholly above the true value. "Gain": it lies wholly above zero. "Plain" is the interval
  //    alone (the report before session 24); "reported" is what evClaim lets the sentence say unhedged.
  const european = GAME_PRESETS.find((g) => g.id === "european")!;
  const STRATEGIES = [flat, martingale, paroli, fibonacci];
  const specs = STRATEGIES.map((strategy) => ({ strategy, config: strategy.defaultConfig }));
  const PAIRS: readonly (readonly [number, number])[] = [[0, 1], [2, 0], [1, 3], [1, 2]];
  const REGIMES = [
    { name: "busts very rare ($1,000 bankroll, $1 base, 10 rounds)", cfg: sessionConfig({ startBankroll: 100_000, baseBet: 100, maxRounds: 10 }), reps: 2000, ns: [...SMALL_N, 1000] },
    { name: "busts rare ($1,000 bankroll, $1 base, 30 rounds)", cfg: sessionConfig({ startBankroll: 100_000, baseBet: 100, maxRounds: 30 }), reps: 2000, ns: [...SMALL_N, 1000] },
    { name: "the app's default run ($1,000 bankroll, $10 base, win target $1,100, 1,000 rounds)", cfg: sessionConfig({ startBankroll: 100_000, baseBet: 1000, stopWin: 110_000, maxRounds: 1000 }), reps: 400, ns: [...SMALL_N] },
    { name: "busts common ($200 bankroll, $1 base, 100 rounds)", cfg: sessionConfig({ startBankroll: 20_000, baseBet: 100, maxRounds: 100 }), reps: 1000, ns: [...SMALL_N] },
  ];
  for (const [k, g] of REGIMES.entries()) {
    it(`real engine, ${g.name}: reported false claims stay at or below 5% at every session count, for pairs and for single strategies`, () => {
      const se = rateSE(g.reps);
      const theory = -1 / 37;
      const firstPairT: number[] = [];
      for (const n of g.ns) {
        const pairT = PAIRS.map(() => 0);
        const pairReported = PAIRS.map(() => 0);
        const single = STRATEGIES.map(() => ({ abovePlain: 0, aboveReported: 0, belowPlain: 0, gainPlain: 0, gainReported: 0, bust: 0 }));
        for (let rep = 0; rep < g.reps; rep++) {
          const r = runMonteCarlo(european, specs, g.cfg, n, 23_000_000 + 1_000_000 * k + 10_000 * rep + n);
          const input: TakeawayInput = { edge: -theory, nSessions: n, strategies: r.perStrategy.map((o) => ({ label: o.strategyId, stats: o.stats })), comparisons: r.comparisons, startBankroll: g.cfg.startBankroll };
          PAIRS.forEach(([i, j], q) => {
            const v = evDifference(input, i, j)!;
            if (v.excludesZero) pairT[q]!++;
            if (v.clear) pairReported[q]!++;
          });
          STRATEGIES.forEach((_, s) => {
            const c = evClaim(input, s)!;
            const t = single[s]!;
            if (c.iv.low > theory) t.abovePlain++;
            if (c.iv.low > theory && c.missesTheory) t.aboveReported++; // stated as a chance miss, with no hedge
            if (c.iv.high < theory) t.belowPlain++;
            if (c.looksLikeGain) t.gainPlain++;
            if (c.looksLikeGain && !c.fragile && !c.nearZero) t.gainReported++; // left to read as a gain
            t.bust += r.perStrategy[s]!.stats.pBust! / g.reps;
          });
        }
        firstPairT.push(pairT[0]! / g.reps);
        PAIRS.forEach(([i, j], q) => {
          console.log(
            `[small n, pair] ${g.name}; ${STRATEGIES[i]!.id} vs ${STRATEGIES[j]!.id}; n ${n}, ${g.reps} repetitions: ` +
              `t alone ${pct(pairT[q]! / g.reps)}, reported ${pct(pairReported[q]! / g.reps)} (nominal ${pct(NOMINAL)}, SE ${pct(se)})`,
          );
          expect(pairReported[q]! / g.reps, `${STRATEGIES[i]!.id} vs ${STRATEGIES[j]!.id}, n ${n}`).toBeLessThan(NOMINAL + 4 * se);
        });
        STRATEGIES.forEach((strategy, s) => {
          const t = single[s]!;
          console.log(
            `[small n, single] ${g.name}; ${strategy.id} (busts in ${pct(t.bust)}); n ${n}, ${g.reps} repetitions: ` +
              `above theory plain ${pct(t.abovePlain / g.reps)}, reported ${pct(t.aboveReported / g.reps)}; ` +
              `gain plain ${pct(t.gainPlain / g.reps)}, reported ${pct(t.gainReported / g.reps)}; below theory ${pct(t.belowPlain / g.reps)} (SE ${pct(se)})`,
          );
          // The sentence calls a miss a 1-in-20 event: unhedged misses on both sides together must not exceed 5%.
          expect((t.aboveReported + t.belowPlain) / g.reps, `${strategy.id} misses, n ${n}`).toBeLessThan(NOMINAL + 4 * se);
          // One-sided: an unhedged "gain" on a losing game should be rarer than 2.5%.
          expect(t.gainReported / g.reps, `${strategy.id} gain, n ${n}`).toBeLessThan(NOMINAL / 2 + 4 * se);
        });
      }
      // Why the check exists: with rare busts the t-interval alone is far above its nominal level at 30 sessions.
      if (k <= 1) expect(firstPairT[0]!).toBeGreaterThan(0.07 + 4 * se);
    });
  }
});

describe("a hidden GAIN: rare large payouts (review, 2026-11-16)", () => {
  // Flat against Paroli on a 1-in-1000 game paying 974 to 1: both have EV per $ −2.5%, so the true
  // difference is zero. Paroli differs from Flat only on the round after a win, where it stakes one
  // more unit; a sample with no jackpot on those extra units makes Paroli look worse than it is. The
  // bankroll ($200) is far below one jackpot ($974 on a $1 stake), so the bankroll-loss stress alone
  // cannot cover the missing win.
  it("the hidden-loss check alone names a false difference far above 5%; with the game's top payout it stays at or below 5% (within 4 SE)", () => {
    const REPS = 200;
    // 10,000 sessions: the regime where the review measured the defect (36.75% false clear). At 5,000
    // the bankroll-loss stress still happens to cover one missing jackpot (0.00% either way).
    const SESSIONS = 10_000;
    const jackpot = { id: "jackpot", name: "1 in 1000, pays 974", winProb: 1 / 1000, netPayout: 974 };
    const cfg = sessionConfig({ startBankroll: 20_000, baseBet: 100, maxRounds: 100 });
    const specs = [{ strategy: flat, config: flat.defaultConfig }, { strategy: paroli, config: paroli.defaultConfig }];
    let lossOnly = 0;
    let both = 0;
    for (let rep = 0; rep < REPS; rep++) {
      const r = runMonteCarlo(jackpot, specs, cfg, SESSIONS, 26_000_000 + rep);
      const input: TakeawayInput = { edge: 0.025, nSessions: SESSIONS, strategies: r.perStrategy.map((o) => ({ label: o.strategyId, stats: o.stats })), comparisons: r.comparisons, startBankroll: cfg.startBankroll };
      if (evDifference(input, 0, 1)!.clear) lossOnly++;
      if (evDifference({ ...input, maxNet: 974 }, 0, 1)!.clear) both++;
    }
    const se = rateSE(REPS);
    console.log(`[hidden gain] Flat vs Paroli, 1-in-1000 x974, ${REPS} master seeds × ${SESSIONS} sessions: false clear with the loss check only ${pct(lossOnly / REPS)}, with the top-payout check too ${pct(both / REPS)} (nominal ${pct(NOMINAL)}, SE ${pct(se)})`);
    expect(lossOnly / REPS).toBeGreaterThan(NOMINAL + 4 * se); // why the mirror check exists
    expect(both / REPS).toBeLessThan(NOMINAL + 4 * se);
  });

  it("on even money the extra check never names a difference the loss check alone would not", () => {
    const european = GAME_PRESETS.find((g) => g.id === "european")!;
    const cfg = sessionConfig({ startBankroll: 20_000, baseBet: 100, maxRounds: 100 });
    const specs = [{ strategy: flat, config: flat.defaultConfig }, { strategy: martingale, config: martingale.defaultConfig }];
    for (let seed = 1; seed <= 50; seed++) {
      const r = runMonteCarlo(european, specs, cfg, 1000, seed);
      const input: TakeawayInput = { edge: 1 / 37, nSessions: 1000, strategies: r.perStrategy.map((o) => ({ label: o.strategyId, stats: o.stats })), comparisons: r.comparisons, startBankroll: cfg.startBankroll };
      if (evDifference({ ...input, maxNet: 1 }, 0, 1)!.clear) expect(evDifference(input, 0, 1)!.clear).toBe(true);
    }
  });
});
