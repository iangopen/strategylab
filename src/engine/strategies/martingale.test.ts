import { describe, expect, it } from "vitest";
import { GAME_PRESETS } from "../games";
import { runMonteCarlo } from "../montecarlo";
import { runSessionWithRng } from "../runner";
import { betSequence, deltasFromPath, describeEvInvariant, expectPure, L, scriptedRng, sessionConfig, W } from "../testUtils";
import { martingale } from "./martingale";

const european = GAME_PRESETS.find((g) => g.id === "european")!;
const american = GAME_PRESETS.find((g) => g.id === "american")!;

describe("martingale: exact bet sequences (no runner)", () => {
  it("doubles on each loss, resets to base on a win", () => {
    expect(betSequence(martingale, { multiplier: 2 }, [L, L, L, W, L, W])).toEqual([100, 200, 400, 800, 100, 200, 100]);
  });

  it("multiplier 3", () => {
    expect(betSequence(martingale, { multiplier: 3 }, [L, L, W, L])).toEqual([100, 300, 900, 100, 300]);
  });

  it("fractional multiplier returns fractional cents (the runner rounds)", () => {
    expect(betSequence(martingale, { multiplier: 1.5 }, [L, L, L])).toEqual([100, 150, 225, 337.5]);
  });

  it("the level keeps climbing regardless of wins before it", () => {
    expect(betSequence(martingale, { multiplier: 2 }, [W, W, L, L, L, L, L])).toEqual([100, 100, 100, 200, 400, 800, 1600, 3200]);
  });

  it("caps the returned bet against float overflow; the level is unaffected", () => {
    const bets = betSequence(martingale, { multiplier: 10 }, Array<boolean>(400).fill(L));
    expect(bets[bets.length - 1]).toBe(Number.MAX_SAFE_INTEGER);
    expect(bets.every((b) => typeof b === "number" && Number.isFinite(b))).toBe(true);
  });
});

describe("martingale: purity", () => {
  it("does not mutate deep-frozen config, state, or ctx", () => {
    expectPure(martingale, { multiplier: 2 });
    expectPure(martingale, { multiplier: 1.5 });
  });
});

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

describe("martingale: table max breaks the recovery guarantee", () => {
  it("placed bet sticks at tableMax while the strategy's own level keeps climbing; one win leaves the session negative", () => {
    const script = [L, L, L, L, L, L, W];
    const cfg = sessionConfig({ startBankroll: 100_000, baseBet: 100, tableMax: 800, maxRounds: script.length });
    const r = runSessionWithRng(european, martingale, { multiplier: 2 }, cfg, scriptedRng(script), { recordPath: true });

    // Placed bets (runner, after the clamp): |bankroll change| per round for even money.
    const placed = deltasFromPath(r.path!).map(Math.abs);
    expect(placed).toEqual([100, 200, 400, 800, 800, 800, 800]);
    // What the strategy asks for over the same script: it never looks at the clamped lastBet.
    expect(betSequence(martingale, { multiplier: 2 }, script)).toEqual([100, 200, 400, 800, 1600, 3200, 6400, 100]);

    // Uncapped, the win would recover everything plus one base bet. Capped, it cannot.
    expect(r.finalBankroll - cfg.startBankroll).toBe(-(100 + 200 + 400 + 800 * 3) + 800);
    expect(r.finalBankroll).toBeLessThan(cfg.startBankroll);
  });
});
