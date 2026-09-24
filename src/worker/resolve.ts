// Turns the plain-data strategy references of a SimRequest into runnable specs. Runs INSIDE the
// worker: built-ins come from the registry, custom rules are validated and compiled here, so
// functions never cross the worker boundary. No DOM or Comlink here, so it is testable in Node.
import type { StrategySpec } from "../engine/montecarlo";
import { compileRule } from "../engine/rules/compile";
import { getStrategy } from "../engine/strategies/registry";
import type { StrategyConfig } from "../engine/strategies/types";

/** A strategy as it crosses the worker boundary: a registry id + config, or a custom rule (JSON data). */
export type StrategyRef = { kind: "builtin"; strategyId: string; config: StrategyConfig } | { kind: "custom"; rule: unknown };

/** Throws a readable Error for an unknown id or an invalid rule (the run then fails with that message). */
export function resolveStrategies(refs: readonly StrategyRef[]): StrategySpec[] {
  return refs.map((ref, i) => {
    if (ref.kind === "custom") {
      try {
        return { strategy: compileRule(ref.rule), config: {} };
      } catch (err) {
        throw new Error(`Strategy ${i + 1}: ${(err as Error).message}`);
      }
    }
    const strategy = getStrategy(ref.strategyId);
    if (!strategy) throw new Error(`Unknown strategy "${ref.strategyId}"`);
    return { strategy, config: ref.config };
  });
}
