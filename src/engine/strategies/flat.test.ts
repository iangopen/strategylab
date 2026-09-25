import { describe, expect, it } from "vitest";
import { betSequence, expectPure, L, W } from "../testUtils";
import { flat } from "./flat";

describe("flat", () => {
  it("bets baseBet × units every round", () => {
    const ctx = { bankroll: 1000, baseBet: 100, round: 0, lastBet: null, game: { winProb: 0.5, netPayout: 1, edge: 0 } };
    const s = flat.init({ units: 2.5 }, ctx);
    expect(flat.nextBet(s, ctx)).toBe(250);
    expect(flat.nextBet(flat.update(s, false, ctx), ctx)).toBe(250);
  });

  it("exact sequence: the same bet whatever happens", () => {
    expect(betSequence(flat, { units: 1.5 }, [L, W, L, L, W])).toEqual([150, 150, 150, 150, 150, 150]);
  });

  it("is pure under deep-frozen inputs", () => {
    expectPure(flat, { units: 2 });
  });

  it("is pure: inputs are unchanged", () => {
    const config = Object.freeze({ units: 2 });
    const ctx = Object.freeze({ bankroll: 1000, baseBet: 100, round: 0, lastBet: null, game: { winProb: 0.5, netPayout: 1, edge: 0 } });
    const s = Object.freeze(flat.init(config, ctx));
    flat.nextBet(s, ctx);
    flat.update(s, true, ctx);
    expect(s).toEqual({ units: 2 });
    expect(config).toEqual({ units: 2 });
  });
});
