import { describe, expect, it } from "vitest";
import { GAME_PRESETS } from "../games";
import { DOWNSAMPLE_BUCKETS } from "../downsample";
import { runMonteCarlo, SAMPLE_PATH_COUNT } from "../montecarlo";
import { INVARIANT_SCENARIO, outcomesFromPath } from "../testUtils";
import { compileRule } from "../rules/compile";
import { STRATEGIES } from "./registry";

// One custom rule (not a shipped example) rides along: compiled rules must see the same outcomes too.
const CUSTOM_RULE = {
  kind: "progression",
  name: "crn custom",
  startUnits: 1.5,
  onWin: [
    { when: { type: "cycleProfit", atLeast: 6 }, then: { type: "stop" } },
    { when: { type: "winStreak", atLeast: 2 }, then: { type: "resetCycle" } },
    { then: { type: "add", units: -0.5 } },
  ],
  onLoss: [
    { when: { type: "lossStreak", atLeast: 4 }, then: { type: "set", units: 1 } },
    { then: { type: "multiply", by: 1.5 } },
  ],
};

describe("common random numbers across every registered strategy and a custom rule", () => {
  it("session i sees an identical win/loss sequence in every strategy, over their overlapping rounds", () => {
    const european = GAME_PRESETS.find((g) => g.id === "european")!;
    expect(STRATEGIES.map((s) => s.id)).toEqual(["flat", "martingale", "paroli", "dalembert", "fibonacci", "labouchere", "oscars", "kelly"]);
    // Sample paths are min/max-downsampled; with maxRounds <= 2 x buckets (998) every bucket holds at
    // most 2 rounds, so the paths are lossless and every round's outcome is visible.
    const scenario = { ...INVARIANT_SCENARIO, maxRounds: 2 * DOWNSAMPLE_BUCKETS };

    // Kelly with its default (assumed 0 -> true prob) would refuse to bet on European (negative edge),
    // so give it a misjudged edge here to make its CRN meaningful; every other strategy uses its default.
    const specs = [
      ...STRATEGIES.map((strategy) => ({ strategy, config: strategy.id === "kelly" ? { assumedWinProb: 0.6, fraction: 1 } : { ...strategy.defaultConfig } })),
      { strategy: compileRule(CUSTOM_RULE), config: {} },
    ];
    const r = runMonteCarlo(european, specs, scenario, SAMPLE_PATH_COUNT, 424242);

    let sessionsWithDifferentLengths = 0;
    let comparedRounds = 0;
    for (let i = 0; i < SAMPLE_PATH_COUNT; i++) {
      for (const s of r.perStrategy) expect(s.samplePaths[i]!.rounds).toEqual(Array.from({ length: s.samplePaths[i]!.rounds.length }, (_, k) => k)); // lossless
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
    console.log(`[crn] ${SAMPLE_PATH_COUNT} sessions x ${specs.length} strategies (incl. 1 custom rule); ${sessionsWithDifferentLengths} sessions had different lengths across strategies; ${comparedRounds} pairwise rounds compared`);
    // Strategies end at different times, so the "overlapping rounds" case is really exercised.
    expect(sessionsWithDifferentLengths).toBeGreaterThan(0);
    // The custom rule really plays (its comparison is not vacuous).
    const customRounds = r.perStrategy.at(-1)!.samplePaths.reduce((sum, p) => sum + p.rounds.length - 1, 0);
    console.log(`[crn] custom rule played ${customRounds} rounds over the ${SAMPLE_PATH_COUNT} sample sessions`);
    expect(customRounds).toBeGreaterThan(10 * SAMPLE_PATH_COUNT);
  });
});
