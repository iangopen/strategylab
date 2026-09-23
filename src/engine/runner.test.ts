import { describe, expect, it } from "vitest";
import { GAME_PRESETS, type Game } from "./games";
import { mulberry32, sessionSeed } from "./rng";
import { runSession, runSessionWithRng } from "./runner";
import { flat } from "./strategies/flat";
import type { AnyStrategy } from "./strategies/types";
import { countingRng, L, outcomesFromPath, scriptedRng, sessionConfig, W } from "./testUtils";
import type { SessionConfig } from "./types";

const european = GAME_PRESETS.find((g) => g.id === "european")!;
const coin: Game = GAME_PRESETS.find((g) => g.id === "fairCoin")!;

/** Test-only fixture: flat betting that returns "stop" once `after` rounds are complete. */
const stopAfter = (after: number): AnyStrategy => ({
  id: "stopAfter",
  label: "stop after",
  description: "test fixture",
  configSchema: [],
  defaultConfig: {},
  init: () => null,
  nextBet: (_s, ctx) => (ctx.round >= after ? "stop" : ctx.baseBet),
  update: (s) => s,
});

/** Test-only fixture for CRN: flat at 2x base. Defined here, never registered. */
const flat2x: AnyStrategy = {
  id: "flat2x",
  label: "Flat 2x (fixture)",
  description: "test fixture",
  configSchema: [],
  defaultConfig: {},
  init: () => null,
  nextBet: (_s, ctx) => 2 * ctx.baseBet,
  update: (s) => s,
};

function play(outcomes: boolean[], cfg: Partial<SessionConfig>, units = 1, strategy: AnyStrategy = flat) {
  const rng = scriptedRng(outcomes);
  const r = runSessionWithRng(coin, strategy, { units }, sessionConfig(cfg), rng);
  return { ...r, draws: rng.draws() };
}

describe("table rules", () => {
  it("raises the bet to tableMin", () => {
    const r = play([L], { baseBet: 50, tableMin: 100, maxRounds: 1 });
    expect(r.totalWagered).toBe(100);
    expect(r.finalBankroll).toBe(900);
  });

  it("rounds strategy bets to whole cents", () => {
    const r = play([L], { maxRounds: 1 }, 1.234); // 123.4 cents
    expect(r.totalWagered).toBe(123);
    expect(r.finalBankroll).toBe(877);
  });

  it("clamps the bet to tableMax", () => {
    const r = play([W], { tableMax: 200, maxRounds: 1 }, 5);
    expect(r.totalWagered).toBe(200);
    expect(r.finalBankroll).toBe(1200);
  });

  it('insufficientFunds "stop" ends the session without betting', () => {
    const r = play([], { startBankroll: 150, insufficientFunds: "stop" }, 2);
    expect(r.endReason).toBe("insufficientFunds");
    expect(r.rounds).toBe(0);
    expect(r.finalBankroll).toBe(150);
  });

  it('insufficientFunds "allIn" bets the whole bankroll', () => {
    const lose = play([L], { startBankroll: 150, insufficientFunds: "allIn" }, 2);
    expect(lose.totalWagered).toBe(150);
    expect(lose.finalBankroll).toBe(0);
    expect(lose.endReason).toBe("ruin");

    const win = play([W], { startBankroll: 150, insufficientFunds: "allIn", maxRounds: 1 }, 2);
    expect(win.totalWagered).toBe(150);
    expect(win.finalBankroll).toBe(300);
  });

  it("pays netPayout on a win, rounded to cents", () => {
    const game: Game = { id: "x", name: "x", winProb: 0.3, netPayout: 1.5 };
    const r = runSessionWithRng(game, flat, { units: 1 }, sessionConfig({ baseBet: 101, maxRounds: 1 }), scriptedRng([W]));
    expect(r.finalBankroll).toBe(1000 + Math.round(101 * 1.5));
  });
});

