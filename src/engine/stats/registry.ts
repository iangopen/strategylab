import { END_REASONS, type EndReason } from "../types";
import { sortedColumn, type Accumulator } from "./accumulator";
import { quantileSorted } from "./quantile";
import type { StatDef } from "./types";

/** EV per $ wagered = (meanFinal - start) / meanTotalWagered. */
export function evPerWagered(acc: Accumulator): number {
  if (acc.count === 0 || acc.sumWagered === 0) return NaN;
  return (acc.sumFinal / acc.count - acc.startBankroll) / (acc.sumWagered / acc.count);
}

/**
 * Delta-method standard error of evPerWagered (a ratio estimator). Not registered as a
 * row yet (the statistics session adds it); exported so tests and later stats can use it.
 */
export function evPerWageredSE(acc: Accumulator): number {
  const n = acc.count;
  if (n < 2 || acc.sumWagered === 0) return NaN;
  const r = evPerWagered(acc);
  const ss = acc.sumProfitSq - 2 * r * acc.sumProfitWagered + r * r * acc.sumWageredSq;
  return Math.sqrt(Math.max(0, ss) / (n - 1) / n) / (acc.sumWagered / n);
}

function median(acc: Accumulator): number {
  return quantileSorted(sortedColumn(acc, "finals"), 0.5);
}

const mean = (sum: number, acc: Accumulator) => (acc.count === 0 ? NaN : sum / acc.count);

const END_REASON_LABELS: Record<EndReason, string> = {
  ruin: "Ended: ruin (below table min)",
  insufficientFunds: "Ended: couldn't cover next bet",
  stopWin: "Ended: reached win target",
  stopLoss: "Ended: reached loss floor",
  maxRounds: "Ended: max rounds",
  strategyStop: "Ended: strategy stopped",
};

// The ONE place stats are registered. The results table renders from this list, in order.
export const STATS: readonly StatDef[] = [
  { id: "evPerWagered", label: "EV per $ wagered", format: "pct", emphasis: true, compute: evPerWagered },
  { id: "meanFinal", label: "Mean final bankroll", format: "money", compute: (a) => mean(a.sumFinal, a) },
  { id: "medianFinal", label: "Median final bankroll", format: "money", compute: median },
  { id: "meanWagered", label: "Mean total wagered", format: "money", compute: (a) => mean(a.sumWagered, a) },
  { id: "meanRounds", label: "Mean rounds played", format: "ratio", compute: (a) => mean(a.sumRounds, a) },
  ...END_REASONS.map((r): StatDef => ({
    id: `end_${r}`,
    label: END_REASON_LABELS[r],
    format: "pct",
    compute: (a) => (a.count === 0 ? NaN : a.endReasons[r] / a.count),
  })),
];
