// Paired comparison of two strategies in ONE run.
//
// Why paired: runMonteCarlo gives session i the same seed for every strategy (common random numbers),
// so session i of strategy A and session i of strategy B faced the same outcome sequence. Their results
// are strongly correlated, and that shared luck cancels in the per-session DIFFERENCE. Comparing the
// two strategies' separate intervals (the old "do they overlap" check) throws the pairing away: it
// behaves as if the luck were independent, so its error bar on the difference is far too wide.
//
// Why a paired t-interval and not a bootstrap: n is the session count (thousands and up; nothing is
// compared below MIN_COMPARE_SESSIONS), the statistic is a mean of n per-session differences, and the
// t-interval is one O(n) pass with no extra random numbers, so the verdict is a pure function of the
// run. A bootstrap would cost (resamples × n) per pair inside the worker and would need its own seeded
// stream, for the same answer at these sample sizes. Measured false-"clear" rates are in src/report/comparison.stats.test.ts.
//
// EV per $ wagered is a RATIO of sums (profit / wagered), not a per-session mean, so its per-session
// "value" is the delta-method (linearised) term e_i = (profit_i − R × wagered_i) / meanWagered: the
// same linearisation evPerWageredSE uses for one strategy. The paired difference is d_i = eA_i − eB_i;
// its mean is 0 by construction (R is the point estimate), and its spread gives the SE of RA − RB.
import type { Accumulator } from "./accumulator";
import { evPerWagered } from "./registry";

/** Sufficient statistics for comparing strategies `a` and `b` (indices into the run, a < b) over the same sessions. */
export interface PairedComparison {
  a: number;
  b: number;
  /** Paired sessions. */
  n: number;
  /** EV per $ wagered of a minus b; NaN when either strategy placed no bets. */
  evDiff: number;
  /** Standard error of evDiff from the per-session paired differences; NaN when evDiff is, or n < 2. */
  evDiffSE: number;
  /** Sessions that went bust under a but not b, and under b but not a (the discordant pairs). */
  bustOnlyA: number;
  bustOnlyB: number;
}

export function pairedComparison(accA: Accumulator, accB: Accumulator, a: number, b: number): PairedComparison {
  if (accA.count !== accB.count) throw new Error("Paired comparison needs the same sessions for both strategies");
  const n = accA.count;
  let bustOnlyA = 0;
  let bustOnlyB = 0;
  for (let i = 0; i < n; i++) {
    const bustA = !Number.isNaN(accA.bustRounds[i]!);
    const bustB = !Number.isNaN(accB.bustRounds[i]!);
    if (bustA && !bustB) bustOnlyA++;
    else if (bustB && !bustA) bustOnlyB++;
  }

  const rA = evPerWagered(accA);
  const rB = evPerWagered(accB);
  let evDiffSE = NaN;
  if (n >= 2 && Number.isFinite(rA) && Number.isFinite(rB)) {
    const meanWA = accA.sumWagered / n;
    const meanWB = accB.sumWagered / n;
    let ss = 0;
    for (let i = 0; i < n; i++) {
      const eA = (accA.finals[i]! - accA.startBankroll - rA * accA.wagered[i]!) / meanWA;
      const eB = (accB.finals[i]! - accB.startBankroll - rB * accB.wagered[i]!) / meanWB;
      const d = eA - eB;
      ss += d * d;
    }
    evDiffSE = Math.sqrt(ss / (n - 1) / n);
  }
  return { a, b, n, evDiff: rA - rB, evDiffSE, bustOnlyA, bustOnlyB };
}

/** Every pair (a < b) of the run's strategies, in order. Empty for a single strategy. */
export function pairedComparisons(accs: readonly Accumulator[]): PairedComparison[] {
  const out: PairedComparison[] = [];
  for (let a = 0; a < accs.length; a++) for (let b = a + 1; b < accs.length; b++) out.push(pairedComparison(accs[a]!, accs[b]!, a, b));
  return out;
}
