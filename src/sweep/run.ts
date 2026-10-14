// Runs a sweep cell by cell through the EXISTING Monte Carlo path (runMonteCarlo, unchanged). Called in
// the worker; pure, so tests run it directly. The caps are re-checked here on the request itself, so a
// request that skipped the app's validation (a crafted link, a bug) still can't run an oversize sweep.
import { runMonteCarlo } from "../engine/montecarlo";
import { MAX_SWEEP_SESSIONS, MAX_SWEEP_STEPS, MIN_SWEEP_CELL_SESSIONS } from "../share/limits";
import { resolveStrategies } from "../worker/resolve";
import type { SimRequest } from "../worker/sim.worker";

/** One cell's request: an ordinary single-strategy run (cellScenario through toSimRequest). */
export interface SweepRequest {
  cells: SimRequest[];
}

export interface SweepCellResult {
  index: number;
  nSessions: number;
  /** Every registered statistic of the cell's run, keyed by StatDef.id (the heatmap shows pBust). */
  stats: Record<string, number>;
}

/** Throws a readable Error when the request breaks a sweep cap. */
export function assertSweepWithinCaps(req: SweepRequest): void {
  const cells = req.cells.length;
  if (cells < 1 || cells > MAX_SWEEP_STEPS * MAX_SWEEP_STEPS) throw new Error(`A sweep has 1 to ${MAX_SWEEP_STEPS * MAX_SWEEP_STEPS} cells (got ${cells})`);
  let total = 0;
  for (const c of req.cells) {
    if (c.strategies.length !== 1) throw new Error("A sweep cell runs exactly one strategy");
    if (!(c.nSessions >= MIN_SWEEP_CELL_SESSIONS)) throw new Error(`Every sweep cell needs at least ${MIN_SWEEP_CELL_SESSIONS} sessions`);
    total += c.nSessions;
  }
  if (total > MAX_SWEEP_SESSIONS) throw new Error(`A sweep runs at most ${MAX_SWEEP_SESSIONS.toLocaleString("en-US")} sessions (got ${total.toLocaleString("en-US")})`);
}

/**
 * Runs every cell in index order. `onCell` gets each cell as soon as it finishes (the heatmap fills in);
 * `onProgress` gets the overall fraction about every 0.5%. Returns all cells.
 */
export function runSweep(req: SweepRequest, onCell?: (cell: SweepCellResult) => void, onProgress?: (fraction: number) => void): SweepCellResult[] {
  assertSweepWithinCaps(req);
  const n = req.cells.length;
  const out: SweepCellResult[] = [];
  let lastStep = -1;
  const report = (f: number) => {
    const step = Math.floor(f * 200);
    if (step > lastStep) {
      lastStep = step;
      onProgress?.(f);
    }
  };
  for (let k = 0; k < n; k++) {
    const c = req.cells[k]!;
    const r = runMonteCarlo(c.game, resolveStrategies(c.strategies), c.session, c.nSessions, c.masterSeed, onProgress ? (f) => report((k + f) / n) : undefined);
    const cell: SweepCellResult = { index: k, nSessions: r.nSessions, stats: r.perStrategy[0]!.stats };
    out.push(cell);
    onCell?.(cell);
  }
  return out;
}
