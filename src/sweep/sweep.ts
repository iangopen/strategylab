// Parameter sweeps (session 20): two numeric settings across a grid, one strategy, P(bust) per cell.
// Pure (no React, no DOM). Each cell is an ORDINARY scenario run once through the existing Monte Carlo
// path with its own derived seed, so any cell can be reproduced alone: cellScenario(s, k) is that run.
import { splitmix32 } from "../engine/rng";
import type { ScenarioConfig } from "../scenario";
import { MAX_SWEEP_SESSIONS } from "../share/limits";

/** The settings a sweep axis can vary: plain numbers in ScenarioConfig with no derived inputs. */
export const SWEEP_FIELDS = ["startBankroll", "baseBet", "maxRounds"] as const;
export type SweepField = (typeof SWEEP_FIELDS)[number];

export const SWEEP_FIELD_LABELS: Record<SweepField, string> = {
  startBankroll: "Starting bankroll",
  baseBet: "Base bet",
  maxRounds: "Max rounds per session",
};

/** Units shown on axis labels and in the table header. */
export const SWEEP_FIELD_UNITS: Record<SweepField, string> = { startBankroll: "$", baseBet: "$", maxRounds: "rounds" };

export const isMoneyField = (f: SweepField): boolean => f !== "maxRounds";

/** One axis: `steps` evenly spaced values from start to end (both included; one step = start only). */
export interface SweepAxis {
  field: SweepField;
  start: number;
  end: number;
  steps: number;
}

/** The sweep setup. Scenario state (it travels in the share link); its results are view state. */
export interface SweepConfig {
  /** Columns of the heatmap. */
  x: SweepAxis;
  /** Rows of the heatmap. */
  y: SweepAxis;
  /** The swept strategy instance (its uid; a link stores its index instead). */
  strategyUid: string;
  /** The readout's target: P(bust) below this many percent (5 = 5%). */
  targetPct: number;
}

export const DEFAULT_SWEEP_TARGET_PCT = 5;

/** A first sweep: bankroll $100-$1,000 (10 values) by base bet $5-$25 (5 values), target 5%. */
export function defaultSweep(strategyUid: string): SweepConfig {
  return {
    x: { field: "startBankroll", start: 100, end: 1000, steps: 10 },
    y: { field: "baseBet", start: 5, end: 25, steps: 5 },
    strategyUid,
    targetPct: DEFAULT_SWEEP_TARGET_PCT,
  };
}

/**
 * The axis values, ascending. Money is rounded to whole cents and max rounds to whole numbers, so a cell
 * holds exactly the value a user could type. Call only on an axis whose steps passed validation.
 */
export function axisValues(axis: SweepAxis): number[] {
  const round = isMoneyField(axis.field) ? (v: number) => Math.round(v * 100) / 100 : Math.round;
  if (axis.steps === 1) return [round(axis.start)];
  return Array.from({ length: axis.steps }, (_, j) => round(j === axis.steps - 1 ? axis.end : axis.start + ((axis.end - axis.start) * j) / (axis.steps - 1)));
}

/** Cells are numbered row by row: index = row * xSteps + column (row = y value, column = x value). */
export function cellIndex(sweep: Pick<SweepConfig, "x">, row: number, col: number): number {
  return row * sweep.x.steps + col;
}

/** Salt so a cell seed never equals the session seed of the same index ("SWEP" in ASCII). */
export const SWEEP_SEED_SALT = 0x53574550;

/**
 * Seed of cell k: splitmix32(baseSeed XOR splitmix32(k XOR SWEEP_SEED_SALT)), an unsigned 32-bit
 * integer. The same construction as session seeds (rule 3), never baseSeed + k: adjacent mulberry32
 * seeds are correlated. Cells are therefore INDEPENDENT simulations; inside a cell, sessions get the
 * usual sessionSeed(cellSeed, i).
 */
export function cellSeed(baseSeed: number, k: number): number {
  return splitmix32((baseSeed ^ splitmix32((k ^ SWEEP_SEED_SALT) >>> 0)) >>> 0);
}

/** Sessions per cell: the user's setting, capped so the sweep stays within MAX_SWEEP_SESSIONS in total. */
export function sweepSessionsPerCell(cells: number, userSessions: number): number {
  return Math.min(userSessions, Math.floor(MAX_SWEEP_SESSIONS / cells));
}

/** The facts of a VALID sweep: axis values, cell count, sessions per cell. */
export interface SweepGrid {
  xValues: number[];
  yValues: number[];
  cells: number;
  sessionsPerCell: number;
}

export function sweepGrid(s: ScenarioConfig, sweep: SweepConfig): SweepGrid {
  const xValues = axisValues(sweep.x);
  const yValues = axisValues(sweep.y);
  const cells = xValues.length * yValues.length;
  return { xValues, yValues, cells, sessionsPerCell: sweepSessionsPerCell(cells, s.sessions) };
}

/**
 * Cell k as a standalone scenario: the base scenario with the two swept settings, the cell's sessions
 * and derived seed, and only the swept strategy. Running it gives exactly the cell's statistics.
 */
export function cellScenario(s: ScenarioConfig, sweep: SweepConfig, k: number, grid: SweepGrid = sweepGrid(s, sweep)): ScenarioConfig {
  const row = Math.floor(k / grid.xValues.length);
  const col = k % grid.xValues.length;
  const { sweep: _omit, ...base } = s;
  const strategies = s.strategies.filter((i) => i.uid === sweep.strategyUid);
  return {
    ...base,
    [sweep.x.field]: grid.xValues[col]!,
    [sweep.y.field]: grid.yValues[row]!,
    sessions: grid.sessionsPerCell,
    seed: cellSeed(s.seed, k),
    strategies,
  };
}

const dollars0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 });
const dollars2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** An axis value in its unit: "$1,000", "$12.50" (cents only when there are any), "1,000 rounds" (withUnit). */
export function formatAxisValue(field: SweepField, v: number, withUnit = false): string {
  if (isMoneyField(field)) return Number.isInteger(v) ? dollars0.format(v) : dollars2.format(v);
  const s = v.toLocaleString("en-US");
  return withUnit ? `${s} rounds` : s;
}
