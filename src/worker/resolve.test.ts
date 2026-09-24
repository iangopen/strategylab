import { describe, expect, it } from "vitest";
import { CUSTOM_STRATEGY_ID } from "../engine/rules/compile";
import { PAROLI_RULE } from "../engine/rules/examples";
import { martingale } from "../engine/strategies/martingale";
import { resolveStrategies } from "./resolve";

describe("resolveStrategies (runs in the worker)", () => {
  it("built-ins come from the registry; custom rules are compiled from data", () => {
    const specs = resolveStrategies([
      { kind: "builtin", strategyId: "martingale", config: { multiplier: 2 } },
      { kind: "custom", rule: PAROLI_RULE },
    ]);
    expect(specs[0]!.strategy).toBe(martingale);
    expect(specs[0]!.config).toEqual({ multiplier: 2 });
    expect(specs[1]!.strategy.id).toBe(CUSTOM_STRATEGY_ID);
    expect(specs[1]!.strategy.label).toBe(PAROLI_RULE.name);
    expect(specs[1]!.config).toEqual({});
  });

  it("an invalid rule or unknown id fails the request with a readable error", () => {
    expect(() => resolveStrategies([{ kind: "builtin", strategyId: "nope", config: {} }])).toThrow('Unknown strategy "nope"');
    expect(() => resolveStrategies([{ kind: "builtin", strategyId: "flat", config: {} }, { kind: "custom", rule: { kind: "progression", code: "x" } }])).toThrow(
      /^Strategy 2: Invalid custom rule: unknown key "code"/,
    );
  });
});
