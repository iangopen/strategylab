import type { StrategyOutcome } from "../engine/montecarlo";
import { seriesColorVar } from "./charts/adapters";
import { TABLE_ROWS } from "./format";

interface Props {
  /** colorIndex = the instance's index in the run: its ONE color everywhere (charts, replay, here). */
  columns: { label: string; outcome: StrategyOutcome; colorIndex: number }[];
  nSessions: number;
  stale: boolean;
}

/** One column per strategy instance, one row per REGISTERED stat (intervals folded in: TABLE_ROWS). No per-stat code here. */
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
            {TABLE_ROWS.map((row) => (
              <tr key={row.id} data-stat={row.id} className={row.emphasis ? "emphasis" : undefined}>
                <th scope="row">{row.label}</th>
                {columns.map((c, i) => (
                  <td key={i} data-col={i} data-raw={row.raw(c.outcome.stats)}>
                    <Cell text={row.cell(c.outcome.stats)} />
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

/** A cell's text; an interval's bracket stays on one line when a narrow screen wraps the cell. */
function Cell({ text }: { text: string }) {
  const at = text.indexOf(" (");
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)} <span className="interval">{text.slice(at + 1)}</span>
    </>
  );
}
