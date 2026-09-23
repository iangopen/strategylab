import { MinMaxDownsampler } from "./downsample";
import { edge, type Game } from "./games";
import { sessionSeed } from "./rng";
import { assertValidSetup, runSession } from "./runner";
import { addSession, createAccumulator, type Accumulator } from "./stats/accumulator";
import { BAND_SESSIONS, BandRecorder, checkpointRounds, type Bands } from "./stats/bands";
import { sharedHistogram } from "./stats/histogram";
import { STATS } from "./stats/registry";
import type { RunContext, StatDef } from "./stats/types";
import type { AnyStrategy, StrategyConfig } from "./strategies/types";
import { validateStrategyConfig } from "./strategies/validate";
import type { EndReason, RoundObserver, SamplePath, SessionConfig } from "./types";

export const MAX_SESSIONS = 1_000_000;
export const SAMPLE_PATH_COUNT = 50;
/** Sample paths are min/max-downsampled (streaming) to at most this many points each. */
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
  /** Final-bankroll counts over the run's SHARED bins (MonteCarloResult.histogram.edges). */
  histogramCounts: Uint32Array;
  /** p5/p25/p50/p75/p95 bankroll at each checkpoint (MonteCarloResult.bands.rounds). */
  bands: Bands;
}

export interface MonteCarloResult {
  nSessions: number;
  masterSeed: number;
  perStrategy: StrategyOutcome[];
  /** ONE set of final-bankroll bin edges (cents) shared by every strategy in the run. */
  histogram: { edges: Float64Array };
  /** Checkpoint rounds (0 first) and the size of the band subset (first min(2000, n) sessions). */
  bands: { rounds: Float64Array; sessions: number };
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
  // Percentile bands: the first min(BAND_SESSIONS, n) session indices, the SAME for every strategy
  // (CRN), are observed round by round; only checkpoint values are kept, so memory does not
  // depend on maxRounds. Early-ending sessions carry their final bankroll forward.
  const bandSessions = Math.min(BAND_SESSIONS, nSessions);
  const bandRounds = checkpointRounds(config.maxRounds);
  const bandRecorders = strategies.map(() => new BandRecorder(bandRounds, bandSessions));

  let lastReported = -1;
  for (let i = 0; i < nSessions; i++) {
    const seed = sessionSeed(masterSeed, i);
    for (let k = 0; k < strategies.length; k++) {
      const { strategy, config: strategyConfig } = strategies[k]!;
      // Only band-subset sessions get an observer; the rest pay just a branch check per round.
      let observer: RoundObserver | undefined;
      let band: ReturnType<BandRecorder["observe"]> | undefined;
      let ds: MinMaxDownsampler | undefined;
      if (i < bandSessions) {
        band = bandRecorders[k]!.observe(i);
        if (i < SAMPLE_PATH_COUNT) {
          ds = new MinMaxDownsampler(config.maxRounds);
          const a = band.observer;
          const b = ds.observer;
          observer = (round, bankroll) => {
            a(round, bankroll);
            b(round, bankroll);
          };
        } else {
          observer = band.observer;
        }
      }
      const r = runSession(game, strategy, strategyConfig, config, seed, observer ? { observer } : {});
      band?.finish(r.finalBankroll);
      if (ds) paths[k]!.push(ds.result());
      addSession(accs[k]!, r);
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
  // After ALL strategies finish: one set of bins over [min, max] across every strategy.
  const histogram = sharedHistogram(accs.map((a) => ({ values: a.finals, count: a.count })));

  return {
    nSessions,
    masterSeed,
    histogram: { edges: histogram.edges },
    bands: { rounds: bandRounds, sessions: bandSessions },
    perStrategy: strategies.map((s, k) => {
      const acc = accs[k]!;
      const values: Record<string, number> = {};
      for (const stat of stats) values[stat.id] = stat.compute(acc, ctx);
      return {
        strategyId: s.strategy.id,
        stats: values,
        endReasonCounts: { ...acc.endReasons },
        samplePaths: paths[k]!,
        histogramCounts: histogram.counts[k]!,
        bands: bandRecorders[k]!.percentiles(),
      };
    }),
  };
}

/**
 * Every typed-array buffer in a result, each listed once, for Comlink.transfer. Only these
 * derived outputs leave the worker; the accumulator's per-session columns never do.
 */
export function resultTransferables(result: MonteCarloResult): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>([result.histogram.edges.buffer as ArrayBuffer, result.bands.rounds.buffer as ArrayBuffer]);
  for (const s of result.perStrategy) {
    buffers.add(s.histogramCounts.buffer as ArrayBuffer);
    for (const band of [s.bands.p5, s.bands.p25, s.bands.p50, s.bands.p75, s.bands.p95]) buffers.add(band.buffer as ArrayBuffer);
  }
  return [...buffers];
}
