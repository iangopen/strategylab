// A sweep cell is an ordinary run: its statistics equal a standalone runMonteCarlo with the cell's
// settings and its documented derived seed, bit for bit. (stats project: about 3,000 sessions.)
import { describe, expect, it } from "vitest";
import { runMonteCarlo } from "../engine/montecarlo";
import { splitmix32 } from "../engine/rng";
import { defaultScenario, toSimRequest, type ScenarioConfig } from "../scenario";
import { resolveStrategies } from "../worker/resolve";
import { toSweepRequest } from "./request";
import { runSweep, type SweepCellResult } from "./run";
import type { SweepConfig } from "./sweep";

const base = defaultScenario();
const martingale = base.strategies[1]!;
const SWEEP: SweepConfig = {
  x: { field: "startBankroll", start: 200, end: 1000, steps: 3 },
  y: { field: "baseBet", start: 5, end: 20, steps: 2 },
  strategyUid: martingale.uid,
  targetPct: 5,
};
const scenario: ScenarioConfig = { ...base, sessions: 500, sweep: SWEEP };

describe("sweep cells reproduce alone", () => {
  const seen: SweepCellResult[] = [];
  const progress: number[] = [];
  const cells = runSweep(toSweepRequest(scenario, SWEEP), (c) => seen.push(c), (f) => progress.push(f));

  it("each cell's statistics equal a standalone run with that config and the derived seed, exactly", () => {
    // Built by hand from the documented rule, NOT from cellScenario/cellSeed: a broken derivation fails here.
    const xs = [200, 600, 1000];
    const ys = [5, 20];
    for (const k of [0, 4, 5]) {
      const row = Math.floor(k / 3);
      const col = k % 3;
      const seed = splitmix32((12345 ^ splitmix32((k ^ 0x53574550) >>> 0)) >>> 0);
      const alone: ScenarioConfig = { ...base, startBankroll: xs[col]!, baseBet: ys[row]!, sessions: 500, seed, strategies: [martingale] };
      const req = toSimRequest(alone);
      const r = runMonteCarlo(req.game, resolveStrategies(req.strategies), req.session, req.nSessions, req.masterSeed);
      const expected = r.perStrategy[0]!.stats;
      expect(cells[k]!.stats, `cell ${k}`).toEqual(expected);
      expect(Object.keys(expected).length).toBeGreaterThan(10);
      console.log(`[sweep] cell ${k} (bankroll $${xs[col]}, base bet $${ys[row]}, seed ${seed}): P(bust) ${expected.pBust} = standalone`);
    }
  });

  it("the cells differ from each other (each has its own seed and settings), and every cell ran 500 sessions", () => {
    expect(new Set(cells.map((c) => c.stats.pBust)).size).toBeGreaterThan(3);
    expect(cells.map((c) => c.nSessions)).toEqual(Array(6).fill(500));
  });

  it("onCell reports every cell once, in order, as it finishes; progress rises to 1", () => {
    expect(seen.map((c) => c.index)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(seen).toEqual(cells);
    for (let i = 1; i < progress.length; i++) expect(progress[i]!).toBeGreaterThan(progress[i - 1]!);
    expect(progress.at(-1)).toBe(1);
    expect(progress.length).toBeLessThanOrEqual(201);
  });
});
