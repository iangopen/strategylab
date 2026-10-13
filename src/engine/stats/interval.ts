// Confidence intervals for proportions estimated from the sessions of a run.

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
