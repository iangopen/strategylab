// Confidence intervals for proportions estimated from the sessions of a run, and for the DIFFERENCE
// between two strategies (paired when they played the same sessions, independent otherwise).

export interface Bounds {
  low: number;
  high: number;
}

/**
 * Standard normal quantile (inverse CDF), Acklam's rational approximation: relative error below
 * 1.2e-9 over (0, 1). Needed because a family of comparisons uses a level other than 95%.
 */
export function normalQuantile(p: number): number {
  if (!(p > 0 && p < 1)) return p === 0 ? -Infinity : p === 1 ? Infinity : NaN;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239] as const;
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1] as const;
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783] as const;
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416] as const;
  const tail = (q: number) => (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  const pLow = 0.02425;
  if (p < pLow) return tail(Math.sqrt(-2 * Math.log(p)));
  if (p > 1 - pLow) return -tail(Math.sqrt(-2 * Math.log(1 - p)));
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/**
 * Student t quantile from the normal one (Cornish-Fisher expansion in 1/df, four terms). Accurate to
 * about 1e-3 or better for df >= 10 at the levels used here; callers require MIN_COMPARE_SESSIONS, so
 * df never gets small. For large df it is the normal quantile.
 */
export function tQuantile(p: number, df: number): number {
  const z = normalQuantile(p);
  if (!(df > 0) || !Number.isFinite(z)) return df > 0 ? z : NaN;
  const z3 = z ** 3;
  const z5 = z ** 5;
  const z7 = z ** 7;
  return z + (z3 + z) / (4 * df) + (5 * z5 + 16 * z3 + 3 * z) / (96 * df * df) + (3 * z7 + 19 * z5 + 17 * z3 - 15 * z) / (384 * df ** 3);
}

/** Below this many sessions no difference between strategies is judged: the normal-theory intervals are not trusted. */
export const MIN_COMPARE_SESSIONS = 30;

/**
 * The upper-tail probability point for a two-sided interval that keeps `level` across a FAMILY of
 * `comparisons` intervals (Bonferroni): each one is built at 1 − (1 − level) / comparisons.
 * With one comparison this is 0.975 for 95%.
 */
export function familyQuantilePoint(comparisons: number, level = 0.95): number {
  return 1 - (1 - level) / (2 * Math.max(1, comparisons));
}

/** estimate ± t(p, df) × se: the t-interval for a mean (or a difference of means) with a known SE and df. */
export function tInterval(estimate: number, se: number, df: number, p = 0.975): Bounds {
  if (!Number.isFinite(estimate) || !(se >= 0) || !(df > 0)) return { low: NaN, high: NaN };
  const half = tQuantile(p, df) * se;
  return { low: estimate - half, high: estimate + half };
}

/**
 * The t-interval a sample would give after ONE more observation `extra`: the sample has `n` values with
 * this mean and standard error (se = sd / sqrt(n)). Used as a stress test: "would the conclusion survive
 * one more session like this?" (see evDifference in report/takeaways.ts).
 */
export function tIntervalWithOneMore(mean: number, se: number, n: number, extra: number, p = 0.975): Bounds {
  if (!Number.isFinite(mean) || !(se >= 0) || !(n >= 2) || !Number.isFinite(extra)) return { low: NaN, high: NaN };
  const ss = se * se * n * (n - 1); // sum of squared deviations from the mean
  const N = n + 1;
  const d = extra - mean;
  const newMean = mean + d / N;
  const newSE = Math.sqrt((ss + (d * d * n) / N) / (N * (N - 1)));
  return tInterval(newMean, newSE, N - 1, p);
}

/**
 * Welch-Satterthwaite degrees of freedom for the difference of two INDEPENDENT means, from each
 * mean's standard error and sample size. No equal-variance assumption.
 */
export function welchDf(seA: number, seB: number, nA: number, nB: number): number {
  const va = seA * seA;
  const vb = seB * seB;
  const denom = (va * va) / (nA - 1) + (vb * vb) / (nB - 1);
  return denom > 0 ? ((va + vb) * (va + vb)) / denom : Math.min(nA, nB) - 1;
}

/**
 * Difference of two PAIRED proportions (the same n sessions under A and under B): pA − pB, with the
 * Bonett-Price (2012) adjusted Wald interval. Only the discordant sessions carry information: `onlyA`
 * sessions counted under A alone, `onlyB` under B alone (this is the McNemar table). The plain Wald
 * interval is badly anti-conservative when discordant counts are small (0 against 3 would be called a
 * difference); adding one to each discordant count and two to n fixes that in closed form.
 */
export function pairedProportionInterval(onlyA: number, onlyB: number, n: number, z = Z_95): Bounds & { diff: number } {
  if (!(n > 0) || !(onlyA >= 0) || !(onlyB >= 0) || onlyA + onlyB > n) return { diff: NaN, low: NaN, high: NaN };
  const pa = (onlyA + 1) / (n + 2);
  const pb = (onlyB + 1) / (n + 2);
  const center = pa - pb;
  const half = z * Math.sqrt((pa + pb - center * center) / (n + 2));
  return { diff: (onlyA - onlyB) / n, low: Math.max(-1, center - half), high: Math.min(1, center + half) };
}

/**
 * Difference of two INDEPENDENT proportions, pA − pB: Newcombe's (1998) hybrid score interval, built
 * from each proportion's Wilson interval (the squared distances to the bounds add, as variances do).
 */
export function independentProportionInterval(kA: number, nA: number, kB: number, nB: number, z = Z_95): Bounds & { diff: number } {
  const a = wilsonInterval(kA, nA, z);
  const b = wilsonInterval(kB, nB, z);
  const pa = kA / nA;
  const pb = kB / nB;
  const diff = pa - pb;
  return { diff, low: diff - Math.hypot(pa - a.low, b.high - pb), high: diff + Math.hypot(a.high - pa, pb - b.low) };
}

/** z for a two-sided 95% interval. */
export const Z_95 = 1.96;

/**
 * Wilson score interval for a binomial proportion: k "successes" in n sessions. Unlike the normal
 * approximation p ± z·sqrt(p(1 − p)/n), it stays inside [0, 1] and still has a non-zero upper bound
 * when k = 0 (and a lower bound below 1 when k = n). NaN bounds when n = 0 or the counts are invalid.
 */
export function wilsonInterval(k: number, n: number, z = Z_95): { low: number; high: number } {
  if (!(n > 0) || !(k >= 0) || k > n) return { low: NaN, high: NaN };
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  // At k = 0 (or k = n) center and half are equal in exact arithmetic; pin the bound exactly.
  return { low: k === 0 ? 0 : Math.max(0, center - half), high: k === n ? 1 : Math.min(1, center + half) };
}
