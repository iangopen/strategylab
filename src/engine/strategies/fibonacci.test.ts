import { describe, expect, it } from "vitest";
import { betSequence, expectPure, L, W } from "../testUtils";
import { fib, fibonacci } from "./fibonacci";

describe("fibonacci: fib()", () => {
  it("fib(0) = fib(1) = 1, then the usual sequence", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => fib(n))).toEqual([1, 1, 2, 3, 5, 8, 13, 21, 34, 55]);
  });

  it("stops at the cap instead of overflowing", () => {
    expect(fib(5000)).toBe(Number.MAX_SAFE_INTEGER);
    expect(fib(10, 50)).toBe(50);
  });
});

describe("fibonacci: exact bet sequences (no runner)", () => {
  it("up one step per loss, back two per win, floored at step 0", () => {
    // steps: 0 1 2 3 4 5 -> W -> 3 -> W -> 1 -> W -> 0 (floor)
    expect(betSequence(fibonacci, {}, [L, L, L, L, L, W, W, W])).toEqual([100, 100, 200, 300, 500, 800, 300, 100, 100]);
  });

  it("a win at step 1 floors at step 0", () => {
    expect(betSequence(fibonacci, {}, [L, W, L, L])).toEqual([100, 100, 100, 100, 200]);
  });

  it("alternating loss/win drifts back toward base", () => {
    // steps: 0 -L-> 1 -L-> 2 -L-> 3 -W-> 1 -L-> 2 -W-> 0
    expect(betSequence(fibonacci, {}, [L, L, L, W, L, W])).toEqual([100, 100, 200, 300, 100, 200, 100]);
  });

  it("caps the returned bet against float overflow on an absurd streak", () => {
    const bets = betSequence(fibonacci, {}, Array<boolean>(2000).fill(L));
    expect(bets[bets.length - 1]).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe("fibonacci: purity", () => {
  it("does not mutate deep-frozen config, state, or ctx", () => {
    expectPure(fibonacci, {});
  });
});
