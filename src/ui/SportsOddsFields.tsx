import { convertOdds, displayOdds, ODDS_LIMITS, sportsGame, type OddsFormat, type SportsInput } from "../engine/odds";
import { sportsScenarioGame, type ScenarioGame } from "../scenario";
import { NumberField } from "./NumberField";
import { PUSH_NOTE, sportsReadoutLines } from "./sportsReadout";

interface Props {
  game: ScenarioGame & { sports: SportsInput };
  onChange: (game: ScenarioGame) => void;
  /** Scenario errors; the sports ones are keyed game.sideA, game.sideB, game.estimate. */
  errors: Record<string, string>;
  disabled?: boolean;
}

/** Sports odds inputs and the always-visible readout. The odds compile to an ordinary Game. */
export function SportsOddsFields({ game, onChange, errors, disabled }: Props) {
  const s = game.sports;
  const set = (patch: Partial<SportsInput>) => onChange(sportsScenarioGame({ ...s, ...patch }, game));
  const market = s.mode === "market";
  const result = sportsGame(s);
  const show = (v: number) => displayOdds(s.format, v);
  const oddsHelp = s.format === "american" ? "e.g. -110 or +150" : "e.g. 1.91 or 2.50";

  function changeFormat(to: OddsFormat) {
    // Exact conversion; the fields show the result rounded. Invalid prices are left as typed.
    set({ format: to, sideA: convertOdds(s.sideA, s.format, to), sideB: convertOdds(s.sideB, s.format, to) });
  }

  return (
    <div className="sports-odds">
      <div className="row">
        <div className="field">
          <label>
            Input
            <select value={s.mode} disabled={disabled} onChange={(e) => set({ mode: e.target.value === "estimate" ? "estimate" : "market" })}>
              <option value="market">Both sides' odds (market)</option>
              <option value="estimate">One side + my estimate</option>
            </select>
          </label>
        </div>
        <div className="field">
          <label>
            Odds format
            <select value={s.format} disabled={disabled} onChange={(e) => changeFormat(e.target.value === "decimal" ? "decimal" : "american")}>
              <option value="american">American (-110, +150)</option>
              <option value="decimal">Decimal (1.91, 2.50)</option>
            </select>
          </label>
        </div>
      </div>
      <div className="row">
        <NumberField label={market ? "Side A odds" : "Your side's odds"} value={s.sideA} format={show} onChange={(v) => v !== null && set({ sideA: v })} error={errors["game.sideA"]} help={oddsHelp} disabled={disabled ?? false} />
        {market ? (
          <NumberField label="Side B odds" value={s.sideB} format={show} onChange={(v) => v !== null && set({ sideB: v })} error={errors["game.sideB"]} help={oddsHelp} disabled={disabled ?? false} />
        ) : (
          <NumberField
            label="Your estimated win probability"
            value={s.estimate}
            onChange={(v) => v !== null && set({ estimate: v })}
            error={errors["game.estimate"]}
            help={`${ODDS_LIMITS.estimateMin} to ${ODDS_LIMITS.estimateMax}. The simulation uses this as the true chance of winning. An estimate above the fair probability models an edge you BELIEVE you have; the simulation will honor it, but believing is not the same as having one.`}
            disabled={disabled ?? false}
          />
        )}
      </div>
      {market && (
        <div className="field">
          <label>
            Bet on
            <select value={s.side} disabled={disabled} onChange={(e) => set({ side: e.target.value === "b" ? "b" : "a" })}>
              <option value="a">Side A</option>
              <option value="b">Side B</option>
            </select>
          </label>
        </div>
      )}
      <p className="help">Prices convert exactly when you switch format; the fields show them rounded. {PUSH_NOTE}</p>
      {result.ok ? (
        <dl className="odds-readout" aria-label="What these odds imply">
          {sportsReadoutLines(result.readout).map((l) => (
            <div key={l.label} className={l.warn ? "warn" : undefined}>
              <dt>{l.label}</dt>
              <dd>{l.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="help">Fix the odds above to see what they imply.</p>
      )}
    </div>
  );
}
