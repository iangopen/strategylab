import { useState } from "react";
import { EXAMPLE_RULES } from "../engine/rules/examples";
import { getStrategy, STRATEGIES } from "../engine/strategies/registry";
import type { StrategyConfig } from "../engine/strategies/types";
import { MAX_STRATEGIES, newCustomInstance, newStrategyInstance, type StrategyInstance } from "../scenario";
import { seriesColorVar } from "./charts/adapters";
import { instanceLabel } from "./format";
import type { PreviewContext } from "./rules/preview";
import { RuleBuilder } from "./rules/RuleBuilder";
import { SchemaForm } from "./SchemaForm";

interface Props {
  instances: StrategyInstance[];
  onChange: (instances: StrategyInstance[]) => void;
  errors: Record<string, string>;
  disabled?: boolean;
  /** For custom rules' live preview. */
  previewContext: PreviewContext;
  /** False on a multi-outcome game (binaryOnly fields are disabled). */
  binaryGame?: boolean;
}

/** "Add" dropdown values: a registry id, or "rule:<example id>" for a custom rule. */
const RULE_PREFIX = "rule:";

export function StrategyPicker({ instances, onChange, errors, disabled, previewContext, binaryGame = true }: Props) {
  // Which entry the "Add" dropdown points at. Not scenario state.
  const [toAdd, setToAdd] = useState(STRATEGIES[0]!.id);

  const replace = (uid: string, next: (i: StrategyInstance) => StrategyInstance) => onChange(instances.map((i) => (i.uid === uid ? next(i) : i)));
  const setConfig = (uid: string, config: StrategyConfig) => replace(uid, (i) => (i.kind === "builtin" ? { ...i, config } : i));
  const setRule = (uid: string, rule: unknown) => replace(uid, (i) => (i.kind === "custom" ? { ...i, rule } : i));

  const full = instances.length >= MAX_STRATEGIES;

  function add() {
    const example = toAdd.startsWith(RULE_PREFIX) ? EXAMPLE_RULES.find((e) => `${RULE_PREFIX}${e.id}` === toAdd) : undefined;
    onChange([...instances, example ? newCustomInstance(example.rule) : newStrategyInstance(toAdd)]);
  }

  return (
    <section className="panel">
      <h2>Strategies to compare</h2>
      <p className="help">Every strategy plays the same simulated outcomes, session by session.</p>
      <div className="add-strategy">
        <select value={toAdd} disabled={disabled} onChange={(e) => setToAdd(e.target.value)} aria-label="Strategy to add">
          <optgroup label="Built-in strategies">
            {STRATEGIES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </optgroup>
          <optgroup label="Custom rule (start from…)">
            {EXAMPLE_RULES.map((e) => (
              <option key={e.id} value={`${RULE_PREFIX}${e.id}`}>
                {e.label}
              </option>
            ))}
          </optgroup>
        </select>
        <button type="button" disabled={disabled || full} onClick={add} title={full ? `At most ${MAX_STRATEGIES} strategies (one per chart color).` : undefined}>
          Add
        </button>
      </div>
      {full && <p className="help">At most {MAX_STRATEGIES} strategies (one per chart color). Remove one to add another.</p>}
      {errors.strategies && <div className="error">{errors.strategies}</div>}

      {instances.map((inst, index) => {
        const prefix = `strategy:${inst.uid}:`;
        const fieldErrors = Object.fromEntries(
          Object.entries(errors)
            .filter(([k]) => k.startsWith(prefix))
            .map(([k, v]) => [k.slice(prefix.length), v]),
        );
        const strategy = inst.kind === "builtin" ? getStrategy(inst.strategyId) : undefined;
        return (
          <div className="strategy-card" key={inst.uid}>
            <div className="strategy-head">
              <strong>
                <span className="swatch" style={{ background: `var(${seriesColorVar(index)})` }} aria-hidden="true" />
                {instanceLabel(instances, index)}
              </strong>
              <button type="button" className="link" disabled={disabled} onClick={() => onChange(instances.filter((i) => i.uid !== inst.uid))}>
                Remove
              </button>
            </div>
            {inst.kind === "custom" ? (
              <>
                <p className="help">Custom rule. Bet = base bet × units. Like every strategy, it cannot change the expected result per dollar wagered; it only changes how results spread out.</p>
                <RuleBuilder rule={inst.rule} onChange={(rule) => setRule(inst.uid, rule)} disabled={disabled ?? false} previewContext={previewContext} />
              </>
            ) : strategy ? (
              <>
                <p className="help">{strategy.description}</p>
                <SchemaForm schema={strategy.configSchema} config={inst.config} errors={fieldErrors} disabled={disabled} binaryGame={binaryGame} onChange={(config) => setConfig(inst.uid, config)} />
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
