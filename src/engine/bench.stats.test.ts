// `npm run bench`: one fixed Monte Carlo run, timed. Skipped unless BENCH=1 (the npm script sets it).
// The scenario is the app's default run at 100,000 sessions: European roulette, $1,000 bankroll, $10 base
// bet, $1 table minimum, stop at $1,100, 1,000 max rounds, Flat and Martingale x2, master seed 12345.
// It prints ONE machine's numbers (CPU, Node version, load at the time): a measurement, not a guarantee.
import { describe, expect, it } from "vitest";
import { GAME_PRESETS } from "./games";
import { runMonteCarlo, type StrategySpec } from "./montecarlo";
import { getStrategy } from "./strategies/registry";
import { sessionConfig } from "./testUtils";

const env = (globalThis as { process?: { env: Record<string, string | undefined>; version?: string } }).process;

const SESSIONS = 100_000;
const SEED = 12345;
const RUNS = 3;

describe.skipIf(env?.env.BENCH !== "1")("bench: the default scenario at 100,000 sessions", () => {
  it("sessions per second and total time (median of 3 timed runs after a warm-up)", async () => {
    const game = GAME_PRESETS.find((g) => g.id === "european")!;
    const cfg = sessionConfig({ startBankroll: 100_000, baseBet: 1_000, tableMin: 100, tableMax: null, stopWin: 110_000, stopLoss: null, maxRounds: 1000, insufficientFunds: "stop" });
    const specs: StrategySpec[] = [
      { strategy: getStrategy("flat")!, config: { units: 1 } },
      { strategy: getStrategy("martingale")!, config: { multiplier: 2 } },
    ];

    runMonteCarlo(game, specs, cfg, 10_000, SEED); // warm-up (JIT), not timed
    const times: number[] = [];
    let rounds = 0;
    const evs: string[] = [];
    for (let k = 0; k < RUNS; k++) {
      const t0 = performance.now();
      const r = runMonteCarlo(game, specs, cfg, SESSIONS, SEED);
      times.push((performance.now() - t0) / 1000);
      rounds = r.perStrategy.reduce((s, o) => s + o.stats.meanRounds! * SESSIONS, 0);
      evs.push(r.perStrategy.map((o) => `${o.strategyId} ${(o.stats.evPerWagered! * 100).toFixed(3)}%`).join(", "));
    }
    expect(new Set(evs).size, "a fixed seed must give the same result on every run").toBe(1);
    const ev = evs[0]!;
    const median = [...times].sort((a, b) => a - b)[1]!;

    // Machine description, read only here (the app tsconfig has no Node types; this file runs in Node).
    const osName = "node:os";
    const os = (await import(/* @vite-ignore */ osName)) as { cpus(): { model: string }[]; totalmem(): number; platform(): string };
    const cpus = os.cpus();
    console.log(
      [
        `[bench] machine: ${cpus[0]?.model.trim() ?? "unknown CPU"} (${cpus.length} logical cores), ${(os.totalmem() / 2 ** 30).toFixed(0)} GB, ${os.platform()}, Node ${env?.version ?? "?"}`,
        `[bench] scenario: European, $1,000 bankroll, $10 base, stop at $1,100, 1,000 max rounds; Flat + Martingale x2; ${SESSIONS.toLocaleString("en-US")} sessions; seed ${SEED}`,
        `[bench] same seed, same result every run: EV per $ wagered ${ev}`,
        `[bench] runs: ${times.map((t) => `${t.toFixed(2)} s`).join(", ")}; median total time ${median.toFixed(2)} s`,
        `[bench] ${Math.round(SESSIONS / median).toLocaleString("en-US")} sessions per second (each session played by both strategies)`,
        `[bench] ${Math.round(rounds / median).toLocaleString("en-US")} rounds per second (${Math.round(rounds).toLocaleString("en-US")} rounds per run)`,
        "[bench] one machine's result, single worker thread; not a guarantee",
      ].join("\n"),
    );
  });
});
