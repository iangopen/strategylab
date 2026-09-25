import { describe, expect, it } from "vitest";
import { betSequence, expectPure, gameView, L, W } from "../testUtils";
import { kelly } from "./kelly";

describe("kelly: f* and the do-not-play rule (no runner)", () => {
  it("f* <= 0 returns \"stop\" (Kelly says do not play)", () => {
    // Even money, true prob 0.5: f* = (1*0.5 - 0.5)/1 = 0. Not positive -> stop.
    expect(betSequence(kelly, { fraction: 1 }, [W, W])).toEqual(["stop", "stop", "stop"]);
    // A misjudged edge BELOW the true probability is still no edge: also stop.
    expect(betSequence(kelly, { assumedWinProb: 0.4, fraction: 1 }, [W])).toEqual(["stop", "stop"]);
  });

  it("f* > 0 bets fraction × f* × bankroll (bankroll is fixed at 1e9 in this harness)", () => {
    // Kelly returns an unrounded stake; the runner rounds to whole cents, so compare the rounded bet.
    const rounded = (bets: (number | "stop")[]) => bets.map((b) => (typeof b === "number" ? Math.round(b) : b));
    // Assumed 0.6, b = 1: f* = 0.2. Full Kelly stakes 0.2 × 1e9 = 2e8.
    expect(rounded(betSequence(kelly, { assumedWinProb: 0.6, fraction: 1 }, [L]))).toEqual([200_000_000, 200_000_000]);
    // Half Kelly halves the stake.
    expect(rounded(betSequence(kelly, { assumedWinProb: 0.6, fraction: 0.5 }, [L]))).toEqual([100_000_000, 100_000_000]);
    // Payout 2, assumed 0.5: f* = (2*0.5 - 0.5)/2 = 0.25 -> stakes 0.25 × 1e9.
    expect(rounded(betSequence(kelly, { assumedWinProb: 0.5, fraction: 1 }, [L], 100, gameView(2)))).toEqual([250_000_000, 250_000_000]);
  });
});

describe("kelly: purity", () => {
  it("does not mutate deep-frozen config, state, or ctx", () => {
    expectPure(kelly, { assumedWinProb: 0.6, fraction: 1 });
    expectPure(kelly, { fraction: 0.5 });
  });
});

// The invariant needs Kelly to actually bet on all three games, so it uses an assumed edge above
// 0.5 (a misjudged edge). EV per $ wagered is still -edge, whatever the (mis)sizing.