describe("endReason", () => {
  it("ruin when bankroll falls below tableMin (even if above zero)", () => {
    const r = play([L, L], { startBankroll: 250, tableMin: 100 });
    expect(r.endReason).toBe("ruin");
    expect(r.finalBankroll).toBe(50);
    expect(r.rounds).toBe(2);
  });

  it("stopWin triggers at exactly bankroll >= target", () => {
    const hit = play([W], { stopWin: 1100 });
    expect(hit.endReason).toBe("stopWin");
    expect(hit.rounds).toBe(1);
    // One cent above: 1100 does not trigger, the next win does.
    const miss = play([W, W], { stopWin: 1101 });
    expect(miss.endReason).toBe("stopWin");
    expect(miss.rounds).toBe(2);
    expect(miss.finalBankroll).toBe(1200);
  });

  it("stopLoss is a floor: triggers at exactly bankroll <= floor", () => {
    const hit = play([L], { stopLoss: 900 });
    expect(hit.endReason).toBe("stopLoss");
    expect(hit.rounds).toBe(1);
    const miss = play([L, L], { stopLoss: 899 });
    expect(miss.endReason).toBe("stopLoss");
    expect(miss.rounds).toBe(2);
    expect(miss.finalBankroll).toBe(800);
  });

  it("maxRounds", () => {
    const r = play([W, L, W], { maxRounds: 3 });
    expect(r.endReason).toBe("maxRounds");
    expect(r.rounds).toBe(3);
  });

  it("strategyStop", () => {
    const r = play([W, L], {}, 1, stopAfter(2));
    expect(r.endReason).toBe("strategyStop");
    expect(r.rounds).toBe(2);
  });

  it("a stop or ruin reached on the last allowed round wins over maxRounds", () => {
    expect(play([W], { stopWin: 1100, maxRounds: 1 }).endReason).toBe("stopWin");
    expect(play([L], { stopLoss: 900, maxRounds: 1 }).endReason).toBe("stopLoss");
    expect(play([L], { startBankroll: 100, maxRounds: 1 }).endReason).toBe("ruin");
  });
});

describe("CRN: no uniform draw on a round that ends before resolution", () => {
  const cases: [string, boolean[], Partial<SessionConfig>, number, AnyStrategy, string][] = [
    ["stopWin", [W, W], { stopWin: 1200 }, 1, flat, "stopWin"],
    ["stopLoss", [L, L], { stopLoss: 800 }, 1, flat, "stopLoss"],
    ["ruin", [L, L, L], { startBankroll: 300 }, 1, flat, "ruin"],
    ["strategyStop", [W, L, W], {}, 1, stopAfter(3), "strategyStop"],
    ["insufficientFunds", [L, L], { startBankroll: 500 }, 2, flat, "insufficientFunds"],
    ["maxRounds", [W, L], { maxRounds: 2 }, 1, flat, "maxRounds"],
  ];
  for (const [name, outcomes, cfg, units, strategy, reason] of cases) {
    it(`${name}: draws === rounds resolved`, () => {
      const r = play(outcomes, cfg, units, strategy);
      expect(r.endReason).toBe(reason);
      expect(r.draws).toBe(r.rounds);
      expect(r.draws).toBe(outcomes.length); // the script was consumed exactly, and no further
    });
  }

  it("draws === rounds across many random sessions and configs", () => {
    const configs: Partial<SessionConfig>[] = [
      { startBankroll: 1000, stopWin: 1500, stopLoss: 400 },
      { startBankroll: 500, tableMin: 100 },
      { startBankroll: 1000, insufficientFunds: "allIn" },
      { startBankroll: 1000, maxRounds: 17 },
    ];
    for (const cfg of configs) {
      for (let i = 0; i < 200; i++) {
        for (const [strategy, units] of [[flat, 3], [flat2x, 1], [stopAfter(5), 1]] as const) {
          const rng = countingRng(mulberry32(sessionSeed(7, i)));
          const r = runSessionWithRng(european, strategy, { units }, sessionConfig(cfg), rng);
          expect(rng.draws()).toBe(r.rounds);
        }
      }
    }
  });
});

describe("session stats", () => {
  it("tracks peak, max drawdown, longest losing streak, total wagered", () => {
    // 1000 -> 1100, 1000, 900, 1000, 900, 800, 700, 800
    const r = play([W, L, L, W, L, L, L, W], { maxRounds: 8 });
    expect(r.finalBankroll).toBe(800);
    expect(r.peak).toBe(1100);
    expect(r.maxDrawdown).toBe(400);
    expect(r.longestLosingStreak).toBe(3);
    expect(r.totalWagered).toBe(800);
  });

  it("records a full path (every round) only when asked", () => {
    const cfg = sessionConfig({ startBankroll: 100000, maxRounds: 10 });
    expect(runSession(european, flat, { units: 1 }, cfg, 1).path).toBeUndefined();
    const full = runSession(european, flat, { units: 1 }, cfg, 1, { recordPath: true }).path!;
    expect(full.rounds).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(full.bankroll).toHaveLength(11);
  });
});

