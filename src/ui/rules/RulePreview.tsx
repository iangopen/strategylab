import { useMemo, useState } from "react";
import { formatStat } from "../format";
import { formatUnits, previewRule, type PreviewContext } from "./preview";

interface Props {
  rule: unknown;
  context: PreviewContext;
}

/** Live bet ladder for a typed W/L script, from the compiled rule. The script is view state. */
export function RulePreview({ rule, context }: Props) {
  const [script, setScript] = useState("LLLWLW");
  const result = useMemo(() => previewRule(rule, script, context), [rule, script, context]);

  return (
    <div className="rule-preview">
      <div className={`field${result.ok ? "" : " has-error"}`}>
        <label>
          Preview: type wins and losses (W / L)
          <input type="text" value={script} spellCheck={false} onChange={(e) => setScript(e.target.value)} />
        </label>
        {!result.ok && <div className="error">{result.error}</div>}
      </div>
      {result.ok && (
        <>
          <p className="rule-ladder" aria-label="Bet ladder in units">
            {result.rows.map((r) => (
              <span key={r.round}>
                {formatUnits(r.units)}
                <sub>{r.won ? "W" : "L"}</sub> →{" "}
              </span>
            ))}
            <strong>{result.next === "stop" ? "stop" : `next ${formatUnits(result.next.units)}`}</strong>
          </p>
          {result.rows.length > 0 && (
            <div className="rule-preview-table">
              <table className="results">
                <thead>
                  <tr>
                    <th>Round</th>
                    <th>Bet (units)</th>
                    <th>Bet</th>
                    <th>Result</th>
                    <th>Bankroll after</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((r) => (
                    <tr key={r.round}>
                      <td>{r.round}</td>
                      <td>{formatUnits(r.units)}</td>
                      <td>{formatStat("money", r.bet)}</td>
                      <td>{r.won ? "Win" : "Loss"}</td>
                      <td>{formatStat("money", r.bankrollAfter)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="help">
            {result.stoppedEarly ? "The rule stopped before the end of the script. " : ""}
            Uses this scenario’s base bet, starting bankroll and payout; ignores table limits and running out of money.
          </p>
        </>
      )}
    </div>
  );
}
