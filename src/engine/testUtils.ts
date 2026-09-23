// Test-only helpers. Not imported by production code.
import { describe, expect, it } from "vitest";
import { edge, GAME_PRESETS, type Game } from "./games";
import { sessionSeed, type Rng } from "./rng";
import { runSession } from "./runner";
import type { AnyStrategy, StrategyConfig } from "./strategies/types";
import type { SamplePath, SessionConfig, SessionResult } from "./types";

/** An RNG that plays a scripted win/loss sequence and counts every draw. */
export function scriptedRng(outcomes: readonly boolean[]): Rng & { draws: () => number } {
  let i = 0;
  const rng = () => {
    const o = outcomes[i++];
    if (o === undefined) throw new Error(`scriptedRng exhausted after ${outcomes.length} draws`);
    return o ? 0 : 0.999999; // 0 wins for any winProb > 0; 0.999999 loses for any winProb < 0.999999
  };
  return Object.assign(rng, { draws: () => i });
}

/** Wraps an RNG and counts draws. */
export function countingRng(inner: Rng): Rng & { draws: () => number } {
  let n = 0;
  const rng = () => {
    n++;
    return inner();
  };
  return Object.assign(rng, { draws: () => n });
}

export const W = true;
export const L = false;

export function sessionConfig(overrides: Partial<SessionConfig> = {}): SessionConfig {
  return {
    startBankroll: 1000,
    baseBet: 100,
    tableMin: 1,
    tableMax: null,
    stopWin: null,
    stopLoss: null,
    maxRounds: 1000,
    insufficientFunds: "stop",
    ...overrides,
  };
}

/** Win/loss sequence of a session, recovered from its recorded path (stride 1). */
export function outcomesFromPath(r: SessionResult | SamplePath): boolean[] {
  const path = "bankroll" in r ? r : r.path;
  if (!path) throw new Error("session was run without recordPath");
  return deltasFromPath(path).map((d) => d > 0);
}

/** Bankroll change per round from a stride-1 path. For even money, |delta| = the placed bet. */
export function deltasFromPath(path: SamplePath): number[] {
  const b = path.bankroll;
  const out: number[] = [];
  for (let k = 1; k < b.length; k++) out.push(b[k]! - b[k - 1]!);
  return out;
}

/** Deep-freezes a plain object so any mutation inside a strategy throws (ES modules are strict). */
export function deepFreeze<T>(o: T): T {
  if (o !== null && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

/**
 * Feeds a win/loss script straight to a strategy (no runner, no table rules) and returns
 * the bet it asks for before each round, plus one final bet after the script.
 */
export function betSequence(strategy: AnyStrategy, config: StrategyConfig, outcomes: readonly boolean[], baseBet = 100): (number | "stop")[] {
  const ctx = (round: number) => deepFreeze({ bankroll: 1_000_000_000, baseBet, round, lastBet: null });
  let state = strategy.init(deepFreeze({ ...config }), ctx(0));
  const bets: (number | "stop")[] = [];
  outcomes.forEach((won, round) => {
    bets.push(strategy.nextBet(state, ctx(round)));
    state = strategy.update(state, won, ctx(round + 1));
  });
  bets.push(strategy.nextBet(state, ctx(outcomes.length)));
  return bets;
}

/**
 * Purity check: deep-frozen config, state and ctx, snapshots compared before and after
 * every call over a mixed script. A mutation either throws (frozen) or changes a snapshot.
 */
export function expectPure(strategy: AnyStrategy, config: StrategyConfig): void {
  const cfg = deepFreeze(structuredClone(config));
  const cfgSnap = JSON.stringify(cfg);
  const ctx = deepFreeze({ bankroll: 100_000, baseBet: 100, round: 0, lastBet: 100 });
  let state = deepFreeze(strategy.init(cfg, ctx));
  for (const won of [L, L, L, W, W, L, W, W, W, W, L]) {
    const snap = JSON.stringify(state);
    strategy.nextBet(state, ctx);
    const next = deepFreeze(strategy.update(state, won, ctx));
    expect(JSON.stringify(state)).toBe(snap);
    state = next;
  }
  expect(JSON.stringify(cfg)).toBe(cfgSnap);
}

/**
 * THE fixed invariant scenario, shared by every strategy. Money in cents:
 * $1,000 bankroll, $5 base, table $1-$250, stopWin $1,500, stopLoss floor $500,
 * 1000 max rounds, insufficientFunds "stop", 20,000 sessions.
 */
export const INVARIANT_SCENARIO: SessionConfig = sessionConfig({
  startBankroll: 100_000,
  baseBet: 500,
  tableMin: 100,
  tableMax: 25_000,
  stopWin: 150_000,
  stopLoss: 50_000,
  maxRounds: 1000,
  insufficientFunds: "stop",
});
export const INVARIANT_SESSIONS = 20_000;

/**
 * Declares the EV-per-$-wagered invariant tests for a strategy: within 4 SE of -edge on
 * European roulette and within 4 SE of 0 on a fair coin, stops ON. SE comes from the samples.
 */
export function describeEvInvariant(strategy: AnyStrategy, config: StrategyConfig): void {
  const games: [Game, number][] = [
    [GAME_PRESETS.find((g) => g.id === "european")!, 101],
    [GAME_PRESETS.find((g) => g.id === "fairCoin")!, 202],
  ];
  describe(`${strategy.id}: EV per $ wagered invariant (shared scenario, stops ON)`, () => {
    for (const [game, master] of games) {
      it(`${game.id}: within 4 SE of ${(-edge(game)).toFixed(6)}`, () => {
        const results: SessionResult[] = [];
        for (let i = 0; i < INVARIANT_SESSIONS; i++) {
          results.push(runSession(game, strategy, config, INVARIANT_SCENARIO, sessionSeed(master, i)));
        }
        const { ev, se } = evPerWageredWithSE(results, INVARIANT_SCENARIO.startBankroll);
        const expected = -edge(game);
        const z = (ev - expected) / se;
        console.log(`[invariant] ${strategy.id} ${JSON.stringify(config)} ${game.id}: measured=${ev.toFixed(6)} expected=${expected.toFixed(6)} SE=${se.toFixed(6)} z=${z.toFixed(2)}`);
        expect(Math.abs(ev - expected)).toBeLessThan(4 * se);
      });
    }
  });
}

/**
 * Ratio estimator R = sum(profit) / sum(wagered) and its delta-method standard error,
 * computed directly from per-session samples.
 */
export function evPerWageredWithSE(results: readonly SessionResult[], start: number): { ev: number; se: number } {
  const n = results.length;
  let sp = 0;
  let sw = 0;
  for (const r of results) {
    sp += r.finalBankroll - start;
    sw += r.totalWagered;
  }
  const ev = sp / sw;
  let ss = 0;
  for (const r of results) {
    const d = r.finalBankroll - start - ev * r.totalWagered;
    ss += d * d;
  }
  const meanW = sw / n;
  const se = Math.sqrt(ss / (n - 1) / n) / meanW;
  return { ev, se };
}
