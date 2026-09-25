import { describe, expect, it } from "vitest";
import { betSequence, expectPure, L, W } from "../testUtils";
import { paroli } from "./paroli";

describe("paroli: exact bet sequences (no runner)", () => {
  it("doubles on wins, resets when the streak reaches the cap (3), resets on a loss", () => {
    // W W W hits the cap -> back to base; W then L -> back to base.
    expect(betSequence(paroli, { streakCap: 3 }, [W, W, W, W, L, W])).toEqual([100, 200, 400, 100, 200, 100, 200]);
  });

  it("a loss mid-streak resets to base", () => {
    expect(betSequence(paroli, { streakCap: 3 }, [W, W, L, L, W])).toEqual([100, 200, 400, 100, 100, 200]);
  });

  it("cap 1 is flat betting", () => {
    expect(betSequence(paroli, { streakCap: 1 }, [W, W, L, W])).toEqual([100, 100, 100, 100, 100]);
  });

  it("cap 2: largest bet is base × 2", () => {
    expect(betSequence(paroli, { streakCap: 2 }, [W, W, W, W, W])).toEqual([100, 200, 100, 200, 100, 200]);
  });

  it("cap 10: largest bet is base × 2^9", () => {
    const bets = betSequence(paroli, { streakCap: 10 }, Array<boolean>(10).fill(W));
    expect(bets).toEqual([100, 200, 400, 800, 1600, 3200, 6400, 12800, 25600, 51200, 100]);
  });
});

describe("paroli: purity", () => {
  it("does not mutate deep-frozen config, state, or ctx", () => {
    expectPure(paroli, { streakCap: 3 });
    expectPure(paroli, { streakCap: 1 });
  });
});
