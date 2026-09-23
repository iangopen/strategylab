import { describe, expect, it } from "vitest";
import { quantileSorted, sortedCopy } from "./quantile";

// Expected values hand-computed with type 7: h = (n-1)p, x[floor h] + frac(h) * (x[floor h + 1] - x[floor h]).
describe("quantileSorted (type 7)", () => {
  it("odd length [1, 2, 3, 4, 5]", () => {
    const x = [1, 2, 3, 4, 5];
    expect(quantileSorted(x, 0)).toBe(1);
    expect(quantileSorted(x, 0.05)).toBeCloseTo(1.2, 12); // h = 0.2
    expect(quantileSorted(x, 0.25)).toBe(2); // h = 1
    expect(quantileSorted(x, 0.5)).toBe(3); // h = 2
    expect(quantileSorted(x, 0.95)).toBeCloseTo(4.8, 12); // h = 3.8
    expect(quantileSorted(x, 1)).toBe(5);
  });

  it("even length [10, 20, 30, 40]", () => {
    const x = [10, 20, 30, 40];
    expect(quantileSorted(x, 0.5)).toBe(25); // h = 1.5
    expect(quantileSorted(x, 0.25)).toBeCloseTo(17.5, 12); // h = 0.75
    expect(quantileSorted(x, 0.75)).toBeCloseTo(32.5, 12); // h = 2.25
    expect(quantileSorted(x, 0.05)).toBeCloseTo(11.5, 12); // h = 0.15
  });

  it("single element", () => {
    for (const p of [0, 0.05, 0.5, 0.95, 1]) expect(quantileSorted([7], p)).toBe(7);
  });

  it("ties [1, 2, 2, 2, 9]", () => {
    const x = [1, 2, 2, 2, 9];
    expect(quantileSorted(x, 0.25)).toBe(2); // h = 1
    expect(quantileSorted(x, 0.5)).toBe(2);
    expect(quantileSorted(x, 0.75)).toBe(2); // h = 3
    expect(quantileSorted(x, 0.9)).toBeCloseTo(6.2, 12); // h = 3.6: 2 + 0.6 * 7
    expect(quantileSorted(x, 0.1)).toBeCloseTo(1.4, 12); // h = 0.4
  });

  it("NaN for empty input or p outside [0, 1]", () => {
    expect(quantileSorted([], 0.5)).toBeNaN();
    expect(quantileSorted([1, 2], -0.1)).toBeNaN();
    expect(quantileSorted([1, 2], 1.1)).toBeNaN();
  });
});

describe("sortedCopy", () => {
  it("sorts numerically (not as strings), uses only the first count values, leaves the input alone", () => {
    const col = new Float64Array([100, -5, 20, 3, 999]);
    const s = sortedCopy(col, 4);
    expect(Array.from(s)).toEqual([-5, 3, 20, 100]);
    expect(Array.from(col)).toEqual([100, -5, 20, 3, 999]);
  });
});
