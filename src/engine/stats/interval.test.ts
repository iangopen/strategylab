import { describe, expect, it } from "vitest";
import { wilsonInterval, Z_95 } from "./interval";

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
