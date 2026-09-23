import { CUSTOM_GAME_ID, edge, findPreset, GAME_PRESETS } from "../engine/games";
import { MAX_SEED, type ScenarioConfig } from "../scenario";
import { NumberField } from "./NumberField";

interface Props {
  scenario: ScenarioConfig;
  onChange: (s: ScenarioConfig) => void;
  errors: Record<string, string>;
  disabled?: boolean;
}

function randomSeed(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0]!;
}

export function ConfigPanel({ scenario: s, onChange, errors, disabled }: Props) {
  const set = <K extends keyof ScenarioConfig>(key: K, value: ScenarioConfig[K]) => onChange({ ...s, [key]: value });
  const isCustom = s.game.presetId === CUSTOM_GAME_ID;
  const e = edge(s.game);

  function choosePreset(presetId: string) {
    const preset = findPreset(presetId);
    set("game", preset ? { presetId, winProb: preset.winProb, netPayout: preset.netPayout } : { ...s.game, presetId });
  }

  return (
    <section className="panel">
      <h2>Game</h2>
      <div className="field">
        <label>
          Game
          <select value={s.game.presetId} disabled={disabled} onChange={(ev) => choosePreset(ev.target.value)}>
            {GAME_PRESETS.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
            <option value={CUSTOM_GAME_ID}>Custom</option>
          </select>
        </label>
      </div>
      <div className="row">
        <NumberField
          label="Win probability"
          value={s.game.winProb}
          onChange={(v) => v !== null && set("game", { ...s.game, winProb: v })}
          disabled={disabled || !isCustom}
        />
        <NumberField
          label="Net payout (per $1 staked)"
          value={s.game.netPayout}
          onChange={(v) => v !== null && set("game", { ...s.game, netPayout: v })}
          disabled={disabled || !isCustom}
        />
      </div>
      {errors.game ? (
        <div className="error">{errors.game}</div>
      ) : (
        <div className="derived">
          {e >= 0 ? "House edge" : "Player edge"}: <strong>{(Math.abs(e) * 100).toFixed(3)}%</strong> of every dollar wagered
        </div>
      )}

      <h2>Bankroll and table</h2>
      <div className="row">
        <NumberField label="Starting bankroll" prefix="$" value={s.startBankroll} onChange={(v) => v !== null && set("startBankroll", v)} error={errors.startBankroll} disabled={disabled} />
        <NumberField label="Base bet" prefix="$" value={s.baseBet} onChange={(v) => v !== null && set("baseBet", v)} error={errors.baseBet} disabled={disabled} />
      </div>
      <div className="row">
        <NumberField label="Table minimum" prefix="$" value={s.tableMin} onChange={(v) => v !== null && set("tableMin", v)} error={errors.tableMin} disabled={disabled} />
        <NumberField label="Table maximum" prefix="$" optional placeholder="no limit" value={s.tableMax} onChange={(v) => set("tableMax", v)} error={errors.tableMax} disabled={disabled} />
      </div>
      <div className="row">
        <NumberField
          label="Stop at win target"
          prefix="$"
          optional
          placeholder="off"
          value={s.stopWin}
          onChange={(v) => set("stopWin", v)}
          error={errors.stopWin}
          help="Ends the session when bankroll ≥ this."
          disabled={disabled}
        />
        <NumberField
          label="Stop-loss floor"
          prefix="$"
          optional
          placeholder="off"
          value={s.stopLoss}
          onChange={(v) => set("stopLoss", v)}
          error={errors.stopLoss}
          help="Ends the session when bankroll ≤ this floor."
          disabled={disabled}
        />
      </div>
      <div className="row">
        <NumberField label="Max rounds per session" value={s.maxRounds} onChange={(v) => v !== null && set("maxRounds", v)} error={errors.maxRounds} disabled={disabled} />
        <div className="field">
          <label>
            If a bet exceeds the bankroll
            <select value={s.insufficientFunds} disabled={disabled} onChange={(ev) => set("insufficientFunds", ev.target.value === "allIn" ? "allIn" : "stop")}>
              <option value="stop">End the session</option>
              <option value="allIn">Bet everything left</option>
            </select>
          </label>
        </div>
      </div>

      <h2>Simulation</h2>
      <div className="row">
        <NumberField label="Sessions" value={s.sessions} onChange={(v) => v !== null && set("sessions", v)} error={errors.sessions} disabled={disabled} />
        <div className="seed">
          <NumberField label="Seed" value={s.seed} onChange={(v) => v !== null && set("seed", v)} error={errors.seed} help={`0 to ${MAX_SEED}`} disabled={disabled} />
          <button type="button" disabled={disabled} onClick={() => set("seed", randomSeed())}>
            Randomize
          </button>
        </div>
      </div>
    </section>
  );
}
