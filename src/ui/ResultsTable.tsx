import type { StrategyOutcome } from "../engine/montecarlo";
import { STATS } from "../engine/stats/registry";
import { seriesColorVar } from "./charts/adapters";
import { formatStat } from "./format";

interface Props {
  /** colorIndex = the instance's index in the run: its ONE color everywhere (charts, replay, here). */
  columns: { label: string; outcome: StrategyOutcome; colorIndex: number }[];
  nSessions: number;
  stale: boolean;
}

/** One column per strategy instance, one row per REGISTERED stat. No per-stat code here. */
export function ResultsTable({ columns, nSessions, stale }: Props) {
  if (columns.length === 0) {
    return (
      <section className="panel">
        <h2>Results</h2>
        <p className="help">Run a simulation to see results.</p>
      </section>
    );
  }
  return (
    <section className="panel">
      <h2>Results</h2>
      <p className="help">
        {nSessions.toLocaleString("en-US")} sessions per strategy.
        {stale && <span className="stale"> The configuration has changed since this run.</span>}
      </p>
      <div className="table-wrap">
        <table className="results" data-testid="results-table">
          <thead>
            <tr>
              <th scope="col">Statistic</th>
              {columns.map((c, i) => (
                <th scope="col" key={i}>
                  <span className="swatch" style={{ background: `var(${seriesColorVar(c.colorIndex)})` }} aria-hidden="true" />
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {STATS.map((stat) => (
              <tr key={stat.id} data-stat={stat.id} className={stat.emphasis ? "emphasis" : undefined}>
                <th scope="row">{stat.label}</th>
                {columns.map((c, i) => (
                  <td key={i} data-col={i}>
                    {formatStat(stat.format, c.outcome.stats[stat.id])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
