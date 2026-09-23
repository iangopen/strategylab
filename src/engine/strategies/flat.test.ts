import { describe, expect, it } from "vitest";
import { edge, GAME_PRESETS, type Game } from "../games";
import { sessionSeed } from "../rng";
import { runSession } from "../runner";
import { betSequence, describeEvInvariant, evPerWageredWithSE, expectPure, L, sessionConfig, W } from "../testUtils";
import type { SessionConfig, SessionResult } from "../types";
import { flat } from "./flat";

const european = GAME_PRESETS.find((g) => g.id === "european")!;
const coin = GAME_PRESETS.find((g) => g.id === "fairCoin")!;

function runMany(game: Game, cfg: SessionConfig, n: number, master: number): SessionResult[] {
  const out: SessionResult[] = [];
  for (let i = 0; i < n; i++) out.push(runSession(game, flat, { units: 1 }, cfg, sessionSeed(master, i)));
  return out;
}

function checkInvariant(name: string, game: Game, cfg: SessionConfig, n: number, master: number) {
  const results = runMany(game, cfg, n, master);
  const rounds = results.reduce((s, r) => s + r.rounds, 0);
  const { ev, se } = evPerWageredWithSE(results, cfg.startBankroll);
  const expected = -edge(game);
  console.log(`[${name}] rounds=${rounds} EV/$=${ev.toFixed(6)} expected=${expected.toFixed(6)} SE=${se.toFixed(6)} z=${((ev - expected) / se).toFixed(2)}`);
  expect(Math.abs(ev - expected)).toBeLessThan(4 * se);
  return rounds;
}

describe("flat", () => {
  it("bets baseBet × units every round", () => {
    const ctx = { bankroll: 1000, baseBet: 100, round: 0, lastBet: null };
    const s = flat.init({ units: 2.5 }, ctx);
    expect(flat.nextBet(s, ctx)).toBe(250);
    expect(flat.nextBet(flat.update(s, false, ctx), ctx)).toBe(250);
  });

  it("exact sequence: the same bet whatever happens", () => {
    expect(betSequence(flat, { units: 1.5 }, [L, W, L, L, W])).toEqual([150, 150, 150, 150, 150, 150]);
  });

  it("is pure under deep-frozen inputs", () => {
    expectPure(flat, { units: 2 });
  });

  it("is pure: inputs are unchanged", () => {
    const config = Object.freeze({ units: 2 });
    const ctx = Object.freeze({ bankroll: 1000, baseBet: 100, round: 0, lastBet: null });
    const s = Object.freeze(flat.init(config, ctx));
    flat.nextBet(s, ctx);
    flat.update(s, true, ctx);
    expect(s).toEqual({ units: 2 });
    expect(config).toEqual({ units: 2 });
  });
});

describe("EV per $ wagered invariant (test 3)", () => {
  // Bankroll far above anything 1000 rounds can lose, so no stop ever fires.
  const noStops = sessionConfig({ startBankroll: 10_000_000, baseBet: 100, maxRounds: 1000 });

  it("European roulette, 2,000,000 rounds, no stops: within 4 SE of -1/37", () => {
    expect(edge(european)).toBeCloseTo(1 / 37, 15);
    const rounds = checkInvariant("european/no stops", european, noStops, 2000, 1);
    expect(rounds).toBe(2_000_000);
  });

  it("fair coin, 2,000,000 rounds, no stops: within 4 SE of 0", () => {
    expect(checkInvariant("coin/no stops", coin, noStops, 2000, 2)).toBe(2_000_000);
  });

  it("holds with stop conditions ON", () => {
    const stops = sessionConfig({ startBankroll: 10_000, baseBet: 100, stopWin: 15_000, stopLoss: 5_000, maxRounds: 1000 });
    checkInvariant("european/stops", european, stops, 20_000, 3);
    checkInvariant("coin/stops", coin, stops, 20_000, 4);
  });
});

describeEvInvariant(flat, { units: 1 });
