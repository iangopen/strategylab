import { describe, expect, it } from "vitest";
import { GAME_PRESETS } from "../games";
import { runMonteCarlo } from "../montecarlo";
import { describeEvInvariant, sessionConfig } from "../testUtils";
import { martingale } from "./martingale";

const european = GAME_PRESETS.find((g) => g.id === "european")!;
const american = GAME_PRESETS.find((g) => g.id === "american")!;

describeEvInvariant(martingale, { multiplier: 2 });

describe("martingale: analytic one-cycle bust probability", () => {
  // multiplier 2, no tableMax, stopWin = start + b, insufficientFunds "stop", no stopLoss.
  // k = largest integer with b(2^k - 1) <= B. The session busts iff the first k rounds all lose,
  // so P(insufficientFunds) = (1-p)^k and every other session ends at exactly start + b.
  const pairs = [
    { B: 100_000, b: 1_000 }, // $1,000 / $10: k = 6, $370 left after 6 losses
    { B: 50_000, b: 100 }, // $500 / $1: k = 8, $245 left after 8 losses
  ];
  for (const game of [european, american]) {
    for (const { B, b } of pairs) {
      it(`${game.id}, B=${B}c, b=${b}c`, () => {
        let k = 0;
        while (b * (2 ** (k + 1) - 1) <= B) k++;
        const leftover = B - b * (2 ** k - 1);
        expect(leftover).toBeGreaterThanOrEqual(1); // so it is insufficientFunds, not ruin
        expect(leftover).toBeLessThan(b * 2 ** k); // the next bet cannot be covered

        const n = 20_000;
        const cfg = sessionConfig({ startBankroll: B, baseBet: b, tableMin: 1, tableMax: null, stopWin: B + b, stopLoss: null, maxRounds: 1000, insufficientFunds: "stop" });
        const r = runMonteCarlo(game, [{ strategy: martingale, config: { multiplier: 2 } }], cfg, n, 31337);
        const counts = r.perStrategy[0]!.endReasonCounts;
        const measured = counts.insufficientFunds / n;
        const expected = (1 - game.winProb) ** k;
        const se = Math.sqrt((measured * (1 - measured)) / n);
        const z = (measured - expected) / se;
        console.log(`[martingale analytic] ${game.id} B=${B} b=${b} k=${k}: measured=${measured.toFixed(5)} expected=${expected.toFixed(5)} SE=${se.toFixed(5)} z=${z.toFixed(2)}`);
        expect(se).toBeGreaterThan(0);
        expect(Math.abs(measured - expected)).toBeLessThan(4 * se);
        expect(counts.stopWin).toBe(n - counts.insufficientFunds);
      });
    }
  }
});
