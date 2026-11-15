import { describe, expect, it } from "vitest";
import { contains, evClaim, evDifference, evInterval, overlaps, takeaways, type TakeawayStrategy } from "./takeaways";

// Hand-built stats objects (no simulation): each case pins what the sentences may and may not claim.
const EDGE = 1 / 37; // European roulette, theoretical EV per $ = -2.70%
const N = 10_000;

/** A strategy's stats. EV interval = ev ± 1.96 se; P(bust) and P(profit) intervals given directly. */
function strat(label: string, s: { ev: number; se: number; bust: [number, number, number]; profit?: [number, number, number]; med?: number; p10?: number }): TakeawayStrategy {
  const [pBust, pBustLow, pBustHigh] = s.bust;
  const [pProfit, pProfitLow, pProfitHigh] = s.profit ?? [0.5, 0.49, 0.51];
  return {
    label,
    stats: { evPerWagered: s.ev, evSE: s.se, pBust, pBustLow, pBustHigh, pProfit, pProfitLow, pProfitHigh, bustRoundsMedian: s.med ?? NaN, bustRoundsP10: s.p10 ?? NaN },
  };
}

const flat = strat("Flat", { ev: -0.02758, se: 0.00042, bust: [0.016, 0.01372, 0.01865], profit: [0.5376, 0.52782, 0.54736], med: 874, p10: 647.4 });
const martingale = strat("Martingale", { ev: -0.02909, se: 0.00432, bust: [0.1707, 0.16345, 0.1782], profit: [0.8293, 0.8218, 0.83655], med: 14, p10: 6 });

describe("interval helpers", () => {
  it("contains and overlaps include the bounds", () => {
    expect(contains({ low: -1, high: 1 }, 0)).toBe(true);
    expect(contains({ low: 0, high: 1 }, 0)).toBe(true);
    expect(contains({ low: 0.1, high: 1 }, 0)).toBe(false);
    expect(overlaps({ low: 0, high: 1 }, { low: 1, high: 2 })).toBe(true);
    expect(overlaps({ low: 0, high: 1 }, { low: 1.01, high: 2 })).toBe(false);
  });
  it("the EV interval is ev ± 1.96 SE, or null when either is missing", () => {
    const iv = evInterval({ evPerWagered: -0.02, evSE: 0.01 })!;
    expect(iv.low).toBeCloseTo(-0.0396, 12);
    expect(iv.high).toBeCloseTo(-0.0004, 12);
    expect(evInterval({ evPerWagered: NaN, evSE: NaN })).toBeNull();
  });
});