describe("validation", () => {
  it("rejects invalid setups", () => {
    const run = (cfg: Partial<SessionConfig>, game: Game = european) =>
      runSession(game, flat, { units: 1 }, sessionConfig(cfg), 1);
    expect(() => run({ maxRounds: 0 })).toThrow();
    expect(() => run({ maxRounds: 1_000_001 })).toThrow();
    expect(() => run({ maxRounds: Infinity })).toThrow();
    expect(() => run({ tableMin: 0 })).toThrow();
    expect(() => run({ tableMax: 0 })).toThrow();
    expect(() => run({ baseBet: 1.5 })).toThrow();
    expect(() => run({ stopWin: 1000 })).toThrow();
    expect(() => run({ stopLoss: 1000 })).toThrow();
    expect(() => run({}, { ...european, winProb: 1 })).toThrow();
    expect(() => run({}, { ...european, netPayout: 0 })).toThrow();
  });

  it("rejects a non-finite bet from a strategy", () => {
    const bad: AnyStrategy = { ...flat2x, nextBet: () => NaN };
    expect(() => runSession(european, bad, {}, sessionConfig(), 1)).toThrow(/non-finite/);
  });
});

describe("determinism (test 1, session level)", () => {
  it("same seed gives identical sessions; different seeds differ", () => {
    const cfg = sessionConfig({ startBankroll: 100000 });
    const a = runSession(european, flat, { units: 1 }, cfg, 42, { recordPath: true });
    const b = runSession(european, flat, { units: 1 }, cfg, 42, { recordPath: true });
    const c = runSession(european, flat, { units: 1 }, cfg, 43, { recordPath: true });
    expect(b).toEqual(a);
    expect(c.path!.bankroll).not.toEqual(a.path!.bankroll);
  });
});

describe("common random numbers (test 2)", () => {
  it("session i of flat and a 2x fixture see identical win/loss sequences", () => {
    const cfg = sessionConfig({ startBankroll: 3000, baseBet: 100 });
    let differentLengths = 0;
    for (let i = 0; i < 300; i++) {
      const seed = sessionSeed(12345, i);
      const a = outcomesFromPath(runSession(european, flat, { units: 1 }, cfg, seed, { recordPath: true }));
      const b = outcomesFromPath(runSession(european, flat2x, {}, cfg, seed, { recordPath: true }));
      const n = Math.min(a.length, b.length);
      expect(n).toBeGreaterThan(0);
      expect(b.slice(0, n)).toEqual(a.slice(0, n));
      if (a.length !== b.length) differentLengths++;
    }
    // The fixture busts earlier in many sessions, so "overlapping rounds" is actually exercised.
    expect(differentLengths).toBeGreaterThan(0);
  });
});

describe("round observer", () => {
  it("sees round 0 and every resolved round, matches the full path, and changes nothing else", () => {
    const cfg = sessionConfig({ startBankroll: 3000, baseBet: 100, maxRounds: 500 });
    const seen: [number, number][] = [];
    const observed = runSession(european, flat, { units: 1 }, cfg, 77, { recordPath: true, observer: (r, b) => seen.push([r, b]) });
    const plain = runSession(european, flat, { units: 1 }, cfg, 77, { recordPath: true });
    expect(observed).toEqual(plain);
    expect(seen.map(([r]) => r)).toEqual(plain.path!.rounds);
    expect(seen.map(([, b]) => b)).toEqual(plain.path!.bankroll);
    expect(seen[seen.length - 1]).toEqual([plain.rounds, plain.finalBankroll]);
  });

  it("is not called for rounds that never resolve (draws === rounds still holds)", () => {
    const rng = scriptedRng([L, L]);
    let calls = 0;
    const r = runSessionWithRng(coin, flat, { units: 2 }, sessionConfig({ startBankroll: 500 }), rng, { observer: () => calls++ });
    expect(r.endReason).toBe("insufficientFunds");
    expect(rng.draws()).toBe(2);
    expect(calls).toBe(3); // round 0 + two resolved rounds
  });
});
