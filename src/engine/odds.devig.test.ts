import { describe, expect, it } from "vitest";
import { mulberry32 } from "./rng";
import { marketDevig, netPayoutFromOdds, payoutRoundingBias, sportsGame, type SportsInput } from "./odds";

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

describe("cents rounding bias (runner pays Math.round(bet × netPayout))", () => {
  it("flat bettor at -110 / -110 (p = 0.5): the hand-computed table in CLAUDE.md", () => {
    const n = 100 / 110;
    const rows = [100, 500, 1000, 2500].map((b) => ({ bet: b, bias: payoutRoundingBias(b, n, 0.5) }));
    for (const r of rows) console.log(`[rounding] -110, bet $${r.bet / 100}: win pays ${(r.bet * n).toFixed(4)}¢ -> ${Math.round(r.bet * n)}¢, bias ${(r.bias * 100).toFixed(4)}% per $`);
    expect(rows[0]!.bias).toBeCloseTo((0.5 * (91 - 9000 / 99)) / 100, 15); // +0.0455%
    expect(rows[1]!.bias).toBeCloseTo((0.5 * (455 - 50000 / 110)) / 500, 15); // +0.0455%
    expect(rows[2]!.bias).toBeCloseTo((0.5 * (909 - 100000 / 110)) / 1000, 15); // -0.0045%
    expect(rows[3]!.bias).toBeCloseTo((0.5 * (2273 - 250000 / 110)) / 2500, 15); // +0.0055%
    expect(rows.map((r) => Number((r.bias * 100).toFixed(4)))).toEqual([0.0455, 0.0455, -0.0045, 0.0055]);
  });

  it("worst case at the default $10 bet, over many payouts, is within 0.5 × p / bet (0.025% per $ at p = 0.5)", () => {
    let worst = 0;
    // Payouts (i + 0.5) / 100,000 make 1000 × n sweep every fractional part 0.005, 0.015, ..., 0.995.
    for (let i = 1; i <= 100_000; i++) worst = Math.max(worst, Math.abs(payoutRoundingBias(1000, (i + 0.5) / 100_000, 0.5)));
    console.log(`[rounding] worst |bias| at a $10 bet over 100,000 payouts: ${(worst * 100).toFixed(5)}% per $ (bound 0.025%)`);
    expect(worst).toBeLessThanOrEqual(0.5 * 0.5 / 1000);
    expect(worst).toBeGreaterThan(0.99 * 0.5 * 0.5 / 1000); // the bound is attained (nearly)
  });

  it("the other examples at the app default $10 bet", () => {
    for (const [format, v] of [["american", 150], ["american", -180], ["decimal", 1.91]] as const) {
      const c = netPayoutFromOdds(format, v);
      if (!c.ok) throw new Error(c.error);
      console.log(`[rounding] ${format} ${v} at $10: bias ${(payoutRoundingBias(1000, c.netPayout, 0.5) * 100).toFixed(4)}% per $ at p = 0.5`);
    }
  });
});
