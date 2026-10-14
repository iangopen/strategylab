// Validation of a sweep setup, including the size caps. validateScenario runs this, so the form, the
// link loader (its settle pass drops an invalid sweep) and Copy link all see the same errors, and the
// worker's runSweep re-checks the caps on the request it is given.
import type { ScenarioConfig } from "../scenario";
import { MAX_SWEEP_SESSIONS, MAX_SWEEP_STEPS, MIN_SWEEP_CELL_SESSIONS } from "../share/limits";
import { axisValues, cellScenario, formatAxisValue, isMoneyField, SWEEP_FIELD_LABELS, SWEEP_FIELDS, sweepGrid, sweepSessionsPerCell, type SweepAxis, type SweepConfig } from "./sweep";

const n = (v: number) => v.toLocaleString("en-US");

function axisError(axis: SweepAxis): string | null {
  if (!SWEEP_FIELDS.includes(axis.field)) return "Pick a setting to sweep.";
  if (!Number.isInteger(axis.steps) || axis.steps < 1 || axis.steps > MAX_SWEEP_STEPS) {
    return `Steps must be a whole number from 1 to ${MAX_SWEEP_STEPS} (a sweep is at most ${MAX_SWEEP_STEPS} × ${MAX_SWEEP_STEPS} cells).`;
  }
  if (!Number.isFinite(axis.start) || !Number.isFinite(axis.end)) return "Start and end must be numbers.";
  if (axis.steps > 1 && !(axis.end > axis.start)) return "End must be above start.";
  const values = axisValues(axis);
  for (let i = 1; i < values.length; i++) {
    if (!(values[i]! > values[i - 1]!)) {
      return `These steps repeat a value after rounding to ${isMoneyField(axis.field) ? "whole cents" : "whole rounds"}: use fewer steps or a wider range.`;
    }
  }
  return null;
}

/** Keys of the per-cell checks that come from the sweep (the rest of the scenario reports its own). */
const CELL_KEYS = new Set(["startBankroll", "baseBet", "tableMin", "tableMax", "stopWin", "stopLoss", "maxRounds"]);

/**
 * Errors keyed "sweep.x", "sweep.y", "sweep.strategy", "sweep.target" and "sweep" (the grid as a whole).
 * `validateBase` is the scenario validator without the sweep, used on every cell's scenario so a cell
 * that the app itself would refuse to run (say, a bankroll at or above the win target) is caught here.
 */
export function validateSweep(s: ScenarioConfig, sweep: SweepConfig, validateBase: (s: ScenarioConfig) => Record<string, string>): Record<string, string> {
  const e: Record<string, string> = {};
  const xe = axisError(sweep.x);
  const ye = axisError(sweep.y);
  if (xe) e["sweep.x"] = xe;
  if (ye) e["sweep.y"] = ye;
  if (!xe && !ye && sweep.x.field === sweep.y.field) e["sweep.y"] = "The two axes must sweep different settings.";
  if (!s.strategies.some((i) => i.uid === sweep.strategyUid)) e["sweep.strategy"] = "Pick one of the scenario's strategies to sweep.";
  if (!(Number.isFinite(sweep.targetPct) && sweep.targetPct > 0 && sweep.targetPct < 100)) e["sweep.target"] = "The target must be a percentage above 0 and below 100.";
  if (Object.keys(e).length > 0) return e;

  const grid = sweepGrid(s, sweep);
  const perCell = sweepSessionsPerCell(grid.cells, s.sessions);
  if (!Number.isInteger(s.sessions) || perCell < MIN_SWEEP_CELL_SESSIONS) {
    e.sweep =
      Math.floor(MAX_SWEEP_SESSIONS / grid.cells) < MIN_SWEEP_CELL_SESSIONS
        ? `${n(grid.cells)} cells would get fewer than ${n(MIN_SWEEP_CELL_SESSIONS)} sessions each within the ${n(MAX_SWEEP_SESSIONS)}-session limit: use fewer steps.`
        : `Each cell needs at least ${n(MIN_SWEEP_CELL_SESSIONS)} sessions: set Sessions to ${n(MIN_SWEEP_CELL_SESSIONS)} or more.`;
    return e;
  }

  // Every cell must be a scenario the app would run. Report the first cell that is not, naming its values.
  const baseErrors = validateBase(s);
  for (let k = 0; k < grid.cells; k++) {
    const cell = cellScenario(s, sweep, k, grid);
    const bad = Object.entries(validateBase(cell)).find(([key]) => CELL_KEYS.has(key) && !(key in baseErrors));
    if (bad) {
      const at = [sweep.x, sweep.y].map((a) => `${SWEEP_FIELD_LABELS[a.field].toLowerCase()} ${formatAxisValue(a.field, cell[a.field])}`).join(", ");
      e.sweep = `The cell with ${at} can't run: ${SCENARIO_FIELD_NAMES[bad[0]] ?? bad[0]}: ${bad[1]}`;
      return e;
    }
  }
  return e;
}

const SCENARIO_FIELD_NAMES: Record<string, string> = {
  startBankroll: "starting bankroll",
  baseBet: "base bet",
  tableMin: "table minimum",
  tableMax: "table maximum",
  stopWin: "win target",
  stopLoss: "stop-loss floor",
  maxRounds: "max rounds",
};

/** True for the error keys validateSweep produces (the plain Run ignores them). */
export const isSweepErrorKey = (key: string): boolean => key === "sweep" || key.startsWith("sweep.");
