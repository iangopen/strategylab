// Test-only helpers. Not imported by production code.
import { describe, expect, it } from "vitest";
import { edge, GAME_PRESETS, type Game } from "./games";
import { sessionSeed, type Rng } from "./rng";
import { runSession } from "./runner";
import type { SportsInput } from "./odds";
import type { RunContext } from "./stats/types";
import type { AnyStrategy, RoundResult, StrategyConfig, StrategyContext } from "./strategies/types";
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
/** A push in a betSequence script: the round is played but update is NOT called (as in the runner). */
export const P = "push" as const;
export type ScriptStep = boolean | typeof P;

/** The RoundResult a binary game gives for a win or a loss at bet `bet` (profit = bet × net, exact). */
export function binaryResult(won: boolean, bet: number, netPayout = 1): RoundResult {
  return won ? { kind: "win", outcomeIndex: 0, profit: bet * netPayout } : { kind: "loss", outcomeIndex: 1, profit: -bet };
}

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

/** Read-only game view for ctx fixtures. Even money by default; pass a payout for Kelly/Oscar tests. */
export function gameView(netPayout = 1, winProb = 0.5): StrategyContext["game"] {
  return { winProb, netPayout, edge: 1 - winProb * (1 + netPayout), outcomes: [{ prob: winProb, net: netPayout }, { prob: 1 - winProb, net: -1 }] };
}

/**
 * Feeds a win/loss script straight to a strategy (no runner, no table rules) and returns
 * the bet it asks for before each round, plus one final bet after the script. `lastBet` in the
 * post-round ctx is the bet the strategy just returned (no table rules here), so strategies that
 * track the placed bet (Oscar's Grind) work; `game` lets Kelly/Oscar see a non-even payout.
 */
export function betSequence(
  strategy: AnyStrategy,
  config: StrategyConfig,
  outcomes: readonly ScriptStep[],
  baseBet = 100,
  game: StrategyContext["game"] = gameView(),
): (number | "stop")[] {
  let lastBet: number | null = null;
  const ctx = (round: number) => deepFreeze({ bankroll: 1_000_000_000, baseBet, round, lastBet, game });
  let state = strategy.init(deepFreeze({ ...config }), ctx(0));
  const bets: (number | "stop")[] = [];
  outcomes.forEach((won, round) => {
    const bet = strategy.nextBet(state, ctx(round));
    bets.push(bet);
    if (typeof bet === "number") lastBet = bet;
    // A push leaves state untouched (the runner does not call update); W / L feed the round's result.
    if (won !== P) state = strategy.update(state, binaryResult(won, lastBet ?? 0, game.netPayout), ctx(round + 1));
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
  const ctx = deepFreeze({ bankroll: 100_000, baseBet: 100, round: 0, lastBet: 100, game: gameView(1.2) });
  let state = deepFreeze(strategy.init(cfg, ctx));
  for (const won of [L, L, L, W, W, L, W, W, W, W, L]) {
    const snap = JSON.stringify(state);
    strategy.nextBet(state, ctx);
    const next = deepFreeze(strategy.update(state, deepFreeze(binaryResult(won, 100, 1.2)), ctx));
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

/** The session 11 regression scenario: Flat on this market at the invariant scenario, 100k sessions, this seed. */
export const REGRESSION_MARKET: SportsInput = { mode: "market", format: "american", sideA: -110, sideB: -110, side: "a", estimate: 0.5 };
export const REGRESSION_SESSIONS = 100_000;
export const REGRESSION_MASTER = 1110;

/**
 * Declares the EV-per-$-wagered invariant tests for a strategy: within 4 SE of -edge on
 * European roulette and within 4 SE of 0 on a fair coin, stops ON. SE comes from the samples.
 */
export function describeEvInvariant(strategy: AnyStrategy, config: StrategyConfig): void {
  const games: [Game, number][] = [
    [GAME_PRESETS.find((g) => g.id === "european")!, 101],
    [GAME_PRESETS.find((g) => g.id === "fairCoin")!, 202],
    // A POSITIVE-edge game (edge = -0.10, player edge +10%): the core truth is sign-agnostic, so
    // EV per $ wagered must equal -edge = +0.10 here too. Testing only negative edges hides sign bugs.
    [{ id: "posEdge", name: "Positive edge (p=0.55, even money)", winProb: 0.55, netPayout: 1 }, 303],
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

/** A RunContext for hand-built accumulators: European roulette unless another game is given. */
export function testCtx(nSessions: number, start: number, overrides: Partial<SessionConfig> = {}, game: Game = GAME_PRESETS.find((g) => g.id === "european")!): RunContext {
  return { game, edge: edge(game), config: sessionConfig({ startBankroll: start, ...overrides }), nSessions };
}
