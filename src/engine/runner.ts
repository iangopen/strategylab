import { edge, legacyView, outcomesOf, validateGame, type AnyGame, type Outcome } from "./games";
import { mulberry32, type Rng } from "./rng";
import type { AnyStrategy, RoundResult, StrategyConfig, StrategyContext } from "./strategies/types";
import type { EndReason, RunOptions, SamplePath, SessionConfig, SessionResult } from "./types";
import { validateSessionConfig } from "./types";

/** Throws if the game or session config is invalid. */
export function assertValidSetup(game: AnyGame, config: SessionConfig): void {
  const errors = [...validateGame(game), ...validateSessionConfig(config)];
  if (errors.length > 0) throw new Error(`Invalid setup: ${errors.join(" ")}`);
}

/** A game ready for the round loop: cumulative bounds (the last forced to exactly 1) and each outcome's net. */
interface CompiledGame {
  cum: Float64Array;
  net: Float64Array;
  outcomes: readonly Outcome[];
  view: StrategyContext["game"];
}

const compiled = new WeakMap<object, CompiledGame>();

/**
 * Compiles a game once (cached per game object). cum[k] = prob_0 + ... + prob_k, accumulated left to
 * right, with the LAST bound forced to exactly 1. For a binary game cum[0] = p, so "u < cum[0]" is
 * exactly the old "u < p".
 */
export function compileGame(game: AnyGame): CompiledGame {
  const hit = compiled.get(game);
  if (hit) return hit;
  const outcomes = outcomesOf(game);
  const n = outcomes.length;
  const cum = new Float64Array(n);
  const net = new Float64Array(n);
  let c = 0;
  for (let k = 0; k < n; k++) {
    c += outcomes[k]!.prob;
    cum[k] = c;
    net[k] = outcomes[k]!.net;
  }
  cum[n - 1] = 1;
  // Read-only game view, computed once: strategies may size bets from the payout.
  const view = Object.freeze({ ...legacyView(game), edge: edge(game), outcomes });
  const out = { cum, net, outcomes, view };
  compiled.set(game, out);
  return out;
}

/** Index of the outcome a uniform draw u in [0, 1) picks: the first k with u < cum[k]. */
export function outcomeIndex(cum: Float64Array, u: number): number {
  let k = 0;
  while (u >= cum[k]!) k++;
  return k;
}

/**
 * Plays one session from a seed. Session i of every strategy gets the same seed,
 * so it sees the same outcome sequence (common random numbers).
 */
export function runSession(
  game: AnyGame,
  strategy: AnyStrategy,
  strategyConfig: StrategyConfig,
  config: SessionConfig,
  seed: number,
  opts: RunOptions = {},
): SessionResult {
  assertValidSetup(game, config);
  return runSessionWithRng(game, strategy, strategyConfig, config, mulberry32(seed), opts);
}

/**
 * Core loop, with the RNG injected so tests can count draws. Callers must validate first.
 *
 * Each round, in this order:
 *   1. stopWin (bankroll >= target), then stopLoss (bankroll <= floor)
 *   2. ruin (bankroll < tableMin)
 *   3. maxRounds
 *   4. ask the strategy ("stop" -> strategyStop)
 *   5. round to whole cents, raise to tableMin, clamp to tableMax
 *   6. bet > bankroll -> "stop" ends with insufficientFunds, "allIn" bets the bankroll
 *   7. exactly ONE uniform draw picks the outcome (the first k with u < cum[k])
 * Steps 1-6 never draw, so a session that ends early leaves the RNG untouched.
 *
 * The outcome's exact profit is bet × net. A total loss (net = -1) costs exactly the bet and a push
 * (net = 0) moves nothing; neither touches the carry. Every other outcome pays whole cents with the
 * per-session sub-cent carry: owed = bet × net + carry, paid = Math.round(owed), carry = owed - paid.
 * |carry| <= 0.5, so over any session the total paid is within half a cent of the exact total. For a
 * binary game this is exactly the session 11 rule. On a push the strategy's update is NOT called and
 * the losing streak neither extends nor breaks.
 */
