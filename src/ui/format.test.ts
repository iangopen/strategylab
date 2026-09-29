import { describe, expect, it } from "vitest";
import { MARTINGALE_RULE, PAROLI_RULE } from "../engine/rules/examples";
import { newCustomInstance, newStrategyInstance } from "../scenario";
import { CUSTOM_RULE_FALLBACK_LABEL, formatElapsed, instanceLabel, replayAnnouncement, runAnnouncement } from "./format";

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

describe("announcements (screen-reader text)", () => {
  it("a finished run reads EV per $ with the theory, and P(profit), per strategy; an undefined EV is said in words", () => {
    const cols = [
      { label: "Flat", stats: { evPerWagered: -0.02758, evTheory: -0.027027, pProfit: 0.5376 } },
      { label: "Kelly", stats: { evPerWagered: NaN, evTheory: -0.027027, pProfit: 0 } },
    ];
    expect(runAnnouncement(cols)).toBe(
      "Results ready. EV per $ wagered: Flat -2.758%, Kelly not defined (no bets placed); theory -2.703%. P(profit > 0): Flat 53.760%, Kelly 0.000%. The full table follows.",
    );
  });

  it("a replay reads the legend lines", () => {
    expect(replayAnnouncement(1234, ["Flat: a", "Martingale: b"])).toBe("Replay of session 1,234: Flat: a; Martingale: b.");
  });
});
