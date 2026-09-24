// The per-session sub-cent carry (session 11): over any session, and at every point inside it, the
// total paid on wins stays within half a cent of the EXACT total bet × netPayout. "Exact" is exact:
// a float payout is a dyadic rational, so the reference total is computed with BigInt fractions.
import { describe, expect, it } from "vitest";
import type { Game } from "./games";
import { netPayoutFromOdds } from "./odds";
import { mulberry32, type Rng } from "./rng";
import { runSessionWithRng } from "./runner";
import type { AnyStrategy } from "./strategies/types";
import { scriptedRng, sessionConfig } from "./testUtils";

/** The exact value of a finite positive double as num / den, den a power of two. */
function exactFraction(x: number): { num: bigint; den: bigint } {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, x);
  const hi = view.getUint32(0);
  const lo = view.getUint32(4);
  const e = (hi >>> 20) & 0x7ff;
  const frac = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  const mant = e === 0 ? frac : frac | (1n << 52n);
  const shift = (e === 0 ? 1 : e) - 1075;
  return shift >= 0 ? { num: mant << BigInt(shift), den: 1n } : { num: mant, den: 1n << BigInt(-shift) };
}

/** Test fixture: bets a scripted list, one entry per round. Never touches the RNG. */
function scriptedBets(bets: readonly number[]): AnyStrategy {
  return {
    id: "scripted",
    label: "scripted bets",
    description: "test fixture",
    configSchema: [],
    defaultConfig: {},
    init: () => null,
    nextBet: (_s, ctx) => bets[ctx.round] ?? "stop",
    update: (s) => s,
  };
}

const START = 10_000_000_000_000; // $100bn: no bet is ever refused or clamped, so every scripted bet is placed

function randomBet(rng: Rng): number {
  // Mostly table-sized bets, some huge ones (up to $10M) to stress the float arithmetic of the carry.
  const k = rng();
  if (k < 0.7) return 1 + Math.floor(rng() * 5_000);
  if (k < 0.95) return 1 + Math.floor(rng() * 1_000_000);
  return 1 + Math.floor(rng() * 1_000_000_000);
}

function payout(format: "american" | "decimal", v: number): number {
  const r = netPayoutFromOdds(format, v);
  if (!r.ok) throw new Error(r.error);
  return r.netPayout;
}

/**
 * Plays one scripted session and returns the largest |paid so far - exact so far| over every round,
 * in cents, measured exactly: the reference is sum(bet_won) × netPayout as a rational.
 * Also checks, at every round, the construction bound: 1/2 cent, plus the float rounding of each
 * `owed = bet × netPayout + carry` (at most one ε × |owed| per win; ~1e-4 cents only at $10bn-scale owed).
 */
function worstDrift(netPayout: number, bets: number[], outcomes: boolean[]): number {
  const game: Game = { id: "p", name: "p", winProb: 0.5, netPayout };
  const cfg = sessionConfig({ startBankroll: START, baseBet: 100, tableMin: 1, maxRounds: bets.length });
  const r = runSessionWithRng(game, scriptedBets(bets), {}, cfg, scriptedRng(outcomes), { recordPath: true });
  expect(r.rounds).toBe(bets.length);
  const { num, den } = exactFraction(netPayout);
  const b = r.path!.bankroll;
  let paid = 0n;
  let wonStakes = 0n;
  let worst = 0n; // max |paid × den - wonStakes × num|
  let floatNoise = 0;
  for (let k = 0; k < bets.length; k++) {
    const delta = b[k + 1]! - b[k]!;
    if (outcomes[k]) {
      paid += BigInt(delta);
      wonStakes += BigInt(bets[k]!);
      floatNoise += Number.EPSILON * (bets[k]! * netPayout + 1);
    } else {
      expect(delta).toBe(-bets[k]!);
    }
    const d = paid * den - wonStakes * num;
    const abs = d < 0n ? -d : d;
    if (abs > worst) worst = abs;
    expect(Number((abs * 1_000_000_000_000n) / den) / 1e12).toBeLessThanOrEqual(0.5 + floatNoise);
  }
  // worst / den in cents, without losing precision before the division.
  return Number((worst * 1_000_000_000_000n) / den) / 1e12;
}

