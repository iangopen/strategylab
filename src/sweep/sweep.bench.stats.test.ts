// `npm run bench`, part 2: one max-size sweep, timed. Skipped unless BENCH=1 (the npm script sets it).
// 20 × 20 cells (bankroll $100-$1,000 by base bet $1-$20), Martingale x2 on the default scenario
// (European roulette, $1 table minimum, stop at $1,100, 1,000 max rounds, seed 12345), 10,000 sessions
// capped to 2,500 per cell: 1,000,000 sessions. It prints ONE machine's numbers: a measurement, not a guarantee.
import { describe, expect, it } from "vitest";
import { defaultScenario } from "../scenario";
import { MAX_SWEEP_SESSIONS } from "../share/limits";
import { toSweepRequest } from "./request";
import { runSweep } from "./run";
import type { SweepConfig } from "./sweep";

const env = (globalThis as { process?: { env: Record<string, string | undefined>; version?: string } }).process;

describe.skipIf(env?.env.BENCH !== "1")("bench: a max-size sweep (20 × 20 cells, 1,000,000 sessions)", () => {
  it("total time and sessions per second (one timed run after a small warm-up)", async () => {
    const s = defaultScenario();
    const sweep: SweepConfig = {
      x: { field: "startBankroll", start: 100, end: 1000, steps: 20 },
      y: { field: "baseBet", start: 1, end: 20, steps: 20 },
      strategyUid: s.strategies[1]!.uid,
      targetPct: 5,
    };
    const req = toSweepRequest({ ...s, sweep }, sweep);
    const total = req.cells.reduce((n, c) => n + c.nSessions, 0);
    expect(req.cells).toHaveLength(400);
    expect(total).toBe(MAX_SWEEP_SESSIONS);

    runSweep({ cells: req.cells.slice(0, 8) }); // warm-up (JIT), not timed
    let lastCell = 0;
    const t0 = performance.now();
    const cells = runSweep(req, () => {
      lastCell = performance.now();
    });
    const secs = (performance.now() - t0) / 1000;
    expect(cells).toHaveLength(400);
    const rounds = cells.reduce((n, c) => n + c.stats.meanRounds! * c.nSessions, 0);

    const osName = "node:os";
    const os = (await import(/* @vite-ignore */ osName)) as { cpus(): { model: string }[]; totalmem(): number; platform(): string };
    const cpus = os.cpus();
    console.log(
      [
        `[bench sweep] machine: ${cpus[0]?.model.trim() ?? "unknown CPU"} (${cpus.length} logical cores), ${(os.totalmem() / 2 ** 30).toFixed(0)} GB, ${os.platform()}, Node ${env?.version ?? "?"}`,
        `[bench sweep] 20 × 20 cells, Martingale x2, ${req.cells[0]!.nSessions.toLocaleString("en-US")} sessions per cell, ${total.toLocaleString("en-US")} sessions in all`,
        `[bench sweep] total time ${secs.toFixed(2)} s (last cell finished at ${((lastCell - t0) / 1000).toFixed(2)} s)`,
        `[bench sweep] ${Math.round(total / secs).toLocaleString("en-US")} sessions per second, ${Math.round(rounds / secs).toLocaleString("en-US")} rounds per second (${Math.round(rounds).toLocaleString("en-US")} rounds)`,
        "[bench sweep] one machine's result, single thread (the app runs it in one worker); not a guarantee",
      ].join("\n"),
    );
  });
});
