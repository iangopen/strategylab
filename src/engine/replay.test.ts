import { describe, expect, it } from "vitest";
import { MinMaxDownsampler } from "./downsample";
import { GAME_PRESETS, type Game } from "./games";
import { runMonteCarlo, SAMPLE_PATH_COUNT } from "./montecarlo";
import { sessionSeed } from "./rng";
import { recordingStrategy, replaySession, REPLAY_FULL_MAX_ROUNDS } from "./replay";
import { runSession } from "./runner";
import { STRATEGIES } from "./strategies/registry";
import { deltasFromPath, sessionConfig } from "./testUtils";
import type { SamplePath } from "./types";

const european = GAME_PRESETS.find((g) => g.id === "european")!;
const specs = STRATEGIES.map((strategy) => ({ strategy, config: { ...strategy.defaultConfig } }));

function downsampleFull(path: SamplePath, maxRounds: number): SamplePath {
  const ds = new MinMaxDownsampler(maxRounds);
  path.rounds.forEach((r, i) => ds.observer(r, path.bankroll[i]!));
  return ds.result();
}

function winsOf(r: ReturnType<typeof replaySession>, k: number): boolean[] {
  return deltasFromPath(r.strategies[k]!.bankroll).map((d) => d > 0);
}

describe("replay determinism: re-simulated session i equals the stored sample path i", () => {
  it(`maxRounds 20,000 (downsampled replay): EXACT equality for i < 50, every strategy`, { timeout: 300_000 }, () => {
    // $10,000 bankroll, $10 base: long sessions, so paths are genuinely downsampled.
    const cfg = sessionConfig({ startBankroll: 1_000_000, baseBet: 1_000, tableMin: 100, maxRounds: 20_000 });
    expect(cfg.maxRounds).toBeGreaterThan(REPLAY_FULL_MAX_ROUNDS);
    const mc = runMonteCarlo(european, specs, cfg, SAMPLE_PATH_COUNT, 777);
    let longest = 0;
    let comparedPoints = 0;
    for (let i = 0; i < SAMPLE_PATH_COUNT; i++) {
      const rep = replaySession(european, specs, cfg, 777, i);
      expect(rep.downsampled).toBe(true);
      expect(rep.seed).toBe(sessionSeed(777, i));
      rep.strategies.forEach((s, k) => {
        expect(s.bankroll).toEqual(mc.perStrategy[k]!.samplePaths[i]);
        comparedPoints += s.bankroll.rounds.length;
        longest = Math.max(longest, s.rounds);
      });
      // The strip spans the longest strategy and counts each of its rounds once.
      const maxRounds = Math.max(...rep.strategies.map((s) => s.rounds));
      if (rep.strip.kind !== "buckets") throw new Error("expected bucketed strip");
      expect(rep.strip.counts.reduce((a, b) => a + b, 0)).toBe(maxRounds);
    }
    expect(longest).toBeGreaterThan(REPLAY_FULL_MAX_ROUNDS); // some sessions really are long
    console.log(`[replay 20k] 50 sessions x ${specs.length} strategies identical to stored sample paths; ${comparedPoints} points compared; longest session ${longest} rounds`);
  });

  it("maxRounds 3,000 (full replay): downsampling the full path gives the stored sample path, for i < 50", () => {
    const cfg = sessionConfig({ startBankroll: 1_000_000, baseBet: 1_000, tableMin: 100, maxRounds: 3_000 });
    const mc = runMonteCarlo(european, specs, cfg, SAMPLE_PATH_COUNT, 31);
    for (let i = 0; i < SAMPLE_PATH_COUNT; i++) {
      const rep = replaySession(european, specs, cfg, 31, i);
      expect(rep.downsampled).toBe(false);
      rep.strategies.forEach((s, k) => {
        expect(s.bankroll.rounds).toHaveLength(s.rounds + 1); // full path: every round
        expect(downsampleFull(s.bankroll, cfg.maxRounds)).toEqual(mc.perStrategy[k]!.samplePaths[i]);
      });
    }
  });
});

