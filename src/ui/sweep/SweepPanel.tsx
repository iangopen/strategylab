import { useMemo } from "react";
import { readoutInputOf, sweepReadout } from "../../report/sweepReadout";
import type { ScenarioConfig } from "../../scenario";
import { MAX_SWEEP_SESSIONS, MAX_SWEEP_STEPS } from "../../share/limits";
import type { SweepCellResult } from "../../sweep/run";
import { defaultSweep, isMoneyField, SWEEP_FIELD_LABELS, SWEEP_FIELDS, sweepGrid, type SweepAxis, type SweepConfig, type SweepField, type SweepGrid } from "../../sweep/sweep";
import { instanceLabel } from "../format";
import { NumberField } from "../NumberField";
import { readoutCell } from "./heatmap";
import { SweepHeatmap } from "./SweepHeatmap";

/** A sweep that ran (or is running): its own snapshot, so editing the form never changes what is shown. */
export interface SweepRun {
  scenario: ScenarioConfig;
  sweep: SweepConfig;
  grid: SweepGrid;
  strategyLabel: string;
  cells: (SweepCellResult | null)[];
  complete: boolean;
  /** JSON of the scenario when the sweep started, to flag stale results. */
  scenarioJson: string;
}

interface Props {
  scenario: ScenarioConfig;
  onChange: (s: ScenarioConfig) => void;
  errors: Record<string, string>;
  /** The scenario apart from its sweep has no errors (a sweep cell inherits every other setting). */
  baseValid: boolean;
  /** Something is running in the worker (a run or a sweep). */
  busy: boolean;
  sweeping: boolean;
  progress: number;
  status: string | null;
  run: SweepRun | null;
  onRun: () => void;
  onCancel: () => void;
}

const n = (v: number) => v.toLocaleString("en-US");

