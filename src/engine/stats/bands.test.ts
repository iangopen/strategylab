import { describe, expect, it } from "vitest";
import { GAME_PRESETS } from "../games";
import { runMonteCarlo } from "../montecarlo";
import { sessionSeed } from "../rng";
import { runSession } from "../runner";
import { STRATEGIES } from "../strategies/registry";
import { INVARIANT_SCENARIO, sessionConfig } from "../testUtils";
import { checkpointRounds } from "../checkpoints";
import { BAND_SESSIONS, BandRecorder } from "./bands";
import { quantileSorted, sortedCopy } from "./quantile";

const european = GAME_PRESETS.find((g) => g.id === "european")!;
const allSpecs = STRATEGIES.map((strategy) => ({ strategy, config: { ...strategy.defaultConfig } }));

describe("BandRecorder", () => {
  it("carries a session that ends at round 1 forward to every later checkpoint", () => {
    const rec = new BandRecorder(checkpointRounds(10), 2);
    // Session 0 ends at round 1 with 0; session 1 runs all 10 rounds, +10 each round.
    const a = rec.observe(0);
    a.observer(0, 100);
    a.observer(1, 0);
    a.finish(0);
    const b = rec.observe(1);
    for (let r = 0; r <= 10; r++) b.observer(r, 100 + 10 * r);
    b.finish(200);
    const bands = rec.percentiles();
    expect(bands.p5[0]).toBe(100); // both start at 100
    expect(bands.p50[0]).toBe(100);
    for (let ci = 1; ci <= 10; ci++) {
      const other = 100 + 10 * ci;
      expect(bands.p50[ci]).toBe(other / 2); // type-7 median of [0, other]
      expect(bands.p5[ci]).toBeCloseTo(0.05 * other, 9);
    }
  });
});

describe("bands in runMonteCarlo", () => {
  it("first min(2000, n) sessions; p5 <= p25 <= p50 <= p75 <= p95 at every checkpoint; round 0 = start; last checkpoint = type-7 percentiles of the subset's finals", () => {
    const n = 2500; // more than BAND_SESSIONS, so the subset cap is exercised
    const r = runMonteCarlo(european, allSpecs, INVARIANT_SCENARIO, n, 7);
    expect(Array.from(r.bands.rounds)).toEqual(Array.from(checkpointRounds(INVARIANT_SCENARIO.maxRounds))); // the adaptive schedule (253 at 1,000 rounds)
    expect(r.bands.sessions).toBe(BAND_SESSIONS);
    for (const [k, s] of r.perStrategy.entries()) {
      const b = s.bands;
      for (let ci = 0; ci < r.bands.rounds.length; ci++) {
        expect(b.p5[ci]!).toBeLessThanOrEqual(b.p25[ci]!);
        expect(b.p25[ci]!).toBeLessThanOrEqual(b.p50[ci]!);
        expect(b.p50[ci]!).toBeLessThanOrEqual(b.p75[ci]!);
        expect(b.p75[ci]!).toBeLessThanOrEqual(b.p95[ci]!);
      }
      expect([b.p5[0], b.p95[0]]).toEqual([INVARIANT_SCENARIO.startBankroll, INVARIANT_SCENARIO.startBankroll]);

      // Recompute the subset's final bankrolls independently: same seeds, same strategy.
      const spec = allSpecs[k]!;
      const finals = new Float64Array(BAND_SESSIONS);
      for (let i = 0; i < BAND_SESSIONS; i++) {
        finals[i] = runSession(european, spec.strategy, spec.config, INVARIANT_SCENARIO, sessionSeed(7, i)).finalBankroll;
      }
      const sorted = sortedCopy(finals);
      const last = r.bands.rounds.length - 1;
      expect(b.p5[last]).toBe(quantileSorted(sorted, 0.05));
      expect(b.p25[last]).toBe(quantileSorted(sorted, 0.25));
      expect(b.p50[last]).toBe(quantileSorted(sorted, 0.5));
      expect(b.p75[last]).toBe(quantileSorted(sorted, 0.75));
      expect(b.p95[last]).toBe(quantileSorted(sorted, 0.95));
    }
  });

  it("uses every session when n < 2000; sessions ending at round 1 carry forward", () => {
    // $1 bankroll, $1 bets, win target $2: every session ends after exactly one round (bust or target).
    const cfg = sessionConfig({ startBankroll: 100, baseBet: 100, tableMin: 100, stopWin: 200, maxRounds: 50 });
    const r = runMonteCarlo(european, [allSpecs[0]!], cfg, 300, 3);
    expect(r.bands.sessions).toBe(300);
    expect(r.perStrategy[0]!.stats.meanRounds).toBe(1);
    const b = r.perStrategy[0]!.bands;
    for (let ci = 1; ci < r.bands.rounds.length; ci++) {
      for (const p of [b.p5, b.p25, b.p50, b.p75, b.p95]) expect(p[ci]).toBe(p[1]); // flat after round 1
    }
  });
});

describe("the band observer never leaks into a session", () => {
  it("runSession with a band observer on the adaptive schedule deep-equals runSession without one (9 strategies, 300 sessions each)", () => {
    const cfg = sessionConfig({ startBankroll: 100_000, baseBet: 1_000, tableMin: 100, stopWin: 110_000, maxRounds: 1000 });
    const specs = [...allSpecs.map((s) => (s.strategy.id === "kelly" ? { ...s, config: { assumedWinProb: 0.6, fraction: 1 } } : s))];
    for (const { strategy, config } of specs) {
      const rec = new BandRecorder(checkpointRounds(cfg.maxRounds), 300);
      for (let i = 0; i < 300; i++) {
        const band = rec.observe(i);
        const observed = runSession(european, strategy, config, cfg, sessionSeed(55, i), { observer: band.observer, recordPath: true });
        band.finish(observed.finalBankroll);
        expect(observed).toEqual(runSession(european, strategy, config, cfg, sessionSeed(55, i), { recordPath: true }));
      }
    }
  });
});
