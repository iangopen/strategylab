import { END_REASONS, type EndReason } from "../types";
import { sortedColumn, type Accumulator, type ColumnKey } from "./accumulator";
import { quantileSorted } from "./quantile";
import type { RunContext, StatDef } from "./types";

/** EV per $ wagered = (meanFinal - start) / meanTotalWagered. */
export function evPerWagered(acc: Accumulator): number {
  if (acc.count === 0 || acc.sumWagered === 0) return NaN;
  return (acc.sumFinal / acc.count - acc.startBankroll) / (acc.sumWagered / acc.count);
}

/** Delta-method standard error of evPerWagered (a ratio estimator). */
export function evPerWageredSE(acc: Accumulator): number {
  const n = acc.count;
  if (n < 2 || acc.sumWagered === 0) return NaN;
  const r = evPerWagered(acc);
  const ss = acc.sumProfitSq - 2 * r * acc.sumProfitWagered + r * r * acc.sumWageredSq;
  return Math.sqrt(Math.max(0, ss) / (n - 1) / n) / (acc.sumWagered / n);
}

/** (measured - theory) / SE, where theory = -edge. NaN when the SE is 0 or undefined. */
export function evZ(acc: Accumulator, ctx: RunContext): number {
  const se = evPerWageredSE(acc);
  return se > 0 ? (evPerWagered(acc) + ctx.edge) / se : NaN;
}

const mean = (sum: number, acc: Accumulator) => (acc.count === 0 ? NaN : sum / acc.count);
const frac = (k: number, acc: Accumulator) => (acc.count === 0 ? NaN : k / acc.count);
const pct = (key: ColumnKey, p: number) => (acc: Accumulator) => quantileSorted(sortedColumn(acc, key), p);

function columnSum(acc: Accumulator, key: ColumnKey): number {
  const col = acc[key];
  let s = 0;
  for (let i = 0; i < acc.count; i++) s += col[i]!;
  return s;
}

/** Fraction of sessions ending strictly above the starting bankroll (final === start is NOT profit). */
function pProfit(acc: Accumulator): number {
  let k = 0;
  for (let i = 0; i < acc.count; i++) if (acc.finals[i]! > acc.startBankroll) k++;
  return frac(k, acc);
}

const END_REASON_LABELS: Record<EndReason, string> = {
  ruin: "Ended: ruin (below table min)",
  insufficientFunds: "Ended: couldn't cover next bet",
  stopWin: "Ended: reached win target",
  stopLoss: "Ended: reached loss floor",
  maxRounds: "Ended: max rounds",
  strategyStop: "Ended: strategy stopped",
};

// The ONE place stats are registered. The results table renders from this list, in THIS order.
// P(profit > 0) sits directly under the headline block: a high P(profit) next to a negative
// EV per $ is the core lesson.
export const STATS: readonly StatDef[] = [
  // Headline
  { id: "evPerWagered", label: "EV per $ wagered", format: "pct", emphasis: true, compute: evPerWagered },
  { id: "evSE", label: "SE of EV per $", format: "pct", compute: evPerWageredSE },
  { id: "evTheory", label: "Theoretical EV per $ (−edge)", format: "pct", compute: (_a, ctx) => -ctx.edge },
  { id: "evZ", label: "z vs theory", format: "ratio", compute: evZ },
  // Risk
  { id: "pProfit", label: "P(profit > 0)", format: "pct", compute: pProfit },
  { id: "pBust", label: "P(bust: ruin or couldn't cover bet)", format: "pct", compute: (a) => frac(a.endReasons.ruin + a.endReasons.insufficientFunds, a) },
  { id: "pHitWin", label: "P(hit win target)", format: "pct", compute: (a, ctx) => (ctx.config.stopWin === null ? NaN : frac(a.endReasons.stopWin, a)) },
  // Final bankroll
  { id: "finalP5", label: "Final bankroll p5", format: "money", compute: pct("finals", 0.05) },
  { id: "finalP25", label: "Final bankroll p25", format: "money", compute: pct("finals", 0.25) },
  { id: "medianFinal", label: "Final bankroll median", format: "money", compute: pct("finals", 0.5) },
  { id: "finalP75", label: "Final bankroll p75", format: "money", compute: pct("finals", 0.75) },
  { id: "finalP95", label: "Final bankroll p95", format: "money", compute: pct("finals", 0.95) },
  { id: "meanFinal", label: "Final bankroll mean", format: "money", compute: (a) => mean(a.sumFinal, a) },
  // Pain
  { id: "meanMaxDrawdown", label: "Mean max drawdown", format: "money", compute: (a) => mean(columnSum(a, "maxDrawdowns"), a) },
  { id: "p95MaxDrawdown", label: "p95 max drawdown", format: "money", compute: pct("maxDrawdowns", 0.95) },
  { id: "meanLongestStreak", label: "Mean longest losing streak", format: "ratio", compute: (a) => mean(columnSum(a, "longestStreaks"), a) },
  { id: "maxLongestStreak", label: "Max longest losing streak", format: "int", compute: pct("longestStreaks", 1) },
  // Volume
  { id: "meanWagered", label: "Mean total wagered", format: "money", compute: (a) => mean(a.sumWagered, a) },
  { id: "meanRounds", label: "Mean rounds played", format: "ratio", compute: (a) => mean(a.sumRounds, a) },
  // End reasons
  ...END_REASONS.map((r): StatDef => ({
    id: `end_${r}`,
    label: END_REASON_LABELS[r],
    format: "pct",
    compute: (a) => frac(a.endReasons[r], a),
  })),
];