export function runSessionWithRng(
  game: AnyGame,
  strategy: AnyStrategy,
  strategyConfig: StrategyConfig,
  config: SessionConfig,
  rng: Rng,
  opts: RunOptions = {},
): SessionResult {
  const { tableMin, tableMax, stopWin, stopLoss, maxRounds } = config;
  const path: SamplePath | undefined = opts.recordPath ? { rounds: [0], bankroll: [config.startBankroll] } : undefined;
  const observer = opts.observer;
  const onRound = opts.onRound;

  let bankroll = config.startBankroll;
  let rounds = 0;
  let totalWagered = 0;
  let peak = bankroll;
  let maxDrawdown = 0;
  let losingStreak = 0;
  let longestLosingStreak = 0;
  let lastBet: number | null = null;
  let carry = 0; // sub-cent remainder of past winnings; starts at 0 and never leaves this session

  const { cum, net: nets, view: gameView } = compileGame(game);
  const ctx = (): StrategyContext => ({ bankroll, baseBet: config.baseBet, round: rounds, lastBet, game: gameView });
  let state = strategy.init(strategyConfig, ctx());
  let endReason: EndReason;
  if (observer !== undefined) observer(0, bankroll);

  for (;;) {
    if (stopWin !== null && bankroll >= stopWin) { endReason = "stopWin"; break; }
    if (stopLoss !== null && bankroll <= stopLoss) { endReason = "stopLoss"; break; }
    if (bankroll < tableMin) { endReason = "ruin"; break; }
    if (rounds >= maxRounds) { endReason = "maxRounds"; break; }

    const desired = strategy.nextBet(state, ctx());
    if (desired === "stop") { endReason = "strategyStop"; break; }
    if (!Number.isFinite(desired)) throw new Error(`Strategy "${strategy.id}" returned a non-finite bet: ${desired}`);

    let bet = Math.max(Math.round(desired), tableMin);
    if (tableMax !== null) bet = Math.min(bet, tableMax);
    if (bet > bankroll) {
      if (config.insufficientFunds === "stop") { endReason = "insufficientFunds"; break; }
      bet = bankroll; // all-in; bankroll >= tableMin here, so the bet is still legal
    }

    const k = outcomeIndex(cum, rng());
    const net = nets[k]!;
    if (net === -1) {
      bankroll -= bet; // total loss: exactly the stake, carry untouched
    } else if (net !== 0) {
      const owed = bet * net + carry;
      const paid = Math.round(owed);
      carry = owed - paid;
      bankroll += paid;
    } // net === 0: a push returns the stake; nothing moves
    rounds++;
    totalWagered += bet;
    lastBet = bet;
    // The round's EXACT profit (fractional cents); for binary games bet × n on a win, -bet on a loss.
    const result: RoundResult = { kind: net > 0 ? "win" : net < 0 ? "loss" : "push", outcomeIndex: k, profit: bet * net };
    // Post-round view: bankroll after resolution, lastBet = the bet just placed. Not called on a push.
    if (net !== 0) state = strategy.update(state, result, ctx());
    if (onRound !== undefined) onRound(rounds - 1, bet, result);

    if (bankroll > peak) peak = bankroll;
    if (peak - bankroll > maxDrawdown) maxDrawdown = peak - bankroll;
    if (net > 0) {
      losingStreak = 0;
    } else if (net < 0 && ++losingStreak > longestLosingStreak) {
      longestLosingStreak = losingStreak;
    }
    if (observer !== undefined) observer(rounds, bankroll);
    if (path) {
      path.rounds.push(rounds);
      path.bankroll.push(bankroll);
    }
  }

  const result: SessionResult = { finalBankroll: bankroll, rounds, totalWagered, peak, maxDrawdown, longestLosingStreak, endReason };
  if (path) result.path = path;
  return result;
}
