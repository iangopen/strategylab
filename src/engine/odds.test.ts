import { describe, expect, it } from "vitest";
import { convertOdds, displayOdds, impliedProb, netPayoutFromOdds, ODDS_LIMITS, snapShortDecimal } from "./odds";

const net = (format: "american" | "decimal", v: number) => {
  const r = netPayoutFromOdds(format, v);
  if (!r.ok) throw new Error(r.error);
  return r.netPayout;
};

describe("odds conversions (hand-computed values)", () => {
  it("American: +X -> X/100, -X -> 100/X", () => {
    expect(net("american", 150)).toBe(1.5);
    expect(net("american", -110)).toBe(100 / 110); // 10/11 = 0.909090...
    expect(net("american", -110)).toBeCloseTo(0.9090909090909091, 15);
    expect(net("american", -180)).toBe(100 / 180); // 5/9 = 0.5555...
    expect(net("american", -180)).toBeCloseTo(0.5555555555555556, 15);
    expect(net("american", 100)).toBe(1);
    expect(net("american", -100)).toBe(1); // same price as +100
  });

  it("decimal: d -> d - 1, without the float artifact (1.91 - 1 = 0.9099999999999999 in floating point)", () => {
    expect(1.91 - 1).not.toBe(0.91); // the artifact exists...
    expect(net("decimal", 1.91)).toBe(0.91); // ...and is removed
    expect(net("decimal", 2.5)).toBe(1.5);
    expect(net("decimal", 2)).toBe(1);
  });

  it("implied probability = 1 / (1 + netPayout)", () => {
    expect(impliedProb(net("american", 150))).toBeCloseTo(0.4, 15);
    expect(impliedProb(net("american", -110))).toBeCloseTo(11 / 21, 15); // 0.523810
    expect(impliedProb(net("american", -180))).toBeCloseTo(9 / 14, 15); // 0.642857
    expect(impliedProb(net("american", 100))).toBe(0.5);
    expect(impliedProb(net("decimal", 1.91))).toBeCloseTo(1 / 1.91, 15); // 0.523560
    expect(impliedProb(net("decimal", 2.5))).toBe(0.4);
  });

  it("rejects invalid prices with readable errors", () => {
    const err = (f: "american" | "decimal", v: number) => {
      const r = netPayoutFromOdds(f, v);
      expect(r.ok, `${f} ${v}`).toBe(false);
      return r.ok ? "" : r.error;
    };
    expect(err("american", -50)).toBe("American odds must be +100 or higher, or -100 or lower (got -50).");
    expect(err("american", 99)).toBe("American odds must be +100 or higher, or -100 or lower (got 99).");
    expect(err("american", 0)).toBe("American odds must be +100 or higher, or -100 or lower (got 0).");
    expect(err("american", -99.99)).toMatch(/\+100 or higher, or -100 or lower/);
    expect(err("american", NaN)).toBe("Enter a number for the odds.");
    expect(err("american", Infinity)).toBe("American odds must be between -100,000 and +100,000 (got Infinity).");
    expect(err("american", -100_001)).toMatch(/between -100,000 and \+100,000/);
    expect(err("decimal", 1.0)).toBe("Decimal odds must be greater than 1 (got 1).");
    expect(err("decimal", 0.5)).toBe("Decimal odds must be greater than 1 (got 0.5).");
    expect(err("decimal", NaN)).toBe("Enter a number for the odds.");
    expect(err("decimal", -Infinity)).toBe("Decimal odds must be greater than 1 (got -Infinity).");
    expect(err("decimal", 1.0005)).toBe("Decimal odds must be between 1.001 and 1,001 (got 1.0005).");
    expect(err("decimal", 1002)).toMatch(/between 1.001 and 1,001/);
  });

  it("limits are inclusive and give payouts 0.001 to 1,000 in both formats", () => {
    expect(net("american", ODDS_LIMITS.americanMax)).toBe(1000);
    expect(net("american", -ODDS_LIMITS.americanMax)).toBe(0.001);
    expect(net("decimal", ODDS_LIMITS.decimalMax)).toBe(1000);
    expect(net("decimal", ODDS_LIMITS.decimalMin)).toBe(0.001);
  });
});

describe("format toggle: exact conversion, rounded display", () => {
  it("American -> decimal -> American returns the original EXACTLY", () => {
    for (const a of [-110, 150, -180, 100, -250, 333, -105, 10_000, -100_000]) {
      const d = convertOdds(a, "american", "decimal");
      const back = convertOdds(d, "decimal", "american");
      expect(back, `${a} -> ${d} -> ${back}`).toBe(a === -100 ? 100 : a);
    }
  });

  it("the converted decimal carries the full price (not a rounded 1.91) and pays the same to the last bit or so", () => {
    const d = convertOdds(-110, "american", "decimal");
    expect(d).toBe(1 + 100 / 110); // 1.9090909090909092
    expect(displayOdds("decimal", d)).toBe("1.91"); // shown rounded
    expect(Math.abs(net("decimal", d) - net("american", -110))).toBeLessThanOrEqual(2 * Number.EPSILON);
  });

  it("decimal -> American -> decimal also round-trips for typed decimals", () => {
    for (const d of [1.91, 2.5, 1.5, 3.75, 1.001, 1001]) {
      expect(convertOdds(convertOdds(d, "decimal", "american"), "american", "decimal")).toBe(d);
    }
    expect(displayOdds("american", convertOdds(1.91, "decimal", "american"))).toBe("-110"); // -109.890... shown whole
  });

  it("even money converts to +100; invalid values and same-format conversions are unchanged", () => {
    expect(convertOdds(-100, "american", "decimal")).toBe(2);
    expect(convertOdds(2, "decimal", "american")).toBe(100);
    expect(convertOdds(-50, "american", "decimal")).toBe(-50);
    expect(convertOdds(1.5, "decimal", "decimal")).toBe(1.5);
  });

  it("display: whole American with a sign, 2-decimal decimals", () => {
    expect([150, -110, 100, -109.89010989011, 149.6].map((v) => displayOdds("american", v))).toEqual(["+150", "-110", "+100", "-110", "+150"]);
    expect([1.9090909090909092, 2.5, 1.005].map((v) => displayOdds("decimal", v))).toEqual(["1.91", "2.50", "1.00"]);
  });

  it("snapShortDecimal snaps only float artifacts, never real digits", () => {
    expect(snapShortDecimal(0.9099999999999999)).toBe(0.91);
    expect(snapShortDecimal(0.9090909090909092)).toBe(0.9090909090909092);
    expect(snapShortDecimal(1 / 3)).toBe(1 / 3);
  });
});
