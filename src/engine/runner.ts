import type { Game } from "./games";
import { edge, validateGame } from "./games";
import { mulberry32, type Rng } from "./rng";
import type { AnyStrategy, StrategyConfig, StrategyContext } from "./strategies/types";
import type { EndReason, RunOptions, SamplePath, SessionConfig, SessionResult } from "./types";
import { validateSessionConfig } from "./types";

/** Throws if the game or session config is invalid. */
export function assertValidSetup(game: Game, config: SessionConfig): void {
  const errors = [...validateGame(game), ...validateSessionConfig(config)];
  if (errors.length > 0) throw new Error(`Invalid setup: ${errors.join(" ")}`);
}

/**
 * Plays one session from a seed. Session i of every strategy gets the same seed,
 * so it sees the same outcome sequence (common random numbers).
 */
export function runSession(
  game: Game,
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
 *   7. exactly ONE uniform draw resolves the round
 * Steps 1-6 never draw, so a session that ends early leaves the RNG untouched.
 *
 * A win pays whole cents with a per-session sub-cent carry: owed = bet × netPayout + carry,
 * paid = Math.round(owed), carry = owed - paid. |carry| <= 0.5, so over any session the total paid
 * is within half a cent of the exact total. For integer payouts the carry is always exactly 0.
 */
export function runSessionWithRng(
  game: Game,
  strategy: AnyStrategy,
  strategyConfig: StrategyConfig,
  config: SessionConfig,
  rng: Rng,
  opts: RunOptions = {},
): SessionResult {
  const { tableMin, tableMax, stopWin, stopLoss, maxRounds } = config;
  const path: SamplePath | undefined = opts.recordPath ? { rounds: [0], bankroll: [config.startBankroll] } : undefined;
  const observer = opts.observer;

  let bankroll = config.startBankroll;
  let rounds = 0;
  let totalWagered = 0;
  let peak = bankroll;
  let maxDrawdown = 0;
  let losingStreak = 0;
  let longestLosingStreak = 0;
  let lastBet: number | null = null;
  let carry = 0; // sub-cent remainder of past winnings; starts at 0 and never leaves this session

  // Read-only game view, computed once: strategies may size bets from the payout.
  const gameView = { winProb: game.winProb, netPayout: game.netPayout, edge: edge(game) };
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

    const won = rng() < game.winProb;
    if (won) {
      const owed = bet * game.netPayout + carry;
      const paid = Math.round(owed);
      carry = owed - paid;
      bankroll += paid;
    } else {
      bankroll -= bet;
    }
    rounds++;
    totalWagered += bet;
    lastBet = bet;
    // Post-round view: bankroll after resolution, lastBet = the bet just placed.
    state = strategy.update(state, won, ctx());

    if (bankroll > peak) peak = bankroll;
    if (peak - bankroll > maxDrawdown) maxDrawdown = peak - bankroll;
    if (won) {
      losingStreak = 0;
    } else if (++losingStreak > longestLosingStreak) {
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
