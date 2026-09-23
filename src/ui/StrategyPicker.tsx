import { useState } from "react";
import { getStrategy, STRATEGIES } from "../engine/strategies/registry";
import { newStrategyInstance, type StrategyInstance } from "../scenario";
import { instanceLabel } from "./format";
import { SchemaForm } from "./SchemaForm";

interface Props {
  instances: StrategyInstance[];
  onChange: (instances: StrategyInstance[]) => void;
  errors: Record<string, string>;
  disabled?: boolean;
}

export function StrategyPicker({ instances, onChange, errors, disabled }: Props) {
  // Which registry entry the "Add" dropdown points at. Not scenario state.
  const [toAdd, setToAdd] = useState(STRATEGIES[0]!.id);

  const update = (uid: string, patch: Partial<StrategyInstance>) =>
    onChange(instances.map((i) => (i.uid === uid ? { ...i, ...patch } : i)));

  return (
    <section className="panel">
      <h2>Strategies to compare</h2>
      <p className="help">Every strategy plays the same simulated outcomes, session by session.</p>
      <div className="add-strategy">
        <select value={toAdd} disabled={disabled} onChange={(e) => setToAdd(e.target.value)} aria-label="Strategy to add">
          {STRATEGIES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <button type="button" disabled={disabled} onClick={() => onChange([...instances, newStrategyInstance(toAdd)])}>
          Add
        </button>
      </div>
      {errors.strategies && <div className="error">{errors.strategies}</div>}

      {instances.map((inst, index) => {
        const strategy = getStrategy(inst.strategyId);
        const prefix = `strategy:${inst.uid}:`;
        const fieldErrors = Object.fromEntries(
          Object.entries(errors)
            .filter(([k]) => k.startsWith(prefix))
            .map(([k, v]) => [k.slice(prefix.length), v]),
        );
        return (
          <div className="strategy-card" key={inst.uid}>
            <div className="strategy-head">
              <strong>{instanceLabel(instances, index)}</strong>
              <button type="button" className="link" disabled={disabled} onClick={() => onChange(instances.filter((i) => i.uid !== inst.uid))}>
                Remove
              </button>
            </div>
            {strategy ? (
              <>
                <p className="help">{strategy.description}</p>
                <SchemaForm schema={strategy.configSchema} config={inst.config} errors={fieldErrors} disabled={disabled} onChange={(config) => update(inst.uid, { config })} />
              </>
            ) : (
              <div className="error">{errors[`strategy:${inst.uid}`]}</div>
            )}
          </div>
        );
      })}
    </section>
  );
}
