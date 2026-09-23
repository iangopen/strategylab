import type { AnyStrategy, StrategyConfig } from "./types";

/** Checks a config against the strategy's configSchema. Returns problems keyed by field. */
export function validateStrategyConfig(strategy: AnyStrategy, config: StrategyConfig): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const f of strategy.configSchema) {
    const v = config[f.key];
    switch (f.kind) {
      case "number":
      case "integer":
        if (typeof v !== "number" || !Number.isFinite(v)) errors[f.key] = "Enter a number.";
        else if (f.kind === "integer" && !Number.isInteger(v)) errors[f.key] = "Enter a whole number.";
        else if (f.min !== undefined && v < f.min) errors[f.key] = `Must be at least ${f.min}.`;
        else if (f.max !== undefined && v > f.max) errors[f.key] = `Must be at most ${f.max}.`;
        break;
      case "boolean":
        if (typeof v !== "boolean") errors[f.key] = "Must be true or false.";
        break;
      case "select":
        if (typeof v !== "string" || !(f.options ?? []).some((o) => o.value === v)) errors[f.key] = "Pick an option.";
        break;
    }
  }
  return errors;
}
