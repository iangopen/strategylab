// THE percentile definition. Every percentile in the engine goes through quantileSorted.

/** Ascending, numeric sorted copy of the first `count` values. The input is not modified. */
export function sortedCopy(column: Float64Array, count = column.length): Float64Array {
  return column.slice(0, count).sort(); // TypedArray sort is numeric, not lexicographic
}

/**
 * Type-7 quantile (numpy's default, R's default): h = (n - 1) p, linear interpolation
 * between the neighbouring order statistics. `sorted` must be ascending. NaN if empty.
 */
export function quantileSorted(sorted: ArrayLike<number>, p: number): number {
  const n = sorted.length;
  if (n === 0 || !(p >= 0 && p <= 1)) return NaN;
  const h = (n - 1) * p;
  const lo = Math.floor(h);
  const a = sorted[lo]!;
  if (lo + 1 >= n) return a;
  return a + (h - lo) * (sorted[lo + 1]! - a);
}
