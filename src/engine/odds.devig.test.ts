import { describe, expect, it } from "vitest";
import { mulberry32 } from "./rng";
import { marketDevig, sportsGame, type SportsInput } from "./odds";

const market = (sideA: number, sideB: number, side: "a" | "b" = "a", format: "american" | "decimal" = "american"): SportsInput => ({ mode: "market", format, sideA, sideB, side, estimate: 0.5 });

function ok(input: SportsInput) {
  const r = sportsGame(input);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r;
}

describe("proportional de-vig (hand-computed)", () => {
  it("-110 / -110: fair p 0.5, overround 1/21 = 4.762%, house edge 1/22 = 4.545% (= 1 - 0.5 × 1.9091)", () => {
    const r = ok(market(-110, -110));
    expect(r.readout.impliedA).toBeCloseTo(11 / 21, 15);
    expect(r.readout.impliedB).toBeCloseTo(11 / 21, 15);
    expect(r.readout.overround).toBeCloseTo(1 / 21, 15); // 0.047619
    expect(r.winProb).toBeCloseTo(0.5, 15);
    expect(r.netPayout).toBe(100 / 110);
    expect(r.readout.edge).toBeCloseTo(1 / 22, 15); // 0.0454545
    expect(r.readout.edge).toBeCloseTo(1 - 0.5 * 1.9090909090909092, 15);
    expect(ok(market(-110, -110, "b")).readout.edge).toBeCloseTo(1 / 22, 15);
    expect(r.readout.negativeOverround).toBe(false);
  });

  it("+150 / -180: implied 0.4 and 9/14, overround 3/70 = 4.286%, fair p 28/73 and 45/73, edge 3/73 = 4.110% on BOTH sides", () => {
    // Hand: +150 -> net 1.5, implied 1/2.5 = 0.4. -180 -> net 100/180 = 5/9, implied 1/(14/9) = 9/14.
    // Sum = 0.4 + 9/14 = 73/70. Fair A = 0.4/(73/70) = 28/73; fair B = (9/14)/(73/70) = 45/73.
    // Edge A = 1 - (28/73)(2.5) = 3/73. Edge B = 1 - (45/73)(14/9) = 1 - 70/73 = 3/73.
    const a = ok(market(150, -180, "a"));
    expect(a.readout.impliedA).toBeCloseTo(0.4, 15);
    expect(a.readout.impliedB).toBeCloseTo(9 / 14, 15);
    expect(a.readout.overround).toBeCloseTo(3 / 70, 15); // 0.042857
    expect(a.winProb).toBeCloseTo(28 / 73, 15); // 0.383562
    expect(a.netPayout).toBe(1.5);
    expect(a.readout.edge).toBeCloseTo(3 / 73, 15); // 0.041096
    const b = ok(market(150, -180, "b"));
    expect(b.winProb).toBeCloseTo(45 / 73, 15); // 0.616438
    expect(b.netPayout).toBe(100 / 180);
    expect(b.readout.edge).toBeCloseTo(3 / 73, 15);
  });

  it("identity: the edge is 1 - 1/(implied_A + implied_B) on both sides, for 2,000 random markets", () => {
    const rng = mulberry32(8);
    for (let i = 0; i < 2000; i++) {
      const nA = 0.05 + rng() * 5;
      const nB = 0.05 + rng() * 5;
      const sum = 1 / (1 + nA) + 1 / (1 + nB);
      expect(marketDevig(nA, nB, "a").edge).toBeCloseTo(1 - 1 / sum, 12);
      expect(marketDevig(nA, nB, "b").edge).toBeCloseTo(1 - 1 / sum, 12);
    }
  });

  it("decimal prices give the same market: 1.91 / 1.91 -> fair p 0.5, edge 1 - 0.5 × 1.91 = 4.5%", () => {
    const r = ok(market(1.91, 1.91, "a", "decimal"));
    expect(r.winProb).toBeCloseTo(0.5, 15);
    expect(r.netPayout).toBe(0.91);
    expect(r.readout.edge).toBeCloseTo(0.045, 15);
  });

  it("a negative overround is accepted but flagged (rare, usually a data-entry error): +110 / +110", () => {
    const r = ok(market(110, 110));
    expect(r.readout.overround).toBeCloseTo(2 / 2.1 - 1, 15); // -0.047619
    expect(r.readout.negativeOverround).toBe(true);
    expect(r.readout.edge).toBeCloseTo(1 - 0.5 * 2.1, 15); // -0.05: the bettor has the edge as entered
  });

  it("errors are per field; the other side is only checked in market mode", () => {
    expect(sportsGame(market(-50, -110))).toEqual({ ok: false, errors: { sideA: "American odds must be +100 or higher, or -100 or lower (got -50)." } });
    expect(sportsGame(market(-110, 0))).toEqual({ ok: false, errors: { sideB: "American odds must be +100 or higher, or -100 or lower (got 0)." } });
    expect(sportsGame({ ...market(-110, 0), mode: "estimate", estimate: 0.55 }).ok).toBe(true); // side B ignored
    expect(sportsGame({ ...market(-110, -110), mode: "estimate", estimate: 1 })).toEqual({ ok: false, errors: { estimate: "Your estimate must be between 0.01 and 0.99 (got 1)." } });
    expect(sportsGame({ ...market(-110, -110), mode: "estimate", estimate: NaN })).toEqual({ ok: false, errors: { estimate: "Enter your estimated win probability." } });
  });
});

describe("my-estimate mode", () => {
  it("estimate 0.55 on -110: winProb 0.55, payout 10/11, edge 1 - 0.55 × 21/11 = -0.05 (a PLAYER edge, believed)", () => {
    const r = ok({ mode: "estimate", format: "american", sideA: -110, sideB: -110, side: "a", estimate: 0.55 });
    expect(r.winProb).toBe(0.55);
    expect(r.netPayout).toBe(100 / 110);
    expect(r.readout.edge).toBeCloseTo(-0.05, 15);
    expect(r.readout.fairP).toBeNull();
    expect(r.readout.impliedA).toBeCloseTo(11 / 21, 15);
  });
});
