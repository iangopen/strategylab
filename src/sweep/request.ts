// A VALID scenario's sweep as the worker request: one ordinary SimRequest per cell, in cell order.
import { toSimRequest, type ScenarioConfig } from "../scenario";
import type { SweepRequest } from "./run";
import { cellScenario, sweepGrid, type SweepConfig } from "./sweep";

export function toSweepRequest(s: ScenarioConfig, sweep: SweepConfig): SweepRequest {
  const grid = sweepGrid(s, sweep);
  return { cells: Array.from({ length: grid.cells }, (_, k) => toSimRequest(cellScenario(s, sweep, k, grid))) };
}
