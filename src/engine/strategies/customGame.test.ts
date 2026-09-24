import { describe, expect, it } from "vitest";
import { edge, type Game } from "../games";
import { runMonteCarlo } from "../montecarlo";
import { INVARIANT_SCENARIO, INVARIANT_SESSIONS } from "../testUtils";
import { STRATEGIES } from "./registry";

// Session 2 open item: custom game p = 0.45, net payout 1.2 (edge = 1 - 0.45 × 2.2 = 1%), stops ON.
// Uses the registered stats (EV per $, SE, theory, z), i.e. exactly what the results table shows.
// Per-file 30 s timeout (session 12, owner-approved): each test is deterministic and CPU-bound (Paroli
// takes ~0.8 s alone) but reached 8.3 s under the full parallel suite. The 5 s default is a harness
// budget, not an assertion; nothing asserted here changed.
describe("custom game p = 0.45, payout 1.2: every registered strategy within 4 SE of -edge", { timeout: 30_000 }, () => {
  const game: Game = { id: "custom", name: "Custom", winProb: 0.45, netPayout: 1.2 };

  it("edge is 1%", () => {
    expect(edge(game)).toBeCloseTo(0.01, 15);
  });

  for (const strategy of STRATEGIES) {
    it(strategy.id, () => {
      // Kelly's default refuses to bet on a negative-edge game; give it a misjudged edge so it wagers.
      const config = strategy.id === "kelly" ? { assumedWinProb: 0.6, fraction: 1 } : { ...strategy.defaultConfig };
      const r = runMonteCarlo(game, [{ strategy, config }], INVARIANT_SCENARIO, INVARIANT_SESSIONS, 4545);
      const s = r.perStrategy[0]!.stats;
      console.log(
        `[custom game] ${strategy.id}: measured=${s.evPerWagered!.toFixed(6)} theory=${s.evTheory!.toFixed(6)} SE=${s.evSE!.toFixed(6)} z=${s.evZ!.toFixed(2)}`,
      );
      expect(s.evTheory).toBeCloseTo(-0.01, 15);
      expect(Math.abs(s.evZ!)).toBeLessThan(4);
    });
  }
});
