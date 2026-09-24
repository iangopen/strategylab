import { describe, expect, it } from "vitest";
import { checkpointRounds, DENSE_ROUNDS } from "./checkpoints";
import { MAX_ROUNDS_CAP } from "./types";

/** The three required properties, plus shape: first 0, last maxRounds, strictly increasing integers. */
function check(m: number, cp: Float64Array): string | null {
  if (cp[0] !== 0) return `first ${cp[0]}`;
  if (cp[cp.length - 1] !== m) return `last ${cp[cp.length - 1]}`;
  if (cp.length > 320) return `length ${cp.length}`;
  // Every round 0..min(m, 64) is a checkpoint: cp[i] === i for i = 0..min(m, 64).
  const dense = Math.min(m, DENSE_ROUNDS);
  if (cp.length < dense + 1) return "dense part too short";
  for (let i = 0; i <= dense; i++) if (cp[i] !== i) return `round ${i} missing`;
  const maxGap = Math.max(1, Math.ceil(m / 128));
  for (let i = dense + 1; i < cp.length; i++) {
    const g = cp[i]! - cp[i - 1]!;
    if (!(g >= 1 && g <= maxGap && g === Math.floor(g))) return `gap ${g} (allowed 1..${maxGap}, whole rounds) at ${cp[i - 1]}`;
  }
  return null;
}

describe("checkpointRounds (adaptive band schedule)", () => {
  it("the named cases: every round to min(M, 64), no gap over max(1, ceil(M/128)), length <= 320, 0 first, M last", () => {
    const rows: string[] = [];
    for (const m of [1, 2, 63, 64, 65, 200, 1_000, 12_345, 1_000_000]) {
      const cp = checkpointRounds(m);
      expect(check(m, cp), `maxRounds ${m}`).toBeNull();
      let gap = 0;
      for (let i = 1; i < cp.length; i++) gap = Math.max(gap, cp[i]! - cp[i - 1]!);
      rows.push(`${m}: ${cp.length} checkpoints, widest gap ${gap} (allowed ${Math.max(1, Math.ceil(m / 128))})`);
    }
    console.log(`[checkpoints]\n  ${rows.join("\n  ")}`);
    expect(Array.from(checkpointRounds(1))).toEqual([0, 1]);
    expect(Array.from(checkpointRounds(65))).toEqual([...Array.from({ length: 66 }, (_, i) => i)]);
    // 1,000 rounds: every round to 64, then +16 capped at ceil(1000 / 200) = 5.
    const k = checkpointRounds(1000);
    expect(Array.from(k.slice(0, 68))).toEqual([...Array.from({ length: 65 }, (_, i) => i), 69, 74, 79]);
    expect(k).toHaveLength(253);
  });

  it("EVERY maxRounds from 1 to 1,000,000 (exhaustive)", { timeout: 60_000 }, () => {
    const t0 = performance.now();
    let longest = 0;
    let longestAt = 0;
    for (let m = 1; m <= MAX_ROUNDS_CAP; m++) {
      const cp = checkpointRounds(m);
      const problem = check(m, cp);
      if (problem !== null) expect.fail(`maxRounds ${m}: ${problem}`);
      if (cp.length > longest) {
        longest = cp.length;
        longestAt = m;
      }
    }
    console.log(`[checkpoints] exhaustive 1..${MAX_ROUNDS_CAP}: all pass; longest schedule ${longest} at maxRounds ${longestAt}; ${((performance.now() - t0) / 1000).toFixed(1)}s`);
    expect(longest).toBeLessThanOrEqual(320);
  });
});
