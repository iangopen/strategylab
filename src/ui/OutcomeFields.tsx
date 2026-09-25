import { MAX_OUTCOMES } from "../engine/games";
import { EDITOR_LIMITS, editorGame, type EditorMode, type EditorRow, type OutcomeEditor } from "../engine/outcomeEditor";
import { editorScenarioGame, type ScenarioGame } from "../scenario";
import { NumberField } from "./NumberField";

interface Props {
  game: ScenarioGame & { editor: OutcomeEditor };
  onChange: (game: ScenarioGame) => void;
  /** Scenario errors; the editor's are keyed game.price, game.row2.prob, game.sum, ... */
  errors: Record<string, string>;
  disabled?: boolean;
}

/** The plain warning shown when every outcome returns at least the stake. */
export const CANNOT_LOSE_NOTE = "Every outcome returns at least your stake, so this game cannot lose money.";

const pct = (x: number) => `${(Math.abs(x) * 100).toFixed(3)}%`;
const dollars = (x: number) => `$${x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * The outcome editor: any number of outcomes (1-12), each with its own probability and payout, as a
 * ticket (a price and a prize per outcome) or as multipliers (the return per $1 staked). Probabilities
 * accept decimals or fractions ("1/6"), kept as typed and summed exactly.
 */
export function OutcomeFields({ game, onChange, errors, disabled }: Props) {
  const e = game.editor;
  const ticket = e.mode === "ticket";
  const set = (next: OutcomeEditor) => onChange(editorScenarioGame(next, game));
  const setRow = (i: number, patch: Partial<EditorRow>) => set({ ...e, rows: e.rows.map((r, k) => (k === i ? { ...r, ...patch } : r)) });
  const result = editorGame(e);
  const kinds = result.ok ? result.readout.kinds : null;

  function changeMode(to: EditorMode) {
    if (to === e.mode) return;
    // Ticket -> multiplier: return = prize / price. Multiplier -> ticket: a $1 ticket, prize = return.
    const price = e.price !== null && e.price > 0 ? e.price : 1;
    set(to === "multiplier" ? { mode: to, price: null, rows: e.rows.map((r) => ({ ...r, value: r.value / price })) } : { mode: to, price: 1, rows: e.rows.map((r) => ({ ...r })) });
  }

  return (
    <div className="outcome-editor">
      <div className="row">
        <div className="field">
          <label>
            Outcome input
            <select value={e.mode} disabled={disabled} onChange={(ev) => changeMode(ev.target.value === "multiplier" ? "multiplier" : "ticket")}>
              <option value="ticket">Ticket: a price and a prize per outcome</option>
              <option value="multiplier">Multiplier: return per $1 staked</option>
            </select>
          </label>
        </div>
        {ticket ? (
          <NumberField label="Ticket price" prefix="$" value={e.price} onChange={(v) => v !== null && set({ ...e, price: v })} error={errors["game.price"]} disabled={disabled ?? false} />
        ) : (
          <p className="help">0 = the stake is lost, 1 = the stake comes back (a push), 2 = an even-money win.</p>
        )}
      </div>
      <ol className="outcome-rows" aria-label="Outcomes">
        {e.rows.map((r, i) => {
          const at = `game.row${i + 1}`;
          const kind = kinds?.[i];
          const kindText = kind === "push" ? (ticket ? "push (prize = price)" : "push") : kind === "win" ? "wins" : kind === "loss" ? "loses" : "";
          return (
            <li key={i} className="outcome-row" data-testid="outcome-row">
              <div className="field">
                <label>
                  {`Outcome ${i + 1} probability`}
                  <input
                    type="text"
                    inputMode="decimal"
                    value={r.prob}
                    disabled={disabled}
                    placeholder="e.g. 1/6 or 0.25"
                    aria-invalid={errors[`${at}.prob`] ? true : undefined}
                    onChange={(ev) => setRow(i, { prob: ev.target.value })}
                  />
                </label>
                {errors[`${at}.prob`] && <div className="error">{errors[`${at}.prob`]}</div>}
              </div>
              <NumberField
                label={ticket ? `Outcome ${i + 1} prize` : `Outcome ${i + 1} return per $1`}
                prefix={ticket ? "$" : undefined}
                value={r.value}
                onChange={(v) => v !== null && setRow(i, { value: v })}
                error={errors[`${at}.value`]}
                disabled={disabled ?? false}
              />
              <div className="field">
                <label>
                  {`Outcome ${i + 1} label (optional)`}
                  <input type="text" value={r.label ?? ""} maxLength={EDITOR_LIMITS.labelMax} disabled={disabled} onChange={(ev) => setRow(i, ev.target.value === "" ? { label: undefined } : { label: ev.target.value })} />
                </label>
                {errors[`${at}.label`] && <div className="error">{errors[`${at}.label`]}</div>}
              </div>
              <div className="outcome-row-tools">
                <span className="help" data-testid="outcome-kind">{kindText}</span>
                <button type="button" className="link" disabled={disabled || e.rows.length <= 1} onClick={() => set({ ...e, rows: e.rows.filter((_, k) => k !== i) })} aria-label={`Remove outcome ${i + 1}`}>
                  Remove
                </button>
              </div>
            </li>
          );
        })}
      </ol>
      <button type="button" disabled={disabled || e.rows.length >= MAX_OUTCOMES} onClick={() => set({ ...e, rows: [...e.rows, { prob: "", value: 0 }] })}>
        + Add an outcome
      </button>
      {e.rows.length >= MAX_OUTCOMES && <p className="help">At most {MAX_OUTCOMES} outcomes.</p>}
      {errors["game.sum"] && <div className="error">{errors["game.sum"]}</div>}
      {errors["game.rows"] && <div className="error">{errors["game.rows"]}</div>}
      {result.ok ? (
        <dl className="odds-readout" aria-label="What these outcomes imply">
          <div>
            <dt>Sum of probabilities</dt>
            <dd>{result.readout.probSum}</dd>
          </div>
          {result.readout.meanPrize !== null && (
            <div>
              <dt>Mean prize</dt>
              <dd>{dollars(result.readout.meanPrize)}</dd>
            </div>
          )}
          <div>
            <dt>Mean return per $1 staked</dt>
            <dd>{result.readout.meanReturn.toFixed(4)}</dd>
          </div>
          <div>
            <dt>{result.readout.edge >= 0 ? "House edge" : "Player edge"}</dt>
            <dd>{pct(result.readout.edge)} of every dollar wagered</dd>
          </div>
          {result.readout.cannotLose && (
            <div className="warn">
              <dt>Note</dt>
              <dd>{CANNOT_LOSE_NOTE}</dd>
            </div>
          )}
        </dl>
      ) : (
        <p className="help">Fix the outcomes above to see what they imply.</p>
      )}
    </div>
  );
}
