// Generalized Kelly (session 13): the bisection solver, its agreement with the binary closed form, and
// the ticket example. Pure checks on init (no runner, no Monte Carlo).
import { describe, expect, it } from "vitest";
import { edge, legacyView, outcomesOf, type Outcome } from "../games";
import { mulberry32 } from "../rng";
import { kelly, kellyFraction } from "./kelly";
import type { StrategyContext } from "./types";

/** A ctx whose game is the given outcome list (as the runner builds it). */
function ctxOf(outcomes: readonly Outcome[], bankroll = 1_000_000): StrategyContext {
  return { bankroll, baseBet: 100, round: 0, lastBet: null, game: { ...legacyView({ outcomes }), edge: edge({ outcomes }), outcomes } };
}
const ticket = (price: number): Outcome[] => [
  { prob: 1 / 6, net: (20 - price) / price },
  { prob: 3 / 6, net: (50 - price) / price },
  { prob: 2 / 6, net: (100 - price) / price },
];
const firstBet = (outcomes: readonly Outcome[], config: { assumedWinProb?: number; fraction: number } = { fraction: 1 }) => {
  const ctx = ctxOf(outcomes);
  return kelly.nextBet(kelly.init(config, ctx), ctx);
};

describe("generalized Kelly", () => {
  it("the solver matches the binary closed form (b p - q) / b to 1e-12 wherever f* > 0", () => {
    const rng = mulberry32(606);
    let worst = 0;
    let n = 0;
    for (let i = 0; i < 5_000; i++) {
      const p = 0.01 + 0.98 * rng();
      const b = 0.05 + 20 * rng();
      const closed = (b * p - (1 - p)) / b;
      const solved = kellyFraction(outcomesOf({ winProb: p, netPayout: b }));
      if (closed > 0) {
        worst = Math.max(worst, Math.abs(solved - closed));
        n++;
      } else expect(solved).toBe(0);
    }
    for (const [p, b] of [[0.6, 1], [0.55, 1], [0.5, 2], [0.4, 2], [28 / 73, 1.6]] as const) {
      const closed = (b * p - (1 - p)) / b;
      if (closed > 0) expect(Math.abs(kellyFraction(outcomesOf({ winProb: p, netPayout: b })) - closed)).toBeLessThan(1e-12);
    }
    console.log(`[kelly] solver vs closed form on ${n} random binary games with f* > 0: worst |diff| ${worst.toExponential(2)}`);
    expect(worst).toBeLessThan(1e-12);
  });

  it("ticket at $60 (player edge 1/36): bets a positive fraction, f* = 0.119801; at $70 (house edge 5/42): stops", () => {
    const f = kellyFraction(ticket(60));
    expect(f).toBeCloseTo(0.11980067765096304, 12);
    // The optimum: G'(f*) = 0 within float noise, and G is lower on both sides.
    const G = (x: number) => ticket(60).reduce((s, o) => s + o.prob * Math.log(1 + x * o.net), 0);
    expect(G(f)).toBeGreaterThan(G(f - 1e-4));
    expect(G(f)).toBeGreaterThan(G(f + 1e-4));
    expect(firstBet(ticket(60))).toBeCloseTo(f * 1_000_000, 6);
    expect(kellyFraction(ticket(70))).toBe(0);
    expect(firstBet(ticket(70))).toBe("stop");
  });

  it("a push game with a 2% house edge stops; with a player edge it bets; a game that cannot lose is capped at 1", () => {
    expect(firstBet([{ prob: 0.44, net: 1 }, { prob: 0.1, net: 0 }, { prob: 0.46, net: -1 }])).toBe("stop");
    // Win 0.5, push 0.1, lose 0.4 (10% player edge): f* solves 0.5/(1+f) = 0.4/(1-f) -> f = 1/9.
    expect(kellyFraction([{ prob: 0.5, net: 1 }, { prob: 0.1, net: 0 }, { prob: 0.4, net: -1 }])).toBeCloseTo(1 / 9, 12);
    expect(kellyFraction([{ prob: 0.5, net: 0.2 }, { prob: 0.5, net: 0 }])).toBe(1);
    expect(kellyFraction([{ prob: 1, net: 0 }])).toBe(0); // a sure push: no edge, no bet
  });

  it("assumedWinProb applies only to win/lose games: ignored on a multi-outcome game", () => {
    expect(firstBet(ticket(70), { assumedWinProb: 0.99, fraction: 1 })).toBe("stop");
    expect(firstBet(ticket(60), { assumedWinProb: 0.01, fraction: 1 })).toBeCloseTo(kellyFraction(ticket(60)) * 1_000_000, 6);
    // ...but it still drives a binary game, exactly as before.
    expect(firstBet(outcomesOf({ winProb: 18 / 37, netPayout: 1 }), { assumedWinProb: 0.6, fraction: 1 })).toBeCloseTo(0.2 * 1_000_000, 6);
  });
});
