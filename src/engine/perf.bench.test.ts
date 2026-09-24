// Performance harness. Skipped unless BENCH=1 (PowerShell: $env:BENCH=1; npx vitest run src/engine/perf.bench.test.ts --reporter=verbose).
// Scenario = session 2's timing run: European, $1,000 bankroll, $10 base, 1000 max rounds,
// 100k sessions, seed 12345, six strategy instances.
import { describe, it } from "vitest";
import { GAME_PRESETS } from "./games";
import { MinMaxDownsampler } from "./downsample";
import { runMonteCarlo } from "./montecarlo";
import { sessionSeed } from "./rng";
import { runSession } from "./runner";
import { checkpointRounds } from "./checkpoints";
import { BandRecorder } from "./stats/bands";
import { getStrategy } from "./strategies/registry";
import type { StrategyConfig } from "./strategies/types";
import { sessionConfig } from "./testUtils";

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

describe.skipIf(env.BENCH !== "1")("perf benchmark", () => {
  it("100k sessions × 6 strategies, median of 3", { timeout: 600_000 }, () => {
    const game = GAME_PRESETS.find((g) => g.id === "european")!;
    const cfg = sessionConfig({ startBankroll: 100_000, baseBet: 1_000, tableMin: 100, maxRounds: 1000 });
    const instances: [string, StrategyConfig][] = [
      ["flat", { units: 1 }],
      ["martingale", { multiplier: 2 }],
      ["paroli", { streakCap: 3 }],
      ["dalembert", { unitSize: 1 }],
      ["fibonacci", {}],
      ["martingale", { multiplier: 3 }],
    ];
    const specs = instances.map(([id, config]) => ({ strategy: getStrategy(id)!, config }));
    const times: number[] = [];
    for (let rep = 0; rep < 3; rep++) {
      const t0 = performance.now();
      runMonteCarlo(game, specs, cfg, 100_000, 12345);
      times.push((performance.now() - t0) / 1000);
    }
    times.sort((a, b) => a - b);
    console.log(`[bench] 100k × 6 strategies: runs ${times.map((t) => t.toFixed(2)).join("s, ")}s; median ${times[1]!.toFixed(2)}s`);
  });

  it("observer cost per session: none vs band + downsampler (flat, 20k sessions x 1000 rounds)", { timeout: 600_000 }, () => {
    const game = GAME_PRESETS.find((g) => g.id === "european")!;
    const cfg = sessionConfig({ startBankroll: 10_000_000, baseBet: 100, maxRounds: 1000 });
    const flatS = getStrategy("flat")!;
    const n = 20_000;
    const time = (withObserver: boolean) => {
      const rec = new BandRecorder(checkpointRounds(cfg.maxRounds), n);
      const t0 = performance.now();
      for (let i = 0; i < n; i++) {
        if (withObserver) {
          const band = rec.observe(i);
          const ds = new MinMaxDownsampler(cfg.maxRounds);
          const r = runSession(game, flatS, { units: 1 }, cfg, sessionSeed(1, i), {
            observer: (round, b) => {
              band.observer(round, b);
              ds.observer(round, b);
            },
          });
          band.finish(r.finalBankroll);
          ds.result();
        } else {
          runSession(game, flatS, { units: 1 }, cfg, sessionSeed(1, i));
        }
      }
      return (performance.now() - t0) / n;
    };
    time(false); // warm-up
    time(true);
    const plain = time(false);
    const observed = time(true);
    console.log(
      `[bench observer] per 1000-round session: plain ${(plain * 1000).toFixed(1)}us, observed (band + downsampler) ` +
        `${(observed * 1000).toFixed(1)}us (x${(observed / plain).toFixed(2)}); only min(2000, n) sessions per strategy are observed`,
    );
  });
});
