import type { RoundObserver } from "../types";
import { quantileSorted } from "./quantile";

/** Band subset: the first min(BAND_SESSIONS, nSessions) session indices, the SAME for every strategy. */
export const BAND_SESSIONS = 2000;
export const BAND_PERCENTILES = [0.05, 0.25, 0.5, 0.75, 0.95] as const;

export interface Bands {
  p5: Float64Array;
  p25: Float64Array;
  p50: Float64Array;
  p75: Float64Array;
  p95: Float64Array;
}

/**
 * Records bankroll at each checkpoint for a fixed subset of sessions, for one strategy. The checkpoint
 * rounds come from checkpointRounds (../checkpoints.ts) and may be unevenly spaced; any strictly
 * increasing list of rounds starting at 0 works. Memory: checkpoints × subset numbers (at most
 * 287 × 2,000 doubles, 4.6 MB), independent of maxRounds.
 * Sessions that end early carry their final bankroll forward to every later checkpoint.
 */
export class BandRecorder {
  private readonly rounds: Float64Array;
  private readonly sessions: number;
  private readonly values: Float64Array; // [checkpoint * sessions + session]
  private readonly nCp: number;

  constructor(rounds: Float64Array, sessions: number) {
    this.rounds = rounds;
    this.sessions = sessions;
    this.nCp = rounds.length;
    this.values = new Float64Array(this.nCp * sessions);
  }

  /**
   * Observer for session s. The returned `finish(finalBankroll)` must be called once the session ends;
   * it fills every checkpoint the session did not reach with its final bankroll.
   */
  observe(s: number): { observer: RoundObserver; finish: (finalBankroll: number) => void } {
    const { rounds, values, sessions, nCp } = this;
    let ci = 0;
    const observer: RoundObserver = (round, bankroll) => {
      if (ci < nCp && round === rounds[ci]) {
        values[ci * sessions + s] = bankroll;
        ci++;
      }
    };
    const finish = (finalBankroll: number) => {
      for (; ci < nCp; ci++) values[ci * sessions + s] = finalBankroll;
    };
    return { observer, finish };
  }

  /** Type-7 p5/p25/p50/p75/p95 at every checkpoint. */
  percentiles(): Bands {
    const out = BAND_PERCENTILES.map(() => new Float64Array(this.nCp));
    for (let ci = 0; ci < this.nCp; ci++) {
      const sorted = this.values.slice(ci * this.sessions, (ci + 1) * this.sessions).sort();
      BAND_PERCENTILES.forEach((p, k) => (out[k]![ci] = quantileSorted(sorted, p)));
    }
    const [p5, p25, p50, p75, p95] = out as [Float64Array, Float64Array, Float64Array, Float64Array, Float64Array];
    return { p5, p25, p50, p75, p95 };
  }
}
