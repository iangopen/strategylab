export const HISTOGRAM_BINS = 50;

export interface SharedHistogram {
  /** bins + 1 edges, shared by every strategy in the run. Money in cents. */
  edges: Float64Array;
  /** One counts array per input column, in input order. */
  counts: Uint32Array[];
}

/**
 * Histograms of several columns over ONE set of equal-width bins spanning [min, max] across ALL
 * columns (never per-column bins: different bins make side-by-side histograms lie).
 * Bins are [e_i, e_{i+1}) except the last, which includes max. If every value is identical,
 * the range is widened to [v - 1, v + 1] cents so the bins have nonzero width.
 */
export function sharedHistogram(columns: readonly { values: Float64Array; count: number }[], bins = HISTOGRAM_BINS): SharedHistogram {
  let lo = Infinity;
  let hi = -Infinity;
  for (const { values, count } of columns) {
    for (let i = 0; i < count; i++) {
      const x = values[i]!;
      if (x < lo) lo = x;
      if (x > hi) hi = x;
    }
  }
  if (!Number.isFinite(lo)) {
    lo = 0;
    hi = 1;
  } else if (lo === hi) {
    lo -= 1;
    hi += 1;
  }

  const width = (hi - lo) / bins;
  const edges = new Float64Array(bins + 1);
  for (let i = 0; i <= bins; i++) edges[i] = lo + i * width;
  edges[bins] = hi;

  const counts = columns.map(({ values, count }) => {
    const c = new Uint32Array(bins);
    for (let i = 0; i < count; i++) {
      const b = Math.min(bins - 1, Math.floor((values[i]! - lo) / width));
      c[b]!++;
    }
    return c;
  });
  return { edges, counts };
}
