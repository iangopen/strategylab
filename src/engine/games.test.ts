import { describe, expect, it } from "vitest";
import { edge, GAME_PRESETS, isBinary, legacyView, MAX_OUTCOMES, outcomesOf, validateGame, type OutcomesGame } from "./games";
import { addRational, parseProbability, type Rational } from "./probText";

const european = GAME_PRESETS.find((g) => g.id === "european")!;
/** The ticket example at price P: prizes $20, $50, $100 with probabilities 1/6, 3/6, 2/6. */
const ticket = (price: number): OutcomesGame => ({
  id: "ticket",
  name: "ticket",
  outcomes: [
    { prob: 1 / 6, net: (20 - price) / price },
    { prob: 3 / 6, net: (50 - price) / price },
    { prob: 2 / 6, net: (100 - price) / price },
  ],
});

describe("the outcome model", () => {
  it("binary games are exactly [{p, n}, {1 - p, -1}] with p and n untouched", () => {
    const g = { id: "x", name: "x", winProb: 0.4712345678901234, netPayout: 100 / 110 };
    expect(outcomesOf(g)).toEqual([
      { prob: 0.4712345678901234, net: 100 / 110 },
      { prob: 1 - 0.4712345678901234, net: -1 },
    ]);
    expect(outcomesOf(g)[0]!.net).toBe(g.netPayout); // bit-exact, not (1 + n) - 1
    expect(isBinary(g)).toBe(true);
    expect(isBinary({ outcomes: outcomesOf(g) })).toBe(true);
    expect(isBinary(ticket(70))).toBe(false);
  });

  it("edge = 1 - sum(prob x (1 + net)); for binary games it is BIT-equal to 1 - p(1 + n)", () => {
    for (const g of [...GAME_PRESETS, { winProb: 0.45, netPayout: 1.2 }, { winProb: 0.5, netPayout: 100 / 110 }, { winProb: 28 / 73, netPayout: 1.5 }]) {
      expect(edge({ outcomes: outcomesOf(g) })).toBe(1 - g.winProb * (1 + g.netPayout));
      expect(edge(g)).toBe(1 - g.winProb * (1 + g.netPayout));
    }
    expect(edge(european)).toBe(1 - (18 / 37) * 2); // European even money: the old formula, same bits
  });

  it("the ticket example: edge 5/42 (11.905%) at $70, -1/36 (player 2.778%) at $60", () => {
    expect(edge(ticket(70))).toBeCloseTo(5 / 42, 15);
    expect(edge(ticket(60))).toBeCloseTo(-1 / 36, 15);
    // A game with a push: win 0.44 at 2x, push 0.10, lose 0.46 -> 2% house edge.
    expect(edge({ outcomes: [{ prob: 0.44, net: 1 }, { prob: 0.1, net: 0 }, { prob: 0.46, net: -1 }] })).toBeCloseTo(0.02, 15);
  });

  it("legacy ctx.game fields: winProb = P(profit > 0), netPayout = the single winner's net (exact) or the weighted mean", () => {
    expect(legacyView(european)).toEqual({ winProb: 18 / 37, netPayout: 1 });
    expect(legacyView({ outcomes: outcomesOf({ winProb: 0.5, netPayout: 100 / 110 }) })).toEqual({ winProb: 0.5, netPayout: 100 / 110 });
    const t = legacyView(ticket(70));
    expect(t.winProb).toBe(2 / 6);
    expect(t.netPayout).toBe(30 / 70);
    const two = legacyView({ outcomes: [{ prob: 0.2, net: 1 }, { prob: 0.3, net: 3 }, { prob: 0.5, net: -1 }] });
    expect(two.winProb).toBeCloseTo(0.5, 15);
    expect(two.netPayout).toBeCloseTo((0.2 * 1 + 0.3 * 3) / 0.5, 15);
    expect(legacyView({ outcomes: [{ prob: 1, net: -0.5 }] })).toEqual({ winProb: 0, netPayout: 0 });
  });

  it("validation: 1-12 outcomes, prob > 0, gross return >= 0, sum = 1 within 1e-9; every problem reported, never throws", () => {
    expect(validateGame(ticket(70))).toEqual([]);
    expect(validateGame({ outcomes: [{ prob: 1, net: 0 }] })).toEqual([]); // one outcome: a sure push
    expect(validateGame({ outcomes: Array.from({ length: MAX_OUTCOMES }, () => ({ prob: 1 / MAX_OUTCOMES, net: 0 })) })).toEqual([]);
    expect(validateGame({ outcomes: [] })[0]).toMatch(/1 to 12 outcomes \(got 0\)/);
    expect(validateGame({ outcomes: Array.from({ length: 13 }, () => ({ prob: 1 / 13, net: 0 })) })[0]).toMatch(/got 13/);
    const bad = validateGame({ outcomes: [{ prob: 0, net: 1 }, { prob: 0.5, net: -1.5 }, { prob: NaN, net: Infinity }] });
    expect(bad).toEqual([
      "Outcome 1: probability must be a number greater than 0.",
      "Outcome 2: the return must be at least 0 (net profit at least -1 per $1 staked).",
      "Outcome 3: probability must be a number greater than 0.",
      "Outcome 3: the return must be at least 0 (net profit at least -1 per $1 staked).",
    ]);
    expect(validateGame({ outcomes: [{ prob: 0.5, net: 1 }, { prob: 0.4, net: -1 }] })[0]).toMatch(/add up to 1 \(they add up to 0\.9\)/);
    expect(validateGame({ outcomes: [{ prob: 0.5, net: 1 }, { prob: 0.5 + 5e-10, net: -1 }] })).toEqual([]); // within 1e-9
    expect(validateGame({ outcomes: [{ prob: 0.5, net: 1 }, { prob: 0.5 + 2e-9, net: -1 }] })).toHaveLength(1);
    expect(() => validateGame({ outcomes: [null as never] })).not.toThrow();
    // The binary shorthand keeps its old messages.
    expect(validateGame({ winProb: 1, netPayout: 0 })).toEqual(["Win probability must be strictly between 0 and 1.", "Net payout must be greater than 0."]);
  });
});

