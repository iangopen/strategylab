import type { StrategyOutcome } from "../engine/montecarlo";
import { seriesColorVar } from "./charts/adapters";
import { FRAGILE_CELL_TEXT, FRAGILE_MARK, fragileFootnote, TABLE_ROWS, type EvNote } from "./format";

interface Props {
  /** colorIndex = the instance's index in the run: its ONE color everywhere (charts, replay, here). */
  columns: { label: string; outcome: StrategyOutcome; colorIndex: number; evNote?: EvNote | null }[];
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
  const fragile = columns.filter((c) => c.evNote);
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
                {columns.map((c, i) => {
                  // The number and its interval stay exactly as measured; a fragile EV per $ only gains a marker.
                  const marked = row.id === "evPerWagered" && c.evNote;
                  return (
                    <td key={i} data-col={i} data-raw={row.raw(c.outcome.stats)} data-fragile={marked ? "true" : undefined} aria-describedby={marked ? "fragile-note" : undefined}>
                      <Cell text={row.cell(c.outcome.stats)} />
                      {marked && (
                        <>
                          <span className="fragile-mark" aria-hidden="true" title={fragileFootnote(c.evNote!.gain)}>
                            {FRAGILE_MARK}
                          </span>
                          <span className="sr-only"> {FRAGILE_CELL_TEXT}</span>
                        </>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {fragile.length > 0 && (
        <p className="help fragile-note" id="fragile-note" data-testid="fragile-note">
          <span aria-hidden="true">{FRAGILE_MARK} </span>
          EV per $ wagered for {fragile.map((c) => c.label).join(", ")}: {fragileFootnote(fragile.some((c) => c.evNote!.gain)).replace(/^A/, "a")}
        </p>
      )}
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
