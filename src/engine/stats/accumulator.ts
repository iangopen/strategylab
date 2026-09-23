import { END_REASONS, type EndReason, type SessionResult } from "../types";

/**
 * Single-pass summary of all sessions for one strategy. Holds running sums and ONE
 * Float64Array of final bankrolls. Never holds paths. Money in cents.
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
  /** Final bankroll per session, in session order. Length = capacity; first `count` are filled. */
  readonly finals: Float64Array;
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
  };
}

/** Adds one session. Mutates the accumulator (it is a builder, owned by runMonteCarlo). */
export function addSession(acc: Accumulator, r: SessionResult): void {
  if (acc.count >= acc.finals.length) throw new Error("Accumulator capacity exceeded");
  const profit = r.finalBankroll - acc.startBankroll;
  acc.finals[acc.count] = r.finalBankroll;
  acc.count++;
  acc.sumFinal += r.finalBankroll;
  acc.sumWagered += r.totalWagered;
  acc.sumRounds += r.rounds;
  acc.sumProfitSq += profit * profit;
  acc.sumWageredSq += r.totalWagered * r.totalWagered;
  acc.sumProfitWagered += profit * r.totalWagered;
  acc.endReasons[r.endReason]++;
}
