import type { FieldSpec, StrategyConfig } from "../engine/strategies/types";
import { NumberField } from "./NumberField";

interface Props {
  schema: readonly FieldSpec[];
  config: StrategyConfig;
  onChange: (config: StrategyConfig) => void;
  /** Errors keyed by field key. */
  errors: Record<string, string>;
  disabled?: boolean;
}

function rangeHelp(f: FieldSpec): string | undefined {
  const range = f.min !== undefined && f.max !== undefined ? `${f.min} to ${f.max}` : undefined;
  return [f.help, range && `Range: ${range}.`].filter(Boolean).join(" ") || undefined;
}

/** Renders ANY strategy's configSchema. Adding a strategy never requires editing this file. */
export function SchemaForm({ schema, config, onChange, errors, disabled }: Props) {
  const set = (key: string, value: number | boolean | string) => onChange({ ...config, [key]: value });

  return (
    <div className="schema-form">
      {schema.map((f) => {
        const value = config[f.key];
        switch (f.kind) {
          case "number":
          case "integer":
            return (
              <NumberField
                key={f.key}
                label={f.label}
                value={typeof value === "number" ? value : null}
                onChange={(v) => v !== null && set(f.key, v)}
                error={errors[f.key]}
                help={rangeHelp(f)}
                disabled={disabled ?? false}
              />
            );
          case "boolean":
            return (
              <div className="field" key={f.key}>
                <label className="checkbox">
                  <input type="checkbox" checked={value === true} disabled={disabled} onChange={(e) => set(f.key, e.target.checked)} />
                  {f.label}
                </label>
                {errors[f.key] ? <div className="error">{errors[f.key]}</div> : f.help && <div className="help">{f.help}</div>}
              </div>
            );
          case "select":
            return (
              <div className="field" key={f.key}>
                <label>
                  {f.label}
                  <select value={String(value ?? "")} disabled={disabled} onChange={(e) => set(f.key, e.target.value)}>
                    {(f.options ?? []).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                {errors[f.key] ? <div className="error">{errors[f.key]}</div> : f.help && <div className="help">{f.help}</div>}
              </div>
            );
        }
      })}
    </div>
  );
}
