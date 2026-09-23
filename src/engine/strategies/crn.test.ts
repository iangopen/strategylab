import { describe, expect, it } from "vitest";
import { GAME_PRESETS } from "../games";
import { runMonteCarlo, SAMPLE_PATH_COUNT } from "../montecarlo";
import { INVARIANT_SCENARIO, outcomesFromPath } from "../testUtils";
import { STRATEGIES } from "./registry";

describe("common random numbers across every registered strategy", () => {
  it("session i sees an identical win/loss sequence in every strategy, over their overlapping rounds", () => {
    const european = GAME_PRESETS.find((g) => g.id === "european")!;
    expect(STRATEGIES.map((s) => s.id)).toEqual(["flat", "martingale", "paroli", "dalembert", "fibonacci"]);
    // maxRounds 1000 -> path stride 1, so every round is visible in the sample paths.
    expect(INVARIANT_SCENARIO.maxRounds).toBeLessThanOrEqual(1000);

    const specs = STRATEGIES.map((strategy) => ({ strategy, config: { ...strategy.defaultConfig } }));
    const r = runMonteCarlo(european, specs, INVARIANT_SCENARIO, SAMPLE_PATH_COUNT, 424242);

    let sessionsWithDifferentLengths = 0;
    let comparedRounds = 0;
    for (let i = 0; i < SAMPLE_PATH_COUNT; i++) {
      const seqs = r.perStrategy.map((s) => outcomesFromPath(s.samplePaths[i]!));
      const lengths = seqs.map((s) => s.length);
      if (new Set(lengths).size > 1) sessionsWithDifferentLengths++;
      for (let a = 0; a < seqs.length; a++) {
        for (let b = a + 1; b < seqs.length; b++) {
          const n = Math.min(seqs[a]!.length, seqs[b]!.length);
          expect(seqs[b]!.slice(0, n), `session ${i}: ${specs[a]!.strategy.id} vs ${specs[b]!.strategy.id}`).toEqual(seqs[a]!.slice(0, n));
          comparedRounds += n;
        }
      }
    }
    console.log(`[crn] ${SAMPLE_PATH_COUNT} sessions x ${STRATEGIES.length} strategies; ${sessionsWithDifferentLengths} sessions had different lengths across strategies; ${comparedRounds} pairwise rounds compared`);
    // Strategies end at different times, so the "overlapping rounds" case is really exercised.
    expect(sessionsWithDifferentLengths).toBeGreaterThan(0);
  });
});