export function SweepPanel({ scenario, onChange, errors, baseValid, busy, sweeping, progress, status, run, onRun, onCancel }: Props) {
  const sweep = scenario.sweep;
  const sweepErrors = Object.keys(errors).filter((k) => k === "sweep" || k.startsWith("sweep."));
  const valid = sweep !== undefined && sweepErrors.length === 0;
  const grid = useMemo(() => (sweep && valid ? sweepGrid(scenario, sweep) : null), [scenario, sweep, valid]);
  const set = (next: SweepConfig | undefined) => {
    const { sweep: _old, ...rest } = scenario;
    onChange(next ? { ...rest, sweep: next } : rest);
  };

  const readout = useMemo(() => (run && run.complete ? sweepReadout(readoutInputOf(run.sweep, run.grid, run.cells.map((c) => (c ? readoutCell(c) : null)))) : null), [run]);
  const stale = run !== null && run.scenarioJson !== JSON.stringify(scenario);

  return (
    <section className="panel sweep-panel" aria-labelledby="sweep-heading">
      <h2 id="sweep-heading">Parameter sweep</h2>
      <p className="help">
        Vary two settings across a grid for one strategy and see P(bust) in every cell. Each cell is an ordinary run with its own seed, so any cell can be reproduced on its own. At most {MAX_SWEEP_STEPS} × {MAX_SWEEP_STEPS} cells and {n(MAX_SWEEP_SESSIONS)} sessions in total.
      </p>
      {!sweep ? (
        <button type="button" disabled={scenario.strategies.length === 0 || busy} onClick={() => set(defaultSweep(scenario.strategies[0]!.uid))}>
          Set up a sweep
        </button>
      ) : (
        <>
          <div className="sweep-form">
            <div className={`field${errors["sweep.strategy"] ? " has-error" : ""}`}>
              <label>
                Strategy
                <select value={sweep.strategyUid} disabled={busy} onChange={(e) => set({ ...sweep, strategyUid: e.target.value })}>
                  {!scenario.strategies.some((i) => i.uid === sweep.strategyUid) && <option value={sweep.strategyUid}>(pick one)</option>}
                  {scenario.strategies.map((inst, i) => (
                    <option key={inst.uid} value={inst.uid}>
                      {instanceLabel(scenario.strategies, i)}
                    </option>
                  ))}
                </select>
              </label>
              {errors["sweep.strategy"] && <div className="error">{errors["sweep.strategy"]}</div>}
            </div>
            <AxisFields name="Across (columns)" axis={sweep.x} error={errors["sweep.x"]} disabled={busy} onChange={(x) => set({ ...sweep, x })} />
            <AxisFields name="Up (rows)" axis={sweep.y} error={errors["sweep.y"]} disabled={busy} onChange={(y) => set({ ...sweep, y })} />
            <div className="sweep-target">
              <NumberField label="Readout target: P(bust) below (%)" value={sweep.targetPct} error={errors["sweep.target"]} disabled={busy} onChange={(v) => v !== null && set({ ...sweep, targetPct: v })} />
            </div>
          </div>
          {errors.sweep && <div className="error" data-testid="sweep-error">{errors.sweep}</div>}
          {grid && (
            <p className="help" data-testid="sweep-size">
              {n(grid.cells)} cells × {n(grid.sessionsPerCell)} sessions = {n(grid.cells * grid.sessionsPerCell)} sessions
              {grid.sessionsPerCell < scenario.sessions ? ` (fewer than the ${n(scenario.sessions)} in Sessions, to stay within ${n(MAX_SWEEP_SESSIONS)} in total)` : ""}. Every other setting comes from the scenario above.
            </p>
          )}
          <div className="run-row">
            <button type="button" className="primary" disabled={busy || !valid || !baseValid} onClick={onRun}>
              Run sweep
            </button>
            <button type="button" disabled={!sweeping} onClick={onCancel}>
              Cancel sweep
            </button>
            <progress max={1} value={progress} aria-label="Sweep progress" />
            <span className="mono">{Math.round(progress * 100)}%</span>
            <button type="button" disabled={busy} onClick={() => set(undefined)}>
              Remove sweep
            </button>
          </div>
          {!baseValid && <div className="error">Fix the highlighted settings above to run a sweep.</div>}
        </>
      )}
      <div role="status" aria-atomic="true" data-testid="sweep-announcer">
        {status && (
          <div className="status" data-testid="sweep-status">
            {status}
          </div>
        )}
      </div>
      {run && (
        <div className="sweep-result" data-testid="sweep-result">
          <h3>
            P(bust) for {run.strategyLabel}, {n(run.grid.sessionsPerCell)} sessions per cell
          </h3>
          {stale && <p className="help stale">The configuration has changed since this sweep.</p>}
          <SweepHeatmap sweep={run.sweep} grid={run.grid} cells={run.cells} complete={run.complete}>
            {readout && (
              <ul className="sweep-readout" data-testid="sweep-readout">
                {readout.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            )}
          </SweepHeatmap>
        </div>
      )}
    </section>
  );
}

function AxisFields({ name, axis, error, disabled, onChange }: { name: string; axis: SweepAxis; error: string | undefined; disabled: boolean; onChange: (a: SweepAxis) => void }) {
  const money = isMoneyField(axis.field);
  return (
    <fieldset className={`sweep-axis${error ? " has-error" : ""}`}>
      <legend>{name}</legend>
      <label>
        Setting
        <select value={axis.field} disabled={disabled} onChange={(e) => onChange({ ...axis, field: e.target.value as SweepField })}>
          {SWEEP_FIELDS.map((f) => (
            <option key={f} value={f}>
              {SWEEP_FIELD_LABELS[f]}
            </option>
          ))}
        </select>
      </label>
      <div className="sweep-axis-numbers">
        <NumberField label="From" prefix={money ? "$" : undefined} value={axis.start} disabled={disabled} onChange={(v) => v !== null && onChange({ ...axis, start: v })} />
        <NumberField label="To" prefix={money ? "$" : undefined} value={axis.end} disabled={disabled} onChange={(v) => v !== null && onChange({ ...axis, end: v })} />
        <NumberField label="Steps" value={axis.steps} disabled={disabled} onChange={(v) => v !== null && onChange({ ...axis, steps: v })} />
      </div>
      {error && <div className="error">{error}</div>}
    </fieldset>
  );
}
