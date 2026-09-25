import { describe, expect, it } from "vitest";
import { GAME_PRESETS } from "../games";
import { runSessionWithRng } from "../runner";
import { betSequence, deltasFromPath, expectPure, L, scriptedRng, sessionConfig, W } from "../testUtils";
import { martingale } from "./martingale";

const european = GAME_PRESETS.find((g) => g.id === "european")!;

describe("martingale: exact bet sequences (no runner)", () => {
  it("doubles on each loss, resets to base on a win", () => {
    expect(betSequence(martingale, { multiplier: 2 }, [L, L, L, W, L, W])).toEqual([100, 200, 400, 800, 100, 200, 100]);
  });

  it("multiplier 3", () => {
    expect(betSequence(martingale, { multiplier: 3 }, [L, L, W, L])).toEqual([100, 300, 900, 100, 300]);
  });

  it("fractional multiplier returns fractional cents (the runner rounds)", () => {
    expect(betSequence(martingale, { multiplier: 1.5 }, [L, L, L])).toEqual([100, 150, 225, 337.5]);
  });

  it("the level keeps climbing regardless of wins before it", () => {
    expect(betSequence(martingale, { multiplier: 2 }, [W, W, L, L, L, L, L])).toEqual([100, 100, 100, 200, 400, 800, 1600, 3200]);
  });

  it("caps the returned bet against float overflow; the level is unaffected", () => {
    const bets = betSequence(martingale, { multiplier: 10 }, Array<boolean>(400).fill(L));
    expect(bets[bets.length - 1]).toBe(Number.MAX_SAFE_INTEGER);
    expect(bets.every((b) => typeof b === "number" && Number.isFinite(b))).toBe(true);
  });
});

describe("martingale: purity", () => {
  it("does not mutate deep-frozen config, state, or ctx", () => {
    expectPure(martingale, { multiplier: 2 });
    expectPure(martingale, { multiplier: 1.5 });
  });
});

describe("martingale: table max breaks the recovery guarantee", () => {
  it("placed bet sticks at tableMax while the strategy's own level keeps climbing; one win leaves the session negative", () => {
    const script = [L, L, L, L, L, L, W];
    const cfg = sessionConfig({ startBankroll: 100_000, baseBet: 100, tableMax: 800, maxRounds: script.length });
    const r = runSessionWithRng(european, martingale, { multiplier: 2 }, cfg, scriptedRng(script), { recordPath: true });

    // Placed bets (runner, after the clamp): |bankroll change| per round for even money.
    const placed = deltasFromPath(r.path!).map(Math.abs);
    expect(placed).toEqual([100, 200, 400, 800, 800, 800, 800]);
    // What the strategy asks for over the same script: it never looks at the clamped lastBet.
    expect(betSequence(martingale, { multiplier: 2 }, script)).toEqual([100, 200, 400, 800, 1600, 3200, 6400, 100]);

    // Uncapped, the win would recover everything plus one base bet. Capped, it cannot.
    expect(r.finalBankroll - cfg.startBankroll).toBe(-(100 + 200 + 400 + 800 * 3) + 800);
    expect(r.finalBankroll).toBeLessThan(cfg.startBankroll);
  });
});
