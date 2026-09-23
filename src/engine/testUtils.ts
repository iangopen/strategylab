// Test-only helpers. Not imported by production code.
import type { Rng } from "./rng";
import type { SessionConfig, SessionResult } from "./types";

/** An RNG that plays a scripted win/loss sequence and counts every draw. */
export function scriptedRng(outcomes: readonly boolean[]): Rng & { draws: () => number } {
  let i = 0;
  const rng = () => {
    const o = outcomes[i++];
    if (o === undefined) throw new Error(`scriptedRng exhausted after ${outcomes.length} draws`);
    return o ? 0 : 0.999999; // 0 wins for any winProb > 0; 0.999999 loses for any winProb < 0.999999
  };
  return Object.assign(rng, { draws: () => i });
}

/** Wraps an RNG and counts draws. */
export function countingRng(inner: Rng): Rng & { draws: () => number } {
  let n = 0;
  const rng = () => {
    n++;
    return inner();
  };
  return Object.assign(rng, { draws: () => n });
}

export const W = true;
export const L = false;

export function sessionConfig(overrides: Partial<SessionConfig> = {}): SessionConfig {
  return {
    startBankroll: 1000,
    baseBet: 100,
    tableMin: 1,
    tableMax: null,
    stopWin: null,
    stopLoss: null,
    maxRounds: 1000,
    insufficientFunds: "stop",
    ...overrides,
  };
}

/** Win/loss sequence of a session, recovered from its recorded path (stride 1). */
export function outcomesFromPath(r: SessionResult): boolean[] {
  if (!r.path) throw new Error("session was run without recordPath");
  const b = r.path.bankroll;
  const out: boolean[] = [];
  for (let k = 1; k < b.length; k++) out.push(b[k]! > b[k - 1]!);
  return out;
}

/**
 * Ratio estimator R = sum(profit) / sum(wagered) and its delta-method standard error,
 * computed directly from per-session samples.
 */
export function evPerWageredWithSE(results: readonly SessionResult[], start: number): { ev: number; se: number } {
  const n = results.length;
  let sp = 0;
  let sw = 0;
  for (const r of results) {
    sp += r.finalBankroll - start;
    sw += r.totalWagered;
  }
  const ev = sp / sw;
  let ss = 0;
  for (const r of results) {
    const d = r.finalBankroll - start - ev * r.totalWagered;
    ss += d * d;
  }
  const meanW = sw / n;
  const se = Math.sqrt(ss / (n - 1) / n) / meanW;
  return { ev, se };
}
