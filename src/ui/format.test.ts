import { describe, expect, it } from "vitest";
import { MARTINGALE_RULE, PAROLI_RULE } from "../engine/rules/examples";
import { newCustomInstance, newStrategyInstance } from "../scenario";
import { CUSTOM_RULE_FALLBACK_LABEL, formatElapsed, instanceLabel } from "./format";

describe("instanceLabel", () => {
  it("built-ins use the registry label; custom rules use their name; shared labels are numbered", () => {
    const list = [newStrategyInstance("flat"), newCustomInstance(MARTINGALE_RULE), newStrategyInstance("flat"), newCustomInstance(MARTINGALE_RULE), newCustomInstance(PAROLI_RULE)];
    expect(list.map((_, i) => instanceLabel(list, i))).toEqual(["Flat #1", `${MARTINGALE_RULE.name} #1`, "Flat #2", `${MARTINGALE_RULE.name} #2`, PAROLI_RULE.name]);
  });

  it("a rule without a usable name falls back to a generic label", () => {
    const list = [newCustomInstance({ kind: "progression", name: "  " }), newCustomInstance(["not", "a", "rule"])];
    expect(list.map((_, i) => instanceLabel(list, i))).toEqual([`${CUSTOM_RULE_FALLBACK_LABEL} #1`, `${CUSTOM_RULE_FALLBACK_LABEL} #2`]);
  });
});

describe("formatElapsed", () => {
  it("under 0.1 s shows <0.1s, never 0.0s; otherwise one decimal", () => {
    expect([0, 1, 49, 99.9].map(formatElapsed)).toEqual(["<0.1s", "<0.1s", "<0.1s", "<0.1s"]);
    expect([100, 149, 1234, 20_400].map(formatElapsed)).toEqual(["0.1s", "0.1s", "1.2s", "20.4s"]);
  });
});
