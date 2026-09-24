import { describe, expect, it } from "vitest";
import { MARTINGALE_RULE } from "../engine/rules/examples";
import { defaultScenario, MAX_STRATEGIES, newCustomInstance, newStrategyInstance, type ScenarioConfig } from "../scenario";
import { copyBlocker, decodeScenarioLink, encodeScenarioLink } from "./link";

const BASE = "https://strategylab.example.app/";

describe("save path: what Copy link encodes, and when it is blocked", () => {
  it("copies the whole scenario when everything is valid", () => {
    expect(copyBlocker(defaultScenario())).toBeNull();
    const enc = encodeScenarioLink(defaultScenario(), BASE);
    expect(enc.ok && enc.leftOut).toEqual([]);
  });

  it("a blocked custom rule (and a built-in with an invalid setting) is left out, and reported by index", () => {
    const s: ScenarioConfig = {
      ...defaultScenario(),
      strategies: [
        newStrategyInstance("flat"),
        newCustomInstance({ ...MARTINGALE_RULE, onLoss: [{ then: { type: "multiply", by: 50 } }] }),
        { ...newStrategyInstance("martingale"), config: { multiplier: 99 } },
        newCustomInstance(MARTINGALE_RULE),
      ],
    };
    expect(copyBlocker(s)).toBeNull();
    const enc = encodeScenarioLink(s, BASE);
    if (!enc.ok) throw new Error(enc.message);
    expect(enc.leftOut).toEqual([1, 2]);
    const dec = decodeScenarioLink(enc.fragment);
    expect(dec.kind === "loaded" && dec.scenario.strategies.map((x) => x.kind)).toEqual(["builtin", "custom"]);
    expect(dec.kind === "loaded" && dec.dropped).toEqual([]); // the link itself is clean
  });

  it("blocked, with a reason, when a scenario field is invalid", () => {
    const s = { ...defaultScenario(), startBankroll: -1 };
    expect(copyBlocker(s)).toBe("Fix the highlighted settings before copying a link.");
    expect(encodeScenarioLink(s, BASE)).toEqual({ ok: false, reason: "blocked", message: "Fix the highlighted settings before copying a link." });
  });

  it("blocked when there are no strategies, none valid, or too many", () => {
    expect(copyBlocker({ ...defaultScenario(), strategies: [] })).toBe("Add at least one strategy before copying a link.");
    expect(copyBlocker({ ...defaultScenario(), strategies: [newCustomInstance({ kind: "nope" })] })).toBe("No strategy is valid yet: fix the highlighted strategy settings first.");
    expect(copyBlocker({ ...defaultScenario(), strategies: Array.from({ length: MAX_STRATEGIES + 1 }, () => newStrategyInstance("flat")) })).toBe(`At most ${MAX_STRATEGIES} strategies.`);
  });
});
