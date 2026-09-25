// Same-luck replay: re-simulates ONE session index for every strategy in a run, from its seed.
// Paths are NEVER stored during runMonteCarlo for this; replay recomputes them on demand.
// Uses only the existing runSession (no runner or montecarlo changes).
import { MinMaxDownsampler } from "./downsample";
import { isBinary, outcomesOf, type AnyGame } from "./games";
import type { StrategySpec } from "./montecarlo";
import { sessionSeed } from "./rng";
import { assertValidSetup, runSession } from "./runner";
import { validateStrategyConfig } from "./strategies/validate";
import type { EndReason, RoundHook, SamplePath, SessionConfig } from "./types";

/** At or below this maxRounds, replay records full paths (recordPath); above it, it streams through the downsampler. */
export const REPLAY_FULL_MAX_ROUNDS = 5000;
/** Win/loss strip buckets when the replay is downsampled. */
export const REPLAY_STRIP_BUCKETS = 500;

export interface ReplayStrategy {
  strategyId: string;
  endReason: EndReason;
  rounds: number;
  finalBankroll: number;
  /** Bankroll after each round (round 0 = start). Full path, or min/max downsampled above 5,000 rounds. */
  bankroll: SamplePath;
  /** Bet placed going into round r+1, at x = r (r = rounds already played). Same representation as bankroll. */
  bets: SamplePath;
}

/**
 * The ONE outcome strip (identical for every strategy by CRN), spanning the longest strategy. `wins` is
 * the win/lose view (binary games draw only this); `outcomes` holds each round's outcome index and
 * `levelSums` each bucket's summed outcome level (Replay.outcomeLevel), for multi-outcome games.
 */
export type ReplayStrip =
  | { kind: "rounds"; wins: Uint8Array; outcomes: Uint8Array } // wins[r] = 1 if round r+1 was won; outcomes[r] = its outcome index
  | { kind: "buckets"; bucketRounds: number; wins: Uint32Array; counts: Uint32Array; levelSums: Float64Array };

/** One level of the strip, lowest net first: its label and whether it is a push (net 0). */
export interface StripLevel {
  label: string;
  push: boolean;
}

export interface Replay {
  session: number;
  seed: number;
  maxRounds: number;
  downsampled: boolean;
  strategies: ReplayStrategy[];
  strip: ReplayStrip;
  /** True for a win/lose game (the strip is drawn as won / lost, as before session 13). */
  binary: boolean;
  /** Strip levels, lowest net first (bar height = level). */
  levels: StripLevel[];
  /** outcomeLevel[k] = the level of outcome k (its rank by net, ties sharing a level). */
  outcomeLevel: number[];
}

/** Outcome levels by net, lowest first (equal nets share a level), with a label per level. */
export function stripLevels(game: AnyGame): { levels: StripLevel[]; outcomeLevel: number[] } {
  const outcomes = outcomesOf(game);
  const nets = [...new Set(outcomes.map((o) => o.net))].sort((a, b) => a - b);
  const levels = nets.map((net): StripLevel => {
    const labels = outcomes.flatMap((o, k) => (o.net === net ? [o.label ?? `Outcome ${k + 1} (returns ${Number((1 + o.net).toPrecision(4))}x)`] : []));
    return { label: [...new Set(labels)].join(" / "), push: net === 0 };
  });
  return { levels, outcomeLevel: outcomes.map((o) => nets.indexOf(o.net)) };
}

export function replaySession(game: AnyGame, specs: readonly StrategySpec[], config: SessionConfig, masterSeed: number, session: number): Replay {
  assertValidSetup(game, config);
  if (!Number.isInteger(session) || session < 0) throw new Error("session must be a non-negative integer");
  for (const s of specs) {
    const errors = validateStrategyConfig(s.strategy, s.config);
    if (Object.keys(errors).length > 0) throw new Error(`Invalid config for "${s.strategy.id}": ${JSON.stringify(errors)}`);
  }
  const seed = sessionSeed(masterSeed, session);
  const downsampled = config.maxRounds > REPLAY_FULL_MAX_ROUNDS;
  const bucketRounds = Math.ceil(config.maxRounds / REPLAY_STRIP_BUCKETS);

  const { levels, outcomeLevel } = stripLevels(game);
  let longest = -1;
  let strip: ReplayStrip = { kind: "rounds", wins: new Uint8Array(0), outcomes: new Uint8Array(0) };

  const strategies = specs.map(({ strategy, config: strategyConfig }): ReplayStrategy => {
    if (!downsampled) {
      const betX: number[] = [];
      const betY: number[] = [];
      const wins: number[] = [];
      const outcomes: number[] = [];
      // The runner's per-round hook sees EVERY resolved round (pushes included; update does not).
      const onRound: RoundHook = (r, bet, result) => {
        betX.push(r);
        betY.push(bet);
        wins.push(result.kind === "win" ? 1 : 0);
        outcomes.push(result.outcomeIndex);
      };
      const res = runSession(game, strategy, strategyConfig, config, seed, { recordPath: true, onRound });
      if (res.rounds > longest) {
        longest = res.rounds;
        strip = { kind: "rounds", wins: Uint8Array.from(wins), outcomes: Uint8Array.from(outcomes) };
      }
      return { strategyId: strategy.id, endReason: res.endReason, rounds: res.rounds, finalBankroll: res.finalBankroll, bankroll: res.path!, bets: { rounds: betX, bankroll: betY } };
    }

    // Long sessions: stream bankroll AND bets through the same downsampler that produces stored sample paths.
    const bankDs = new MinMaxDownsampler(config.maxRounds);
    const betDs = new MinMaxDownsampler(config.maxRounds);
    const bw = new Uint32Array(REPLAY_STRIP_BUCKETS);
    const bc = new Uint32Array(REPLAY_STRIP_BUCKETS);
    const bl = new Float64Array(REPLAY_STRIP_BUCKETS);
    const onRound: RoundHook = (r, bet, result) => {
      betDs.observer(r, bet);
      const b = Math.min(REPLAY_STRIP_BUCKETS - 1, Math.floor(r / bucketRounds));
      bc[b]!++;
      if (result.kind === "win") bw[b]!++;
      bl[b]! += outcomeLevel[result.outcomeIndex]!;
    };
    const res = runSession(game, strategy, strategyConfig, config, seed, { observer: bankDs.observer, onRound });
    if (res.rounds > longest) {
      longest = res.rounds;
      strip = { kind: "buckets", bucketRounds, wins: bw, counts: bc, levelSums: bl };
    }
    const bets = res.rounds > 0 ? betDs.result() : { rounds: [], bankroll: [] };
    return { strategyId: strategy.id, endReason: res.endReason, rounds: res.rounds, finalBankroll: res.finalBankroll, bankroll: bankDs.result(), bets };
  });

  return { session, seed, maxRounds: config.maxRounds, downsampled, strategies, strip, binary: isBinary(game), levels, outcomeLevel };
}

/** Typed-array buffers in a replay, for Comlink.transfer. */
export function replayTransferables(r: Replay): ArrayBuffer[] {
  return r.strip.kind === "rounds"
    ? [r.strip.wins.buffer as ArrayBuffer, r.strip.outcomes.buffer as ArrayBuffer]
    : [r.strip.wins.buffer as ArrayBuffer, r.strip.counts.buffer as ArrayBuffer, r.strip.levelSums.buffer as ArrayBuffer];
}
