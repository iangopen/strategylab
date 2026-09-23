import type { RoundObserver, SamplePath } from "./types";

/** Buckets per path: first + 2 × 499 bucket extremes + final = at most 1000 points. */
export const DOWNSAMPLE_BUCKETS = 499;

/**
 * Streaming min/max downsampler for one session's bankroll path.
 * Rounds 1..maxRounds are split into equal buckets laid out over maxRounds; each bucket keeps
 * its min and max points (first occurrence), in round order. The first point (round 0) and the
 * final point are always kept, and so are the global peak and trough, which are always some
 * bucket's max/min (or round 0). Memory is fixed (~16 KB), independent of maxRounds; nothing
 * per-round is stored. Never plain stride: stride hides the exact round a session busts.
 */
export class MinMaxDownsampler {
  private readonly maxRounds: number;
  private readonly buckets: number;
  private readonly minR: Float64Array;
  private readonly minB: Float64Array;
  private readonly maxR: Float64Array;
  private readonly maxB: Float64Array;
  private readonly filled: Uint8Array;
  private firstB = NaN;
  private lastR = -1;
  private lastB = NaN;
  private peakR = 0;
  private peakB = -Infinity;
  private troughR = 0;
  private troughB = Infinity;

  constructor(maxRounds: number, buckets = DOWNSAMPLE_BUCKETS) {
    this.maxRounds = maxRounds;
    this.buckets = buckets;
    this.minR = new Float64Array(buckets);
    this.minB = new Float64Array(buckets);
    this.maxR = new Float64Array(buckets);
    this.maxB = new Float64Array(buckets);
    this.filled = new Uint8Array(buckets);
  }

  /** Pass as RunOptions.observer. Rounds must arrive in order, starting at 0. */
  readonly observer: RoundObserver = (round, bankroll) => {
    this.lastR = round;
    this.lastB = bankroll;
    if (bankroll > this.peakB) {
      this.peakB = bankroll;
      this.peakR = round;
    }
    if (bankroll < this.troughB) {
      this.troughB = bankroll;
      this.troughR = round;
    }
    if (round === 0) {
      this.firstB = bankroll;
      return;
    }
    const b = Math.min(this.buckets - 1, Math.floor(((round - 1) * this.buckets) / this.maxRounds));
    if (this.filled[b] === 0) {
      this.filled[b] = 1;
      this.minR[b] = this.maxR[b] = round;
      this.minB[b] = this.maxB[b] = bankroll;
    } else {
      if (bankroll < this.minB[b]!) {
        this.minB[b] = bankroll;
        this.minR[b] = round;
      }
      if (bankroll > this.maxB[b]!) {
        this.maxB[b] = bankroll;
        this.maxR[b] = round;
      }
    }
  };

  /** Kept points in round order, deduplicated. At most 2 × buckets + 2 points. */
  result(): SamplePath {
    const pts = new Map<number, number>();
    pts.set(0, this.firstB);
    for (let b = 0; b < this.buckets; b++) {
      if (this.filled[b] === 0) continue;
      pts.set(this.minR[b]!, this.minB[b]!);
      pts.set(this.maxR[b]!, this.maxB[b]!);
    }
    pts.set(this.peakR, this.peakB);
    pts.set(this.troughR, this.troughB);
    pts.set(this.lastR, this.lastB);
    const rounds = [...pts.keys()].sort((a, b) => a - b);
    return { rounds, bankroll: rounds.map((r) => pts.get(r)!) };
  }
}
