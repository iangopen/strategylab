// Session 13: the replay's ONE strip on multi-outcome games: every round's outcome (identical in every
// strategy), levels by net with a label each, pushes flagged; bucketed for long sessions.
import { describe, expect, it } from "vitest";
import { stripCells } from "../ui/charts/adapters";
import type { OutcomesGame } from "./games";
import { compileGame, outcomeIndex, runSession } from "./runner";
import { mulberry32, sessionSeed } from "./rng";
import { replaySession, stripLevels } from "./replay";
import { STRATEGIES } from "./strategies/registry";
import { sessionConfig } from "./testUtils";

const TICKET: OutcomesGame = {
  id: "t",
  name: "ticket",
  outcomes: [
    { prob: 1 / 6, net: -5 / 7, label: "$20" },
    { prob: 3 / 6, net: -2 / 7, label: "$50" },
    { prob: 2 / 6, net: 3 / 7, label: "$100" },
  ],
};
// Entered out of net order, with a push, and an unlabeled outcome.
const PUSHY: OutcomesGame = { id: "p", name: "push", outcomes: [{ prob: 0.3, net: 1, label: "win" }, { prob: 0.2, net: 0, label: "push" }, { prob: 0.5, net: -1 }] };
const specs = STRATEGIES.map((strategy) => ({ strategy, config: strategy.id === "kelly" ? { assumedWinProb: 0.6, fraction: 1 } : { ...strategy.defaultConfig } }));

describe("strip levels", () => {
  it("rank by net, lowest first; a label per level; pushes flagged; binary games unchanged", () => {
    expect(stripLevels(TICKET)).toEqual({ levels: [{ label: "$20", push: false }, { label: "$50", push: false }, { label: "$100", push: false }], outcomeLevel: [0, 1, 2] });
    expect(stripLevels(PUSHY)).toEqual({ levels: [{ label: "Outcome 3 (returns 0x)", push: false }, { label: "push", push: true }, { label: "win", push: false }], outcomeLevel: [2, 1, 0] });
    const rep = replaySession({ id: "e", name: "e", winProb: 18 / 37, netPayout: 1 }, specs.slice(0, 2), sessionConfig({ maxRounds: 50 }), 1, 0);
    expect(rep.binary).toBe(true);
  });
});

describe("the outcome strip on a multi-outcome game", () => {
  it("records every round's outcome, identical in every strategy (CRN), pushes included; cells encode level and push", () => {
    const cfg = sessionConfig({ startBankroll: 100_000, baseBet: 1_000, maxRounds: 400 });
    for (let session = 0; session < 20; session++) {
      const rep = replaySession(PUSHY, specs, cfg, 77, session);
      expect(rep.binary).toBe(false);
      if (rep.strip.kind !== "rounds") throw new Error("expected per-round strip");
      // The strip is the draw sequence itself: replay it from the seed with the same mapping.
      const rng = mulberry32(sessionSeed(77, session));
      const { cum } = compileGame(PUSHY);
      const expected = Array.from(rep.strip.outcomes, () => outcomeIndex(cum, rng()));
      expect(Array.from(rep.strip.outcomes)).toEqual(expected);
      expect(rep.strip.outcomes.length).toBe(Math.max(...rep.strategies.map((s) => s.rounds)));
      // Each strategy's bets were recorded on EVERY round (pushes too).
      for (const s of rep.strategies) expect(s.bets.bankroll).toHaveLength(s.rounds);
      const cells = stripCells(rep);
      cells.forEach((c, r) => {
        const level = rep.outcomeLevel[rep.strip.kind === "rounds" ? rep.strip.outcomes[r]! : 0]!;
        expect(c.height).toBeCloseTo((level + 1) / 3, 15);
        expect(c.push).toBe(level === 1);
      });
    }
  });

  it("long sessions: bucket height is the mean level; counts cover the longest strategy", () => {
    const cfg = sessionConfig({ startBankroll: 10_000_000, baseBet: 100, tableMin: 100, maxRounds: 20_000 });
    const rep = replaySession(TICKET, specs.slice(0, 1), cfg, 5, 0); // flat plays all 20,000 rounds
    if (rep.strip.kind !== "buckets") throw new Error("expected bucketed strip");
    expect(rep.strip.counts.reduce((a, b) => a + b, 0)).toBe(rep.strategies[0]!.rounds);
    const flat = runSession(TICKET, specs[0]!.strategy, specs[0]!.config, cfg, sessionSeed(5, 0));
    expect(flat.rounds).toBe(20_000);
    for (const c of stripCells(rep)) expect(c.height).toBeGreaterThan(1 / 3 - 1e-12);
    const mean = stripCells(rep).reduce((s, c) => s + c.height * (c.x1 - c.x0), 0) / 20_000;
    // Expected mean height: sum(prob x (level + 1) / 3) = (1/6 x 1 + 3/6 x 2 + 2/6 x 3) / 3 = 13/18.
    // Tolerance 4 SE, SE = sd(height) / sqrt(rounds), sd from the level distribution (var = 17/324).
    const heights = [1 / 3, 2 / 3, 1];
    const probs = TICKET.outcomes.map((o) => o.prob);
    const mu = probs.reduce((s, p, k) => s + p * heights[k]!, 0);
    const variance = probs.reduce((s, p, k) => s + p * (heights[k]! - mu) ** 2, 0);
    const se = Math.sqrt(variance / 20_000);
    console.log(`[strip] mean bucket height ${mean.toFixed(5)} vs ${mu.toFixed(5)} (13/18), SE ${se.toExponential(2)}, z ${((mean - mu) / se).toFixed(2)}`);
    expect(mu).toBeCloseTo(13 / 18, 15);
    expect(Math.abs(mean - mu)).toBeLessThan(4 * se);
  });
});