describe("sub-cent carry: |total paid - total exact| < 1 cent over any session (exact rational check)", () => {
  const named: [string, number][] = [
    ["-110", payout("american", -110)],
    ["+150", payout("american", 150)],
    ["decimal 1.91", payout("decimal", 1.91)],
    ["custom 1.2", 1.2],
  ];

  it("named payouts (2,500 sessions each) and 5,000 random payouts: 15,000 random bet sequences", { timeout: 60_000 }, () => {
    const rng = mulberry32(20260924);
    const sequence = (): [number[], boolean[]] => {
      const n = 1 + Math.floor(rng() * 300);
      const bets = Array.from({ length: n }, () => randomBet(rng));
      const outcomes = Array.from({ length: n }, () => rng() < 0.5);
      return [bets, outcomes];
    };
    const report: string[] = [];
    let overall = 0;
    let sessions = 0;
    for (const [name, p] of named) {
      let worst = 0;
      for (let i = 0; i < 2_500; i++) {
        const [bets, outcomes] = sequence();
        worst = Math.max(worst, worstDrift(p, bets, outcomes));
        sessions++;
      }
      report.push(`${name} (netPayout ${p}): max |paid - exact| ${worst.toFixed(12)} cents`);
      overall = Math.max(overall, worst);
    }
    // Random payouts: American, decimal and raw floats across the whole allowed range.
    let worstRandom = 0;
    for (let i = 0; i < 5_000; i++) {
      const kind = i % 3;
      const p =
        kind === 0 ? payout("american", (rng() < 0.5 ? -1 : 1) * (100 + Math.floor(rng() * 99_901)))
        : kind === 1 ? payout("decimal", Number((1.001 + rng() * 1000).toFixed(3)))
        : 0.001 + rng() * 999.999;
      const [bets, outcomes] = sequence();
      worstRandom = Math.max(worstRandom, worstDrift(p, bets, outcomes));
      sessions++;
    }
    report.push(`5,000 random payouts: max |paid - exact| ${worstRandom.toFixed(12)} cents`);
    overall = Math.max(overall, worstRandom);
    console.log(`[carry] ${sessions} sessions, checked after every round:\n  ${report.join("\n  ")}\n  overall max ${overall.toFixed(12)} cents (bound: < 1 cent; by construction <= 0.5 plus float noise)`);
    expect(sessions).toBeGreaterThanOrEqual(10_000);
    expect(overall).toBeLessThan(1);
  });

  it("the carry never crosses sessions: the first win of every session pays Math.round(bet × netPayout)", () => {
    const p = payout("american", -110);
    for (let i = 0; i < 3; i++) {
      const game: Game = { id: "p", name: "p", winProb: 0.5, netPayout: p };
      const r = runSessionWithRng(game, scriptedBets([500]), {}, sessionConfig({ startBankroll: 100_000, maxRounds: 1 }), scriptedRng([true]));
      expect(r.finalBankroll - 100_000).toBe(Math.round(500 * p)); // 455, never 454, in every session
    }
  });

  it("-110 at $5: wins pay 455, 454, 455, 454, ... so the average is the exact 454.545...", () => {
    const p = payout("american", -110);
    const game: Game = { id: "p", name: "p", winProb: 0.5, netPayout: p };
    const n = 22;
    const r = runSessionWithRng(game, scriptedBets(Array(n).fill(500)), {}, sessionConfig({ startBankroll: 100_000, maxRounds: n }), scriptedRng(Array(n).fill(true)), { recordPath: true });
    const deltas = r.path!.bankroll.slice(1).map((b, k) => b - r.path!.bankroll[k]!);
    expect(deltas.slice(0, 4)).toEqual([455, 454, 455, 454]);
    expect(r.finalBankroll - 100_000).toBe(10_000); // 22 × 454.5454... = 10,000 exactly
  });

  it("the exact-fraction helper is exact", () => {
    expect(exactFraction(0.5)).toEqual({ num: 1n << 52n, den: 1n << 53n });
    expect(exactFraction(35)).toEqual({ num: 35n << 47n, den: 1n << 47n });
    const { num, den } = exactFraction(0.1);
    expect(Number(num) / Number(den)).toBe(0.1);
  });
});
