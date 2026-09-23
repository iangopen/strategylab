import { edge, type Game } from "./games";
import { sessionSeed } from "./rng";
import { assertValidSetup, runSession } from "./runner";
import { addSession, createAccumulator, type Accumulator } from "./stats/accumulator";
import { STATS } from "./stats/registry";
import type { RunContext, StatDef } from "./stats/types";
import type { AnyStrategy, StrategyConfig } from "./strategies/types";
import { validateStrategyConfig } from "./strategies/validate";
import type { EndReason, SamplePath, SessionConfig } from "./types";

export const MAX_SESSIONS = 1_000_000;
export const SAMPLE_PATH_COUNT = 50;
/** Sample paths are recorded with a stride so each has at most ~this many points. */
export const MAX_PATH_POINTS = 1000;

export interface StrategySpec {
  strategy: AnyStrategy;
  config: StrategyConfig;
}

export interface StrategyOutcome {
  strategyId: string;
  /** Keyed by StatDef.id. */
  stats: Record<string, number>;
  endReasonCounts: Record<EndReason, number>;
  /** Paths of sessions 0..SAMPLE_PATH_COUNT-1 (the same sessions for every strategy). */
  samplePaths: SamplePath[];
}

export interface MonteCarloResult {
  nSessions: number;
  masterSeed: number;
  perStrategy: StrategyOutcome[];
}

export interface MonteCarloOptions {
  /** Stats to compute. Defaults to the registry. */
  stats?: readonly StatDef[];
}

export type ProgressFn = (fraction: number) => void;

/**
 * Runs every strategy over the SAME session seeds: session i uses sessionSeed(masterSeed, i)
 * for all strategies, so they face identical outcome sequences.
 */
export function runMonteCarlo(
  game: Game,
  strategies: readonly StrategySpec[],
  config: SessionConfig,
  nSessions: number,
  masterSeed: number,
  onProgress?: ProgressFn,
  options: MonteCarloOptions = {},
): MonteCarloResult {
  assertValidSetup(game, config);
  if (!Number.isInteger(nSessions) || nSessions < 1 || nSessions > MAX_SESSIONS) {
    throw new Error(`nSessions must be an integer in 1..${MAX_SESSIONS}`);
  }
  if (!Number.isInteger(masterSeed) || masterSeed < 0 || masterSeed > 0xffffffff) {
    throw new Error("masterSeed must be an unsigned 32-bit integer");
  }
  if (strategies.length === 0) throw new Error("At least one strategy is required");
  for (const s of strategies) {
    const errors = validateStrategyConfig(s.strategy, s.config);
    if (Object.keys(errors).length > 0) throw new Error(`Invalid config for "${s.strategy.id}": ${JSON.stringify(errors)}`);
  }

  const stats = options.stats ?? STATS;
  const accs: Accumulator[] = strategies.map(() => createAccumulator(nSessions, config.startBankroll));
  const paths: SamplePath[][] = strategies.map(() => []);
  const pathStride = Math.ceil(config.maxRounds / MAX_PATH_POINTS);
  // EXTENSION POINT (statistics session): percentile bands over time need per-checkpoint
  // bankrolls for a subset of sessions (<= 2000 sessions, <= 200 checkpoints, early-ending
  // sessions carry their final bankroll forward). Collect them here, alongside samplePaths,
  // from the same runSession call. Histograms need only acc.finals.

  let lastReported = -1;
  for (let i = 0; i < nSessions; i++) {
    const seed = sessionSeed(masterSeed, i);
    const recordPath = i < SAMPLE_PATH_COUNT;
    for (let k = 0; k < strategies.length; k++) {
      const { strategy, config: strategyConfig } = strategies[k]!;
      const r = runSession(game, strategy, strategyConfig, config, seed, { recordPath, pathStride });
      addSession(accs[k]!, r);
      if (r.path) paths[k]!.push(r.path);
    }
    if (onProgress) {
      const step = Math.floor(((i + 1) * 50) / nSessions); // one step = 2%
      if (step > lastReported) {
        lastReported = step;
        onProgress((i + 1) / nSessions);
      }
    }
  }

  const ctx: RunContext = Object.freeze({ game: Object.freeze({ ...game }), edge: edge(game), config: Object.freeze({ ...config }), nSessions });
  return {
    nSessions,
    masterSeed,
    perStrategy: strategies.map((s, k) => {
      const acc = accs[k]!;
      const values: Record<string, number> = {};
      for (const stat of stats) values[stat.id] = stat.compute(acc, ctx);
      return { strategyId: s.strategy.id, stats: values, endReasonCounts: { ...acc.endReasons }, samplePaths: paths[k]! };
    }),
  };
}