describe("probability text: exact fractions and decimals", () => {
  const ok = (t: string): Rational => {
    const r = parseProbability(t);
    if (!r.ok) throw new Error(r.error);
    return r.value;
  };

  it('"1/6" + "3/6" + "2/6" sums to EXACTLY 1', () => {
    const sum = [ok("1/6"), ok("3/6"), ok("2/6")].reduce(addRational);
    expect(sum).toEqual({ num: 1n, den: 1n });
    expect([ok("1/3"), ok("1/3"), ok("1/3")].reduce(addRational)).toEqual({ num: 1n, den: 1n });
    expect([ok("0.1"), ok("0.2"), ok("0.7")].reduce(addRational)).toEqual({ num: 1n, den: 1n }); // 0.1 + 0.2 is exact here
  });

  it("decimals and fractions parse exactly, reduced; the float is the correctly rounded quotient", () => {
    expect(ok("0.25")).toEqual({ num: 1n, den: 4n });
    expect(ok(".5")).toEqual({ num: 1n, den: 2n });
    expect(ok("1")).toEqual({ num: 1n, den: 1n });
    expect(ok(" 3/6 ")).toEqual({ num: 1n, den: 2n });
    expect(ok("0.001")).toEqual({ num: 1n, den: 1000n });
    const r = parseProbability("1/6");
    expect(r.ok && r.float).toBe(1 / 6);
  });

  it("rejects bad input with readable errors", () => {
    const err = (t: unknown) => {
      const r = parseProbability(t);
      if (r.ok) throw new Error(`accepted ${String(t)}`);
      return r.error;
    };
    expect(err("1/0")).toBe('Cannot divide by zero (got "1/0").');
    expect(err("abc")).toBe('Not a probability: "abc". Use a decimal (0.25) or a fraction (1/6).');
    expect(err("-0.2")).toBe('A probability cannot be negative (got "-0.2").');
    expect(err("-1/6")).toBe('A probability cannot be negative (got "-1/6").');
    expect(err("0")).toBe('A probability must be greater than 0 (got "0").');
    expect(err("0/5")).toBe('A probability must be greater than 0 (got "0/5").');
    expect(err("7/6")).toBe('A probability cannot be more than 1 (got "7/6").');
    expect(err("1.5")).toBe('A probability cannot be more than 1 (got "1.5").');
    expect(err("")).toMatch(/^Enter a probability/);
    expect(err(".")).toMatch(/^Not a probability/);
    expect(err("1e-3")).toMatch(/^Not a probability/);
    expect(err("1/2/3")).toMatch(/^Not a probability/);
    expect(err("0x10")).toMatch(/^Not a probability/);
    expect(err("1".repeat(41))).toMatch(/^Too long/);
    expect(err(0.5)).toBe("Enter a probability.");
  });
});
