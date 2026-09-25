import { describe, expect, it } from "vitest";
import type { AnyStrategy } from "./strategies/types";
import { betSequence, expectPure, L, W } from "./testUtils";

// A strategy that mutates its state in place: the purity check must reject it.
const mutating: AnyStrategy = {
  id: "mutating",
  label: "mutating (fixture)",
  description: "test fixture",
  configSchema: [],
  defaultConfig: {},
  init: () => ({ level: 0 }),
  nextBet: (s, ctx) => ctx.baseBet * 2 ** (s as { level: number }).level,
  update: (s, result) => {
    const st = s as { level: number };
    st.level = result.kind === "win" ? 0 : st.level + 1;
    return st;
  },
};

describe("test helpers", () => {
  it("expectPure rejects a strategy that mutates its state", () => {
    expect(() => expectPure(mutating, {})).toThrow();
  });

  it("betSequence records the bet before each round plus one after", () => {
    const pure: AnyStrategy = { ...mutating, update: (s, result) => ({ level: result.kind === "win" ? 0 : (s as { level: number }).level + 1 }) };
    expect(betSequence(pure, {}, [L, L, W])).toEqual([100, 200, 400, 100]);
  });
});
