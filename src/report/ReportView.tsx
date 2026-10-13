// The one-page report for a finished run: configuration, seed, build, the share link, key statistics,
// the main chart and the takeaway sentences. Laid out for US Letter (see the print rules in index.css);
// "Print / save as PDF" calls window.print(), so no PDF library is needed. Everything on the page comes
// from the run's own snapshot (never the live form), so the link reproduces exactly these numbers.
import { useEffect, useMemo, useRef } from "react";
import { edge } from "../engine/games";
import type { MonteCarloResult } from "../engine/montecarlo";
import type { ScenarioConfig } from "../scenario";
import { encodeScenarioLink } from "../share/link";
import type { ChartRefs } from "../ui/charts/adapters";
import { seriesColorVar } from "../ui/charts/adapters";
import { baseUrl } from "../ui/linkBoot";
import { ReportChart } from "./ReportChart";
import { REPORT_ROWS, scenarioSummary } from "./summary";
import { takeaways } from "./takeaways";

/** The build this page was made from (vite.config.ts injects it). */
const COMMIT_HASH: string = __COMMIT_HASH__;

/** Above this many strategies the report uses a denser type size, so eight columns still fit one page. */
const DENSE_ABOVE = 4;

interface Props {
  result: MonteCarloResult;
  labels: readonly string[];
  /** The scenario exactly as it was when Run was clicked. */
  scenario: ScenarioConfig;
  refs: ChartRefs;
  onClose: () => void;
}

/** While the report is open the page is drawn in the light theme, so the screen matches the paper. */
function useLightTheme(): void {
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.dataset.theme;
    root.dataset.theme = "light";
    return () => {
      if (previous === undefined) delete root.dataset.theme;
      else root.dataset.theme = previous;
    };
  }, []);
}

export function ReportView({ result, labels, scenario, refs, onClose }: Props) {
  useLightTheme();
  const heading = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => heading.current?.focus(), []);

  const link = useMemo(() => encodeScenarioLink(scenario, baseUrl()), [scenario]);
  const url = link.ok ? baseUrl() + link.fragment : null;
  const summary = useMemo(() => scenarioSummary(scenario, labels), [scenario, labels]);
  const sentences = useMemo(
    () => takeaways({ edge: edge({ outcomes: scenario.game.outcomes }), nSessions: result.nSessions, strategies: result.perStrategy.map((o, i) => ({ label: labels[i] ?? o.strategyId, stats: o.stats })) }),
    [result, labels, scenario],
  );

  return (
    <div className="report-page">
      <div className="report-tools no-print">
        <button type="button" className="primary" onClick={() => window.print()}>
          Print / save as PDF
        </button>
        <button type="button" onClick={onClose}>
          Back to the lab
        </button>
        <span className="help">One US Letter page. In the print dialog, choose "Save as PDF" to keep a copy.</span>
      </div>

      <article className={result.perStrategy.length > DENSE_ABOVE ? "report dense" : "report"} data-testid="report" aria-labelledby="report-title">
        <header className="report-head">
          <h1 id="report-title" ref={heading} tabIndex={-1}>
            StrategyLab report
          </h1>
          <p className="report-sub">
            A Monte Carlo simulation of {result.perStrategy.length === 1 ? "one betting strategy" : `${result.perStrategy.length} betting strategies`} on identical random outcomes. An educational
            simulation for adults (18+): no real money, not betting advice. US National Problem Gambling Helpline: 1-800-MY-RESET.
          </p>
        </header>

        <section className="report-section" aria-label="Takeaways">
          <h2>Takeaways</h2>
          <ul className="report-takeaways" data-testid="report-takeaways">
            {sentences.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </section>

        <section className="report-section" aria-label="Key statistics">
          <h2>Key statistics</h2>
          <table className="report-table" data-testid="report-table">
            <thead>
              <tr>
                <th scope="col">Statistic</th>
                {labels.map((l, i) => (
                  <th scope="col" key={i}>
                    <span className="swatch" style={{ background: `var(${seriesColorVar(i)})` }} aria-hidden="true" />
                    {l}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {REPORT_ROWS.map((row) => (
                <tr key={row.label}>
                  <th scope="row">{row.label}</th>
                  {result.perStrategy.map((o, i) => (
                    <td key={i}>{row.cell(o.stats)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="report-note">
            Intervals are 95%: Wilson intervals for proportions, and EV per $ ± 1.96 standard errors. Rounds to bust count busted sessions only.
          </p>
        </section>

        <section className="report-section" aria-label="Bankroll over time">
          <h2>Bankroll over time</h2>
          <p className="report-note">
            Middle 90% (light) and 50% (dark) of the first {result.bands.sessions.toLocaleString("en-US")} sessions, the median (thick line) and 50 sample sessions; every panel uses the same axes.
          </p>
          <ReportChart result={result} labels={labels} refs={refs} />
        </section>

        <section className="report-section" aria-label="Configuration">
          <h2>Configuration</h2>
          <dl className="report-config" data-testid="report-config">
            {summary.map((line) => (
              <div key={line.label} className={line.label === "Strategies" ? "wide" : undefined}>
                <dt>{line.label}</dt>
                <dd>{line.value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="report-section" aria-label="Reproduce this run">
          <h2>Reproduce this run</h2>
          <p className="report-note">
            Open the link and press Run: it holds the seed and every setting, so the same build gives the same numbers bit for bit. Seed{" "}
            <strong data-testid="report-seed">{scenario.seed}</strong>, {result.nSessions.toLocaleString("en-US")} sessions, build{" "}
            <strong data-testid="report-commit">{COMMIT_HASH}</strong> (github.com/iangopen/strategylab).
          </p>
          {url ? (
            <p className="report-link" data-testid="report-link">
              {url}
            </p>
          ) : (
            <p className="report-link" data-testid="report-link-error">
              {link.ok ? "" : link.message} The configuration above lists every setting instead.
            </p>
          )}
        </section>
      </article>
    </div>
  );
}
