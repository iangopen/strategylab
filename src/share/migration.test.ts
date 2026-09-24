import { describe, expect, it } from "vitest";
import { MARTINGALE_RULE } from "../engine/rules/examples";
import { SCENARIO_VERSION, validateScenario } from "../scenario";
import { compactRule } from "./compact";
import { decodeScenarioLink } from "./link";
import { fragmentOf } from "./testLinks";

// A version-1 link, as the v1 app would have written it (built-ins only; Kelly's "use the true
// probability" was the sentinel 0 then).
const v1 = {
  v: 1,
  g: "european",
  b: 1000,
  bb: 10,
  tn: 1,
  sw: 1100,
  r: 1000,
  n: 10000,
  sd: 12345,
  st: [["flat"], ["kelly", { assumedWinProb: 0, fraction: 0.5 }], ["kelly", { assumedWinProb: 0.6 }]],
};

describe("version 1 links load through the existing migrateScenario (verification 5)", () => {
  it("Kelly's old 0 loads as blank, a real value is kept, and nothing is reported as dropped", () => {
    const r = decodeScenarioLink(fragmentOf(v1));
    if (r.kind !== "loaded") throw new Error(JSON.stringify(r));
    expect(r.fromVersion).toBe(1);
    expect(r.scenario.version).toBe(SCENARIO_VERSION);
    expect(r.scenario.strategies.map((s) => (s.kind === "builtin" ? [s.strategyId, s.config] : null))).toEqual([
      ["flat", { units: 1 }],
      ["kelly", { fraction: 0.5 }],
      ["kelly", { assumedWinProb: 0.6, fraction: 1 }],
    ]);
    // Empty: the 0 was MIGRATED (not rejected by validation and reset, which would be reported).
    expect(r.dropped).toEqual([]);
    expect(validateScenario(r.scenario)).toEqual({});
  });

  it("the same 0 in a CURRENT-version link is invalid (and reported), proving the difference is the migration", () => {
    const r = decodeScenarioLink(fragmentOf({ ...v1, v: SCENARIO_VERSION }));
    expect(r.kind === "loaded" && r.dropped.map((d) => d.field)).toEqual(["Strategy 2 (Kelly): Assumed win probability"]);
  });

  it("a version 1 link cannot carry custom rules (they did not exist): they are left out and reported", () => {
    const r = decodeScenarioLink(fragmentOf({ ...v1, st: [["flat"], compactRule(MARTINGALE_RULE)] }));
    expect(r.kind === "loaded" && r.scenario.strategies).toHaveLength(1);
    expect(r.kind === "loaded" && r.dropped).toEqual([{ field: "Strategy 2 (Double after a loss)", message: "custom rules need a version 2 link; left out" }]);
  });

  it("versions 0, negative, fractional and non-numeric are errors", () => {
    for (const v of [0, -1, 1.5, "1", null]) expect(decodeScenarioLink(fragmentOf({ ...v1, v })).kind).toBe("error");
  });
});