describe("replay: the same luck in every strategy", () => {
  it("win/loss sequences are identical across strategies over their overlapping rounds; the strip is the longest one", () => {
    const cfg = sessionConfig({ startBankroll: 100_000, baseBet: 1_000, stopWin: 110_000, maxRounds: 1000 });
    let differentLengths = 0;
    for (let i = 0; i < 100; i++) {
      const rep = replaySession(european, specs, cfg, 12345, i);
      const seqs = rep.strategies.map((_, k) => winsOf(rep, k));
      if (new Set(seqs.map((s) => s.length)).size > 1) differentLengths++;
      for (let a = 0; a < seqs.length; a++) {
        for (let b = a + 1; b < seqs.length; b++) {
          const n = Math.min(seqs[a]!.length, seqs[b]!.length);
          expect(seqs[b]!.slice(0, n)).toEqual(seqs[a]!.slice(0, n));
        }
      }
      if (rep.strip.kind !== "rounds") throw new Error("expected per-round strip");
      const longest = seqs.reduce((x, y) => (y.length > x.length ? y : x));
      expect(Array.from(rep.strip.wins, (w) => w === 1)).toEqual(longest);
    }
    expect(differentLengths).toBeGreaterThan(0);
  });

  it("bets are the bets actually placed: |bankroll change| on even money, exact on a 1.2 payout too", () => {
    const cfg = sessionConfig({ startBankroll: 100_000, baseBet: 1_000, tableMax: 8_000, maxRounds: 500 });
    const rep = replaySession(european, specs, cfg, 5, 3);
    rep.strategies.forEach((s) => {
      const deltas = deltasFromPath(s.bankroll).map(Math.abs);
      expect(s.bets.bankroll).toEqual(deltas);
      expect(s.bets.rounds).toEqual(deltas.map((_, r) => r));
      for (const b of s.bets.bankroll) expect(b).toBeLessThanOrEqual(8_000); // after the table max clamp
    });
    const custom: Game = { id: "custom", name: "Custom", winProb: 0.45, netPayout: 1.2 };
    const rep2 = replaySession(custom, specs, cfg, 5, 3);
    rep2.strategies.forEach((s) => {
      // Wins pay whole cents with the runner's per-session sub-cent carry; losses cost the bet.
      let carry = 0;
      let paid = 0;
      let exact = 0;
      deltasFromPath(s.bankroll).forEach((delta, r) => {
        const bet = s.bets.bankroll[r]!;
        if (delta > 0) {
          const owed = bet * 1.2 + carry;
          expect(delta).toBe(Math.round(owed));
          carry = owed - delta;
          paid += delta;
          exact += bet * 1.2;
        } else {
          expect(delta).toBe(-bet);
        }
      });
      expect(Math.abs(paid - exact)).toBeLessThanOrEqual(0.5 + 1e-6);
    });
  });

  it("the recording wrapper changes nothing about the session", () => {
    const cfg = sessionConfig({ startBankroll: 100_000, baseBet: 1_000, maxRounds: 800 });
    for (const { strategy, config } of specs) {
      const plain = runSession(european, strategy, config, cfg, 99, { recordPath: true });
      const recorded = runSession(european, recordingStrategy(strategy, () => {}), config, cfg, 99, { recordPath: true });
      expect(recorded).toEqual(plain);
    }
  });

  it("rejects bad input", () => {
    const cfg = sessionConfig();
    expect(() => replaySession(european, specs, cfg, 1, -1)).toThrow();
    expect(() => replaySession(european, specs, cfg, 1, 1.5)).toThrow();
    expect(() => replaySession(european, [{ strategy: STRATEGIES[0]!, config: { units: -1 } }], cfg, 1, 0)).toThrow();
  });
});
