import { describe, expect, it } from "vitest";
import { betSequence, expectPure, L, W } from "../testUtils";
import { dalembert } from "./dalembert";

describe("dalembert: exact bet sequences (no runner)", () => {
  it("+1 unit per loss, -1 per win, floored at the base bet", () => {
    // units: 0 -> 1 -> 2 -> 1 -> 0 -> 0 (floor) -> 0 (floor)
    expect(betSequence(dalembert, { unitSize: 1 }, [L, L, W, W, W, W])).toEqual([100, 200, 300, 200, 100, 100, 100]);
  });

  it("wins at the floor bank nothing: the next loss still starts from base", () => {
    expect(betSequence(dalembert, { unitSize: 1 }, [W, W, W, L, L])).toEqual([100, 100, 100, 100, 200, 300]);
  });

  it("unitSize 0.5 steps by half a base bet", () => {
    expect(betSequence(dalembert, { unitSize: 0.5 }, [L, L, L, W])).toEqual([100, 150, 200, 250, 200]);
  });

  it("unitSize 2 steps by two base bets", () => {
    expect(betSequence(dalembert, { unitSize: 2 }, [L, L, W], 500)).toEqual([500, 1500, 2500, 1500]);
  });
});

describe("dalembert: purity", () => {
  it("does not mutate deep-frozen config, state, or ctx", () => {
    expectPure(dalembert, { unitSize: 1 });
    expectPure(dalembert, { unitSize: 0.5 });
  });
});
