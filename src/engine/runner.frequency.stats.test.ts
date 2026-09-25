// Directive 2 (session 13): over 1,000,000 seeded draws, each outcome's frequency is within 4 SE of its
// probability, SE = sqrt(p(1 - p) / N) from the binomial, computed and printed here.
import { describe, expect, it } from "vitest";
import type { OutcomesGame } from "./games";
import { mulberry32 } from "./rng";
import { compileGame, outcomeIndex } from "./runner";

const N = 1_000_000;

const TICKET: OutcomesGame = {
  id: "ticket",
  name: "ticket (1/6, 3/6, 2/6)",
  outcomes: [
    { prob: 1 / 6, net: -5 / 7 },
    { prob: 3 / 6, net: -2 / 7 },
    { prob: 2 / 6, net: 3 / 7 },
  ],
};

// 12 outcomes including a 0.001 one, in an uneven order (the rare one is in the middle).
const TWELVE_PROBS = [0.2, 0.15, 0.12, 0.1, 0.09, 0.001, 0.08, 0.07, 0.06, 0.05, 0.049, 0.03];
const TWELVE: OutcomesGame = { id: "twelve", name: "12 outcomes incl. 0.001", outcomes: TWELVE_PROBS.map((prob, i) => ({ prob, net: i - 5 })) };

describe("one-draw mapping: outcome frequencies over 1,000,000 draws are within 4 SE", () => {
  for (const [game, seed] of [[TICKET, 1606], [TWELVE, 1212]] as const) {
    it(game.name, () => {
      expect(TWELVE_PROBS.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
      const { cum } = compileGame(game);
      const counts = new Array<number>(game.outcomes.length).fill(0);
      const rng = mulberry32(seed);
      for (let i = 0; i < N; i++) counts[outcomeIndex(cum, rng())]!++;
      const rows = game.outcomes.map((o, k) => {
        const f = counts[k]! / N;
        const se = Math.sqrt((o.prob * (1 - o.prob)) / N);
        const z = (f - o.prob) / se;
        expect(Math.abs(f - o.prob), `outcome ${k}: freq ${f} vs ${o.prob}, SE ${se}, z ${z.toFixed(2)}`).toBeLessThan(4 * se);
        return `  outcome ${k}: p ${o.prob.toFixed(6)}  freq ${f.toFixed(6)}  SE ${se.toExponential(2)}  z ${z.toFixed(2)}`;
      });
      console.log(`[frequency] ${game.name}, ${N.toLocaleString("en-US")} draws, seed ${seed}:\n${rows.join("\n")}`);
    });
  }
});
