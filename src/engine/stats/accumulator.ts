import { END_REASONS, type EndReason, type SessionResult } from "../types";
import { sortedCopy } from "./quantile";

/** Per-session columns kept for exact percentiles. One number per session each. */
export type ColumnKey = "finals" | "maxDrawdowns" | "longestStreaks";

/**
 * Single-pass summary of all sessions for one strategy: running sums plus one Float64Array
 * per ColumnKey (one number per session). Never holds paths. Money in cents.
 * Lives only inside runMonteCarlo: the columns never leave the worker.
 */
export interface Accumulator {
  readonly startBankroll: number;
  count: number;
  sumFinal: number;
  sumWagered: number;
  sumRounds: number;
  /** Sums of squares / cross products of profit (final - start) and wagered, for SEs. */
  sumProfitSq: number;
  sumWageredSq: number;
  sumProfitWagered: number;
  endReasons: Record<EndReason, number>;
  /** Per-session columns, in session order. Length = capacity; the first `count` are filled. */
  readonly finals: Float64Array;
  readonly maxDrawdowns: Float64Array;
  readonly longestStreaks: Float64Array;
  /** Sorted copies, built at most once per column (see sortedColumn). */
  sortedCache: Partial<Record<ColumnKey, Float64Array>>;
}

export function emptyEndReasonCounts(): Record<EndReason, number> {
  const counts = {} as Record<EndReason, number>;
  for (const r of END_REASONS) counts[r] = 0;
  return counts;
}

export function createAccumulator(capacity: number, startBankroll: number): Accumulator {
  return {
    startBankroll,
    count: 0,
    sumFinal: 0,
    sumWagered: 0,
    sumRounds: 0,
    sumProfitSq: 0,
    sumWageredSq: 0,
    sumProfitWagered: 0,
    endReasons: emptyEndReasonCounts(),
    finals: new Float64Array(capacity),
    maxDrawdowns: new Float64Array(capacity),
    longestStreaks: new Float64Array(capacity),
    sortedCache: {},
  };
}

/** Adds one session. Mutates the accumulator (it is a builder, owned by runMonteCarlo). */
export function addSession(acc: Accumulator, r: SessionResult): void {
  if (acc.count >= acc.finals.length) throw new Error("Accumulator capacity exceeded");
  const profit = r.finalBankroll - acc.startBankroll;
  const i = acc.count;
  acc.finals[i] = r.finalBankroll;
  acc.maxDrawdowns[i] = r.maxDrawdown;
  acc.longestStreaks[i] = r.longestLosingStreak;
  acc.count++;
  acc.sumFinal += r.finalBankroll;
  acc.sumWagered += r.totalWagered;
  acc.sumRounds += r.rounds;
  acc.sumProfitSq += profit * profit;
  acc.sumWageredSq += r.totalWagered * r.totalWagered;
  acc.sumProfitWagered += profit * r.totalWagered;
  acc.endReasons[r.endReason]++;
  if (acc.sortedCache.finals || acc.sortedCache.maxDrawdowns || acc.sortedCache.longestStreaks) acc.sortedCache = {};
}

/** Ascending copy of a column's filled part. Sorted once per column, then reused by every stat. */
export function sortedColumn(acc: Accumulator, key: ColumnKey): Float64Array {
  let s = acc.sortedCache[key];
  if (!s) {
    s = sortedCopy(acc[key], acc.count);
    acc.sortedCache[key] = s;
  }
  return s;
}
