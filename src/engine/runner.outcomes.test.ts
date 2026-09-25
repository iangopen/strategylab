// Multi-outcome rounds (session 13): the one-draw mapping, payouts, pushes and the carry exemptions.
import { describe, expect, it } from "vitest";
import type { OutcomesGame } from "./games";
import { mulberry32, sessionSeed, type Rng } from "./rng";
import { compileGame, outcomeIndex, runSessionWithRng } from "./runner";
import type { AnyStrategy } from "./strategies/types";
import { countingRng, sessionConfig } from "./testUtils";

export const TICKET_70: OutcomesGame = {
  id: "ticket70",
  name: "Ticket at $70",
  outcomes: [
    { prob: 1 / 6, net: (20 - 70) / 70, label: "$20" },
    { prob: 3 / 6, net: (50 - 70) / 70, label: "$50" },
    { prob: 2 / 6, net: (100 - 70) / 70, label: "$100" },
  ],
};

const PUSH_GAME: OutcomesGame = {
  id: "push",
  name: "Win, push or lose",
  outcomes: [
    { prob: 0.44, net: 1 },
    { prob: 0.1, net: 0 },
    { prob: 0.46, net: -1 },
  ],
};

/** An RNG that lands in the MIDDLE of a chosen outcome's interval each round (by outcome index). */
function outcomeRng(game: OutcomesGame, script: readonly number[]): Rng & { draws: () => number } {
  const { cum } = compileGame(game);
  let i = 0;
  const rng = () => {
    const k = script[i++];
    if (k === undefined) throw new Error("script exhausted");
    const lo = k === 0 ? 0 : cum[k - 1]!;
    return (lo + cum[k]!) / 2;
  };
  return Object.assign(rng, { draws: () => i });
}

/** Test fixture: flat bets of base, counting update calls; never touches the RNG. */
function countingFlat(): AnyStrategy & { updates: () => number } {
  let n = 0;
  const s: AnyStrategy = {
    id: "countingFlat",
    label: "counting flat",
    description: "test fixture",
    configSchema: [],
    defaultConfig: {},
    init: () => null,
    nextBet: (_s, ctx) => ctx.baseBet,
    update: (st) => {
      n++;
      return st;
    },
  };
  return Object.assign(s, { updates: () => n });
}

describe("the one-draw mapping", () => {
  it("binary games: outcome 0 exactly when u < p (the old rule), for p near every edge case", () => {
    const rng = mulberry32(99);
    for (const p of [18 / 37, 18 / 38, 0.5, 0.45, 1e-9, 1 - 1e-9, 28 / 73]) {
      const { cum } = compileGame({ id: "b", name: "b", winProb: p, netPayout: 1 });
      expect(Array.from(cum)).toEqual([p, 1]);
      for (const u of [0, p, p - Number.EPSILON, Math.max(0, p - 1e-17), 1 - Number.EPSILON]) expect(outcomeIndex(cum, u)).toBe(u < p ? 0 : 1);
      for (let i = 0; i < 20_000; i++) {
        const u = rng();
        expect(outcomeIndex(cum, u)).toBe(u < p ? 0 : 1);
      }
    }
  });

  it("cumulative bounds in entry order, the last forced to exactly 1", () => {
    const { cum } = compileGame(TICKET_70);
    expect(Array.from(cum)).toEqual([1 / 6, 1 / 6 + 3 / 6, 1]);
    // Probabilities that sum to 1 - 3e-10: the last bound is still 1, so no draw falls off the end.
    const short = compileGame({ id: "s", name: "s", outcomes: [{ prob: 0.3, net: 1 }, { prob: 0.7 - 3e-10, net: -1 }] });
    expect(short.cum[1]).toBe(1);
    expect(outcomeIndex(short.cum, 1 - Number.EPSILON)).toBe(1);
    expect(outcomeIndex(cum, 0)).toBe(0);
    expect(outcomeIndex(cum, 1 / 6)).toBe(1);
    expect(outcomeIndex(cum, 1 - Number.EPSILON)).toBe(2);
  });

  it("one draw per resolved round on multi-outcome games too (draws === rounds)", () => {
    for (let i = 0; i < 300; i++) {
      for (const game of [TICKET_70, PUSH_GAME]) {
        const rng = countingRng(mulberry32(sessionSeed(13, i)));
        const r = runSessionWithRng(game, countingFlat(), {}, sessionConfig({ startBankroll: 50_000, baseBet: 1_000, stopWin: 70_000, maxRounds: 200 }), rng);
        expect(rng.draws()).toBe(r.rounds);
      }
    }
  });
});

describe("payouts on multi-outcome games", () => {
  it("ticket at $70, $70 staked: prizes pay back $20 / $50 / $100 (net -$50 / -$20 / +$30), exactly", () => {
    const run = (k: number) => runSessionWithRng(TICKET_70, countingFlat(), {}, sessionConfig({ startBankroll: 100_000, baseBet: 7_000, maxRounds: 1 }), outcomeRng(TICKET_70, [k]));
    expect([0, 1, 2].map((k) => run(k).finalBankroll - 100_000)).toEqual([-5_000, -2_000, 3_000]);
  });

  it("partial losses go through the carry; total losses and pushes never touch it", () => {
    // $1 stake on the $70 ticket: outcome 0 returns 20/70 of the stake, i.e. net -71.43 cents.
    const g = TICKET_70;
    const r = runSessionWithRng(g, countingFlat(), {}, sessionConfig({ startBankroll: 100_000, baseBet: 100, maxRounds: 7 }), outcomeRng(g, [0, 0, 0, 0, 0, 0, 0]), { recordPath: true });
    const deltas = r.path!.bankroll.slice(1).map((b, i) => b - r.path!.bankroll[i]!);
    expect(deltas.reduce((a, b) => a + b, 0)).toBe(-500); // 7 x (-500/7) = -500 exactly, via the carry
    expect(deltas.every((d) => d === -71 || d === -72)).toBe(true);
    // Push game: a win then a push. The push moves the bankroll by exactly 0, whatever the carry.
    const p = runSessionWithRng(PUSH_GAME, countingFlat(), {}, sessionConfig({ startBankroll: 1_000, baseBet: 100, maxRounds: 3 }), outcomeRng(PUSH_GAME, [0, 1, 2]), { recordPath: true });
    expect(p.path!.bankroll).toEqual([1_000, 1_100, 1_100, 1_000]);
  });

  it("a push: the strategy's update is NOT called, the losing streak neither extends nor breaks, the round still counts", () => {
    const s = countingFlat();
    // lose, push, lose, win, push, push: updates on the 3 non-push rounds only.
    const r = runSessionWithRng(PUSH_GAME, s, {}, sessionConfig({ startBankroll: 10_000, baseBet: 100, maxRounds: 6 }), outcomeRng(PUSH_GAME, [2, 1, 2, 0, 1, 1]));
    expect(s.updates()).toBe(3);
    expect(r.rounds).toBe(6);
    expect(r.totalWagered).toBe(600);
    expect(r.longestLosingStreak).toBe(2); // L, push, L: the push did not break the streak
    expect(r.finalBankroll).toBe(10_000 - 100 - 100 + 100);
  });
});