describe("takeaways", () => {
  it("the default run: three to five sentences in order (edge, EV, bust, timing, contrast)", () => {
    const t = takeaways({ edge: EDGE, nSessions: N, strategies: [flat, martingale] });
    for (const s of t) console.log(`[takeaway] ${s}`);
    expect(t.length).toBeGreaterThanOrEqual(3);
    expect(t.length).toBeLessThanOrEqual(5);
    expect(t[0]).toBe(
      "Every bet in this game loses 2.70% of its stake on average (the house edge), so every strategy should lose about 2.70% of everything it wagers; a strategy can change only how much is wagered and how the results are spread out.",
    );
    expect(t[1]).toContain("Flat -2.76% (-2.84% to -2.68%) and Martingale -2.91% (-3.76% to -2.06%)");
    expect(t[1]).toContain("every interval includes the theoretical -2.70%");
    expect(t[2]).toContain("Flat 1.6% (1.4–1.9%) and Martingale 17.1% (16.3–17.8%)");
    expect(t[1]).toContain("as independent samples of 10,000 sessions each (Welch interval), Martingale's EV per $ minus Flat's is -0.15 percentage points (95% interval -1.00 to 0.70), which includes zero: the difference between the strategies isn't clear at this sample size.");
    expect(t[2]).toContain("as independent samples of 10,000 sessions each (Newcombe interval), Martingale's bust rate minus Flat's is 15.5 percentage points (95% interval 14.7 to 16.3), which excludes zero: Martingale went bust more often than Flat.");
    expect(t[3]).toBe("Counting busted sessions only, half of Flat's busts came by round 874 and the earliest tenth by round 647.4; half of Martingale's busts came by round 14 and the earliest tenth by round 6.");
    expect(t[4]).toContain("Martingale ended ahead in 82.9% (82.2–83.7%) of sessions yet lost money per dollar wagered on average");
  });

  it("clear loss: an EV interval wholly below zero is reported as is, with no 'not clear' hedge", () => {
    const t = takeaways({ edge: EDGE, nSessions: N, strategies: [flat] });
    expect(t[1]).toBe("Measured EV per $ wagered, with 95% intervals: Flat -2.76% (-2.84% to -2.68%); the interval includes the theoretical -2.70%.");
    expect(t.join(" ")).not.toMatch(/not clear|isn't clear/);
  });

  it("an EV interval straddling zero says the result is not clearly different from zero, and no contrast sentence claims a loss", () => {
    const s = strat("Paroli", { ev: -0.004, se: 0.003, bust: [0.02, 0.017, 0.023], profit: [0.6, 0.59, 0.61], med: 40, p10: 12 });
    const t = takeaways({ edge: EDGE, nSessions: N, strategies: [s] });
    expect(t[1]).toContain("for Paroli the result is not clearly different from zero at this sample size");
    expect(t.join(" ")).not.toContain("lost money per dollar");
  });

  it("a tie between strategies: a difference interval that includes zero says the difference isn't clear, and names no winner", () => {
    const a = strat("Flat", { ev: -0.027, se: 0.002, bust: [0.05, 0.045, 0.055] });
    const b = strat("D'Alembert", { ev: -0.029, se: 0.002, bust: [0.054, 0.049, 0.059] });
    const t = takeaways({ edge: EDGE, nSessions: N, strategies: [a, b] });
    expect(t[1]).toContain("the difference between the strategies isn't clear at this sample size");
    expect(t[2]).toContain("the difference in bust rates isn't clear at this sample size");
    expect(t.join(" ")).not.toMatch(/more often|measured a lower EV/);
  });

  it("a difference interval that excludes zero names the difference, with its size and interval", () => {
    const a = strat("A", { ev: -0.01, se: 0.001, bust: [0.01, 0.008, 0.012] });
    const b = strat("B", { ev: -0.05, se: 0.001, bust: [0.3, 0.29, 0.31] });
    const t = takeaways({ edge: EDGE, nSessions: N, strategies: [a, b] });
    expect(t[1]).toContain("B's EV per $ minus A's is -4.00 percentage points (95% interval -4.28 to -3.72), which excludes zero: B measured a lower EV per $ than A");
    expect(t[1]).toContain("for A and B the interval misses the theoretical -2.70%, which a 95% interval does by chance about one time in twenty");
    expect(t[2]).toContain("B's bust rate minus A's is 29.0 percentage points (95% interval 28.1 to 29.9), which excludes zero: B went bust more often than A");
    expect(t.join(" ")).not.toMatch(/overlap/);
  });

  it("zero busts: 'never went bust' with the interval's upper bound, and no timing sentence for that strategy", () => {
    const none = strat("Flat", { ev: -0.027, se: 0.0005, bust: [0, 0, 0.000384] });
    const t = takeaways({ edge: EDGE, nSessions: N, strategies: [none, martingale] });
    expect(t[2]).toContain("Flat never (interval up to 0.04%)");
    expect(t.join(" ")).not.toContain("Flat's busts");
    expect(t.some((s) => s.startsWith("Counting busted sessions only, half of Martingale's busts"))).toBe(true);

    const all = takeaways({ edge: EDGE, nSessions: N, strategies: [none] });
    expect(all[2]).toBe("No session went bust for Flat in 10,000 sessions; the 95% interval still allows a bust rate of up to 0.04%.");
    expect(all.some((s) => s.includes("busted sessions only"))).toBe(false);
    expect(all.length).toBeGreaterThanOrEqual(3);
  });

  it("every rounds-to-bust sentence says it describes busted sessions only", () => {
    const t = takeaways({ edge: EDGE, nSessions: N, strategies: [flat, martingale] });
    for (const s of t.filter((x) => /round \d/.test(x))) expect(s).toMatch(/^Counting busted sessions only, /);
  });

  it("a strategy that placed no bets is said so, and fair and player-edge games word the edge correctly", () => {
    const kelly: TakeawayStrategy = { label: "Kelly", stats: { evPerWagered: NaN, evSE: NaN, pBust: 0, pBustLow: 0, pBustHigh: 0.000384, pProfit: 0, pProfitLow: 0, pProfitHigh: 0.000384, bustRoundsMedian: NaN, bustRoundsP10: NaN } };
    const t = takeaways({ edge: EDGE, nSessions: N, strategies: [flat, kelly] });
    expect(t[1]).toContain("Flat -2.76% (-2.84% to -2.68%) and Kelly placed no bets");
    // A strategy that never bet is not "never bust": it is left out of the bust comparison.
    expect(t[2]).toBe("Share of sessions that went bust (fell below the table minimum or could not cover the next bet), with 95% intervals: Flat 1.6% (1.4–1.9%).");
    expect(t[2]).not.toContain("Kelly");
    expect(takeaways({ edge: 0, nSessions: N, strategies: [flat] })[0]).toMatch(/^This game is fair: /);
    expect(takeaways({ edge: -0.1, nSessions: N, strategies: [flat] })[0]).toMatch(/^Every bet in this game gains 10.00% of its stake on average \(a player edge\)/);
  });

  it("more than three strategies: each sentence gives the range (lowest and highest), not every strategy, so the page stays one page", () => {
    const many = [
      strat("S1", { ev: -0.026, se: 0.002, bust: [0.014, 0.009, 0.02], med: 938, p10: 763.6 }),
      strat("S2", { ev: -0.016, se: 0.009, bust: [0.159, 0.144, 0.176], med: 14, p10: 6.7 }),
      strat("S3", { ev: -0.028, se: 0.002, bust: [0.165, 0.149, 0.182], med: 644, p10: 394 }),
      strat("S4", { ev: -0.031, se: 0.005, bust: [0.15, 0.135, 0.166], med: 43, p10: 26.9 }),
      strat("S5", { ev: -0.027, se: 0.006, bust: [0.143, 0.128, 0.159], med: 13, p10: 10 }),
    ];
    const t = takeaways({ edge: EDGE, nSessions: 2000, strategies: many });
    for (const s of t) console.log(`[takeaway, 5 strategies] ${s}`);
    expect(t[1]).toContain("ranged from S4 -3.10% (-4.08% to -2.12%) to S2 -1.60% (-3.36% to 0.16%)");
    expect(t[1]).toContain("for S2 the result is not clearly different from zero at this sample size");
    expect(t[1]).toContain("S4's EV per $ minus S2's is -1.50 percentage points (-4.39 to 1.39, widened to keep 95% across all 10 pairs), which includes zero: the difference between the strategies isn't clear at this sample size");
    expect(t[2]).toContain("ranged from S1 1.4% (0.9–2.0%) to S3 16.5% (14.9–18.2%)");
    expect(t[2]).toContain("S3's bust rate minus S1's is 15.1 percentage points (12.7 to 17.6, widened to keep 95% across all 10 pairs), which excludes zero: S3 went bust more often than S1");
    expect(t[3]).toBe("Counting busted sessions only, the median bust came as early as round 13 (S5) and as late as round 938 (S1).");
    for (const s of t) expect(s.length, s).toBeLessThan(560);
  });
  it("a run's paired comparison is used when present, whichever way round the pair is stored, and too few sessions compare nothing", () => {
    const a = strat("A", { ev: -0.027, se: 0.002, bust: [0.05, 0.045, 0.055] });
    const b = strat("B", { ev: -0.029, se: 0.002, bust: [0.054, 0.049, 0.059] });
    // Stored as "a minus b" for indices (0, 1): A − B = +0.2 points, tight because the luck was shared.
    // worstA / worstB: a whole-bankroll loss weighs 0.2 (a $1,000 bankroll against $5,000 wagered per session).
    const cmp = { a: 0, b: 1, n: N, evDiff: 0.002, evDiffSE: 0.0004, bustOnlyA: 10, bustOnlyB: 50, worstA: 0.2, worstB: 0.2 };
    const t = takeaways({ edge: EDGE, nSessions: N, strategies: [a, b], comparisons: [cmp] });
    expect(t[1]).toContain("over the same 10,000 sessions (paired t-interval), B's EV per $ minus A's is -0.20 percentage points (95% interval -0.28 to -0.12), which excludes zero: B measured a lower EV per $ than A.");
    expect(t[2]).toContain("over the same 10,000 sessions (paired-proportion interval), B's bust rate minus A's is 0.4 percentage points (95% interval 0.2 to 0.6), which excludes zero: B went bust more often than A.");
    // The same pair listed the other way round gives the same sentences.
    const flipped = takeaways({ edge: EDGE, nSessions: N, strategies: [b, a], comparisons: [{ ...cmp, evDiff: -0.002, bustOnlyA: 50, bustOnlyB: 10 }] });
    expect(flipped[1]!.split("; ").at(-1)).toBe(t[1]!.split("; ").at(-1));
    expect(evDifference({ edge: EDGE, nSessions: N, strategies: [a, b], comparisons: [cmp] }, 1, 0)!.diff).toBeCloseTo(-0.002, 12);

    const few = takeaways({ edge: EDGE, nSessions: 20, strategies: [a, b], comparisons: [{ ...cmp, n: 20 }] });
    expect(few[1]).toContain("with fewer than 30 sessions the strategies are not compared");
    expect(few[2]).toContain("with fewer than 30 sessions the strategies are not compared");
    expect(few.join(" ")).not.toMatch(/more often|measured a lower EV/);
  });

  it("a fragile EV difference: the interval excludes zero, but one more whole-bankroll loss would undo it, so no difference is named", () => {
    const a = strat("A", { ev: -0.027, se: 0.002, bust: [0.05, 0.045, 0.055] });
    const b = strat("B", { ev: -0.029, se: 0.002, bust: [0.054, 0.049, 0.059] });
    // A looks better by 0.2 points (interval 0.12 to 0.28). One bankroll loss for A weighs 30 here: spread
    // over 10,001 sessions it moves A's EV per $ by 0.3 points, more than the whole difference.
    const cmp = { a: 0, b: 1, n: N, evDiff: 0.002, evDiffSE: 0.0004, bustOnlyA: 10, bustOnlyB: 50, worstA: 30, worstB: 0.2 };
    const input = { edge: EDGE, nSessions: N, strategies: [a, b], comparisons: [cmp] };
    const v = evDifference(input, 0, 1)!;
    expect([v.excludesZero, v.fragile, v.clear]).toEqual([true, true, false]);
    const t = takeaways(input);
    expect(t[1]).toContain("B's EV per $ minus A's is -0.20 percentage points (95% interval -0.28 to -0.12), which excludes zero, but one more whole-bankroll loss would undo that: the difference isn't clear at this sample size.");
    expect(t[1]).not.toMatch(/measured a lower EV/);
    // Only the better-looking strategy is stressed: a large worst case on the WORSE side changes nothing.
    const other = evDifference({ ...input, comparisons: [{ ...cmp, worstA: 0.2, worstB: 30 }] }, 0, 1)!;
    expect([other.fragile, other.clear]).toEqual([false, true]);
    // The fragile sentence is no longer than the "includes zero" one plus a few words, so the page fit holds.
    const plain = takeaways({ ...input, comparisons: [{ ...cmp, evDiffSE: 0.002 }] })[1]!;
    expect(t[1]!.length - plain.length).toBeLessThan(30);
  });

  describe("one strategy's EV per $, with the starting bankroll known (session 24)", () => {
    const BANKROLL = 100_000; // cents
    /** A strategy with the mean wagered per session (cents) the worst-case check needs. */
    const withWagered = (label: string, ev: number, se: number, meanWagered: number): TakeawayStrategy => {
      const s = strat(label, { ev, se, bust: [0, 0, 0.015] });
      return { label, stats: { ...s.stats, meanWagered } };
    };
    const run = (s: TakeawayStrategy, n: number, edge = EDGE) => ({ edge, nSessions: n, strategies: [s], startBankroll: BANKROLL });

    it("an interval above zero that one whole-bankroll loss would undo is never left to read as a gain", () => {
      // 250 sessions, $10 wagered per session: one $1,000 loss weighs 100, or about 40 points of EV per $ here.
      const input = run(withWagered("Martingale", 0.0624, 0.0238, 1000), 250);
      const c = evClaim(input, 0)!;
      expect([c.looksLikeGain, c.fragile, c.missesTheory]).toEqual([true, true, false]);
      const ev = takeaways(input)[1]!;
      expect(ev).toBe("Measured EV per $ wagered, with 95% intervals: Martingale 6.24% (1.58–10.90%); for Martingale the interval is above the theoretical -2.70%, but one more whole-bankroll loss would undo that: this is not evidence of a gain.");
      expect(ev).not.toMatch(/one time in twenty|includes the theoretical/);
      // Without the bankroll (older callers) the plain interval speaks, as before.
      expect(takeaways({ ...input, startBankroll: undefined })[1]).toContain("for Martingale the interval misses the theoretical -2.70%, which a 95% interval does by chance about one time in twenty");
    });

    it("above the theoretical value but below zero, and fragile: 'not evidence of doing better than theory'", () => {
      const input = run(withWagered("Fibonacci", -0.01, 0.005, 10_000), 250);
      const c = evClaim(input, 0)!;
      expect([c.looksLikeGain, c.fragile, c.missesTheory, c.nearZero]).toEqual([false, true, false, false]);
      expect(takeaways(input)[1]).toBe("Measured EV per $ wagered, with 95% intervals: Fibonacci -1.00% (-1.98% to -0.02%); for Fibonacci the interval is above the theoretical -2.70%, but one more whole-bankroll loss would undo that: this is not evidence of doing better than theory.");
    });

    it("a miss that survives the extra loss, and any miss BELOW the theoretical value, is still reported as a chance miss", () => {
      // 10,000 sessions, $5,000 wagered per session: one bankroll loss moves EV per $ by 0.002 points.
      const above = run(withWagered("A", -0.02, 0.002, 500_000), 10_000);
      expect(evClaim(above, 0)).toMatchObject({ fragile: false, missesTheory: true });
      expect(takeaways(above)[1]).toContain("for A the interval misses the theoretical -2.70%, which a 95% interval does by chance about one time in twenty");
      const below = run(withWagered("B", -0.05, 0.005, 1000), 250);
      expect(evClaim(below, 0)).toMatchObject({ fragile: false, missesTheory: true });
    });

    it("a player-edge game: an interval above zero that includes the theoretical value is 'not clearly different from zero' when one bankroll loss would reach zero", () => {
      const input = run(withWagered("Flat", 0.09, 0.02, 1000), 250, -0.1);
      expect(evClaim(input, 0)).toMatchObject({ fragile: false, missesTheory: false, nearZero: true, looksLikeGain: true });
      const ev = takeaways(input)[1]!;
      expect(ev).toContain("the interval includes the theoretical 10.00%");
      expect(ev).toContain("for Flat the result is not clearly different from zero at this sample size");
    });
  });

  it("tone: no advice, tipster or 'winning' language in any generated sentence", () => {
    const t = takeaways({ edge: EDGE, nSessions: N, strategies: [flat, martingale] }).join(" ");
    for (const re of [/\bpicks?\b/i, /\bsharps?\b/i, /value bets?/i, /\bguarantee/i, /winning system/i, /\bwinn(er|ing)\b/i, /\byou should\b/i, /\bbest strategy\b/i, /\brecommend/i]) expect(t, String(re)).not.toMatch(re);
  });
});
