import { describe, expect, it } from "vitest";
import { familyQuantilePoint, independentProportionInterval, normalQuantile, pairedProportionInterval, tInterval, tQuantile, welchDf, wilsonInterval, Z_95 } from "./interval";

describe("quantiles", () => {
  it("normalQuantile matches standard table values", () => {
    for (const [p, z] of [[0.975, 1.959964], [0.995, 2.575829], [0.9, 1.281552], [0.5, 0], [0.025, -1.959964], [0.9975, 2.807034], [0.999, 3.090232]] as const) expect(normalQuantile(p)).toBeCloseTo(z, 5);
    expect(normalQuantile(0)).toBe(-Infinity);
    expect(normalQuantile(1)).toBe(Infinity);
    expect(normalQuantile(1.5)).toBeNaN();
  });

  it("tQuantile matches t-table values for the degrees of freedom the report can use (df >= 29)", () => {
    for (const [p, df, t] of [[0.975, 29, 2.0452], [0.975, 30, 2.0423], [0.975, 60, 2.0003], [0.975, 120, 1.9799], [0.995, 30, 2.75], [0.9975, 29, 3.0380]] as const) expect(tQuantile(p, df)).toBeCloseTo(t, 3);
    expect(tQuantile(0.975, 1e9)).toBeCloseTo(1.959964, 5);
  });

  it("a family of comparisons uses a higher point: 0.975 for one, 0.9975 for ten", () => {
    expect(familyQuantilePoint(1)).toBeCloseTo(0.975, 12);
    expect(familyQuantilePoint(10)).toBeCloseTo(0.9975, 12);
    expect(familyQuantilePoint(28)).toBeCloseTo(1 - 0.05 / 56, 12);
  });
});

describe("difference intervals", () => {
  it("tInterval is estimate ± t × se, and NaN on bad input", () => {
    const r = tInterval(1, 0.5, 30);
    expect(r.low).toBeCloseTo(1 - 2.0423 * 0.5, 3);
    expect(r.high).toBeCloseTo(1 + 2.0423 * 0.5, 3);
    expect(tInterval(NaN, 1, 30).low).toBeNaN();
    expect(tInterval(1, 1, 0).low).toBeNaN();
  });

  it("welchDf: equal SEs and sizes give 2(n − 1); one dominant SE gives about its own n − 1", () => {
    expect(welchDf(2, 2, 50, 50)).toBeCloseTo(98, 9);
    expect(welchDf(5, 1e-6, 50, 50)).toBeCloseTo(49, 3);
  });

  it("pairedProportionInterval (Bonett-Price): the formula by hand, the raw difference as the point, antisymmetric", () => {
    // onlyA 12, onlyB 4, n 100: p~ = 13/102 and 5/102; centre 8/102; half = 1.96 sqrt((18/102 − (8/102)²)/102).
    const r = pairedProportionInterval(12, 4, 100);
    const half = 1.96 * Math.sqrt((18 / 102 - (8 / 102) ** 2) / 102);
    expect(r.diff).toBeCloseTo(0.08, 12);
    expect(r.low).toBeCloseTo(8 / 102 - half, 12);
    expect(r.high).toBeCloseTo(8 / 102 + half, 12);
    const m = pairedProportionInterval(4, 12, 100);
    expect(m.low).toBeCloseTo(-r.high, 12);
    expect(m.high).toBeCloseTo(-r.low, 12);
    expect(pairedProportionInterval(60, 50, 100).low).toBeNaN(); // more discordant sessions than sessions
  });

  it("independentProportionInterval matches Newcombe's (1998) worked example: 56/70 against 48/80", () => {
    const r = independentProportionInterval(56, 70, 48, 80);
    expect(r.diff).toBeCloseTo(0.2, 12);
    expect(r.low).toBeCloseTo(0.0524, 3);
    expect(r.high).toBeCloseTo(0.3339, 3);
  });
});

// Reference values computed independently from the Wilson formula (z = 1.96):
// center = (p + z²/2n) / (1 + z²/n), half = z·sqrt(p(1 − p)/n + z²/4n²) / (1 + z²/n).
const CASES: [number, number, number, number][] = [
  [0, 10, 0, 0.27754],
  [5, 10, 0.23659, 0.76341],
  [10, 10, 0.72246, 1],
  [2, 5, 0.117618, 0.76928],
  [1, 3, 0.06149, 0.792345],
];

describe("wilsonInterval (95%)", () => {
  for (const [k, n, low, high] of CASES) {
    it(`k ${k}, n ${n}: [${low}, ${high}]`, () => {
      const r = wilsonInterval(k, n);
      console.log(`[wilson] k=${k} n=${n}: [${r.low.toFixed(6)}, ${r.high.toFixed(6)}]`);
      expect(r.low).toBeCloseTo(low, 5);
      expect(r.high).toBeCloseTo(high, 5);
    });
  }

  it("pins the bound exactly at k = 0 and k = n", () => {
    expect(wilsonInterval(0, 10).low).toBe(0);
    expect(wilsonInterval(10, 10).high).toBe(1);
  });

  it("k = 0 still has an upper bound above 0 (the normal approximation collapses to [0, 0])", () => {
    expect(wilsonInterval(0, 10).high).toBeGreaterThan(0.2);
    expect(wilsonInterval(0, 20_000).high).toBeGreaterThan(0);
  });

  it("is symmetric: the interval for k is the mirror of the one for n − k", () => {
    const a = wilsonInterval(3, 17);
    const b = wilsonInterval(14, 17);
    expect(a.low).toBeCloseTo(1 - b.high, 12);
    expect(a.high).toBeCloseTo(1 - b.low, 12);
  });

  it("contains p, stays in [0, 1], and narrows as n grows", () => {
    for (const n of [1, 7, 100, 20_000]) {
      for (const k of [0, Math.floor(n / 3), n]) {
        const r = wilsonInterval(k, n);
        expect(r.low).toBeGreaterThanOrEqual(0);
        expect(r.high).toBeLessThanOrEqual(1);
        expect(r.low).toBeLessThanOrEqual(k / n);
        expect(r.high).toBeGreaterThanOrEqual(k / n);
      }
    }
    const width = (n: number) => wilsonInterval(n / 2, n).high - wilsonInterval(n / 2, n).low;
    expect(width(100)).toBeLessThan(width(10));
    expect(width(10_000)).toBeLessThan(width(100));
  });

  it("a larger z gives a wider interval", () => {
    const narrow = wilsonInterval(30, 100, Z_95);
    const wide = wilsonInterval(30, 100, 4);
    expect(wide.low).toBeLessThan(narrow.low);
    expect(wide.high).toBeGreaterThan(narrow.high);
  });

  it("NaN bounds when n = 0 or the counts are invalid", () => {
    for (const [k, n] of [[0, 0], [1, 0], [-1, 10], [11, 10], [NaN, 10]] as const) {
      const r = wilsonInterval(k, n);
      expect(r.low).toBeNaN();
      expect(r.high).toBeNaN();
    }
  });
});
