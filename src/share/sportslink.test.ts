import { describe, expect, it } from "vitest";
import { convertOdds, type SportsInput } from "../engine/odds";
import { defaultScenario, defaultSportsInput, migrateScenario, newStrategyInstance, SCENARIO_VERSION, sportsScenarioGame, validateScenario, type ScenarioConfig } from "../scenario";
import { base64urlToBytes } from "./base64url";
import { decodeScenarioLink, encodeScenarioLink } from "./link";
import { FRAGMENT_PREFIX } from "./limits";
import { fragmentOf } from "./testLinks";

const BASE = "https://strategylab.example.app/";
const content = (s: ScenarioConfig) => ({ ...s, strategies: s.strategies.map(({ uid: _uid, ...rest }) => rest) });
const withoutVersion = (s: ScenarioConfig) => {
  const { version: _v, ...rest } = content(s);
  return rest;
};

function sports(input: Partial<SportsInput>): ScenarioConfig {
  return { ...defaultScenario(), game: sportsScenarioGame({ ...defaultSportsInput(), ...input }), strategies: [newStrategyInstance("flat"), newStrategyInstance("martingale")] };
}

describe("v3 sports scenarios round-trip exactly through a link", () => {
  const cases: [string, Partial<SportsInput>][] = [
    ["market, American -110 / -110, side A", {}],
    ["market, American +150 / -180, side B", { sideA: 150, sideB: -180, side: "b" }],
    ["market, decimal 1.91 / 1.95, side B", { format: "decimal", sideA: 1.91, sideB: 1.95, side: "b" }],
    ["market, EXACT converted decimals from -110 / +150", { format: "decimal", sideA: convertOdds(-110, "american", "decimal"), sideB: convertOdds(150, "american", "decimal") }],
    ["negative overround +110 / +110 (accepted, flagged)", { sideA: 110, sideB: 110 }],
    ["my estimate 0.55 at -110 (side B kept, ignored)", { mode: "estimate", estimate: 0.55, sideB: -250 }],
    ["my estimate, decimal 2.5, estimate 0.123456789", { mode: "estimate", format: "decimal", sideA: 2.5, estimate: 0.123456789 }],
  ];
  for (const [name, input] of cases) {
    it(name, () => {
      const s = sports(input);
      expect(validateScenario(s)).toEqual({});
      const enc = encodeScenarioLink(s, BASE);
      if (!enc.ok) throw new Error(enc.message);
      const dec = decodeScenarioLink(enc.fragment);
      if (dec.kind !== "loaded") throw new Error(JSON.stringify(dec));
      expect(dec.fromVersion).toBe(SCENARIO_VERSION);
      expect(dec.dropped).toEqual([]);
      expect(migrateScenario(dec.scenario)).toBe(dec.scenario);
      expect(content(dec.scenario)).toEqual(content(s)); // inputs AND the derived winProb / netPayout, bit for bit
    });
  }

  it("the link carries only the inputs; the derived numbers are recomputed", () => {
    const enc = encodeScenarioLink(sports({}), BASE);
    if (!enc.ok) throw new Error(enc.message);
    const bytes = base64urlToBytes(enc.fragment.slice(FRAGMENT_PREFIX.length));
    if (!bytes.ok) throw new Error(bytes.error);
    expect((JSON.parse(new TextDecoder().decode(bytes.bytes)) as { g: unknown }).g).toEqual(["o", "m", "a", -110, -110, "a", 0.5]);
  });
});

// Links produced by the SESSION 7 app (recorded in CLAUDE.md), with what the session 7 decoder
// returned for them (captured by running commit 76a284f in a temporary worktree). The only allowed
// difference now is the scenario version (3), since they migrate forward.
const GOLDEN = {
  rule: {
    hash: "#s=eyJ2IjoyLCJnIjoiZXVyb3BlYW4iLCJiIjoxMDAwLCJiYiI6MTAsInRuIjoxLCJzdyI6MTEwMCwiciI6MTAwMCwibiI6MTAwMDAsInNkIjoxMjM0NSwic3QiOltbIm1hcnRpbmdhbGUiXSxbInAiLCJEb3VibGUgYWZ0ZXIgMiBsb3NzZXMiLDEsW1tbInIiXV1dLFtbWyJscyIsMl0sWyJtIiwyXV0sW1siYSIsMF1dXV1dfQ",
    session7: '{"fromVersion":2,"scenario":{"game":{"presetId":"european","winProb":0.4864864864864865,"netPayout":1},"startBankroll":1000,"baseBet":10,"tableMin":1,"tableMax":null,"stopWin":1100,"stopLoss":null,"maxRounds":1000,"insufficientFunds":"stop","sessions":10000,"seed":12345,"strategies":[{"kind":"builtin","strategyId":"martingale","config":{"multiplier":2}},{"kind":"custom","rule":{"kind":"progression","name":"Double after 2 losses","startUnits":1,"onWin":[{"then":{"type":"reset"}}],"onLoss":[{"when":{"type":"lossStreak","atLeast":2},"then":{"type":"multiply","by":2}},{"then":{"type":"add","units":0}}]}}]},"dropped":[]}',
  },
  partial: {
    hash: "#s=eyJ2IjoyLCJnIjoiZXVyb3BlYW4iLCJiIjoxMDAwLCJiYiI6MTAsInRuIjoxLCJzdyI6OTAwLCJyIjoxMDAwLCJuIjoxMDAwMCwic2QiOjEyMzQ1LCJzdCI6W1siZmxhdCJdLFsiZG91YmxlVXBTeXN0ZW0iXSxbImtlbGx5Iix7ImFzc3VtZWRXaW5Qcm9iIjo1fV1dfQ",
    session7: '{"fromVersion":2,"scenario":{"game":{"presetId":"european","winProb":0.4864864864864865,"netPayout":1},"startBankroll":1000,"baseBet":10,"tableMin":1,"tableMax":null,"stopWin":null,"stopLoss":null,"maxRounds":1000,"insufficientFunds":"stop","sessions":10000,"seed":12345,"strategies":[{"kind":"builtin","strategyId":"flat","config":{"units":1}},{"kind":"builtin","strategyId":"kelly","config":{"fraction":1}}]},"dropped":[{"field":"Strategy 2","message":"unknown strategy \\"doubleUpSystem\\"; left out"},{"field":"Win target","message":"Must be above the starting bankroll (or blank for off). The link had 900; using off."},{"field":"Strategy 2 (Kelly): Assumed win probability","message":"Must be at most 0.99 (or blank). The link had 5; using the default."}]}',
  },
  v1: {
    hash: "#s=eyJ2IjoxLCJnIjoiZXVyb3BlYW4iLCJiIjoxMDAwLCJiYiI6MTAsInRuIjoxLCJzdyI6MTEwMCwiciI6MTAwMCwibiI6MTAwMDAsInNkIjoxMjM0NSwic3QiOltbImZsYXQiXSxbImtlbGx5Iix7ImFzc3VtZWRXaW5Qcm9iIjowLCJmcmFjdGlvbiI6MC41fV1dfQ",
    session7: '{"fromVersion":1,"scenario":{"game":{"presetId":"european","winProb":0.4864864864864865,"netPayout":1},"startBankroll":1000,"baseBet":10,"tableMin":1,"tableMax":null,"stopWin":1100,"stopLoss":null,"maxRounds":1000,"insufficientFunds":"stop","sessions":10000,"seed":12345,"strategies":[{"kind":"builtin","strategyId":"flat","config":{"units":1}},{"kind":"builtin","strategyId":"kelly","config":{"fraction":0.5}}]},"dropped":[]}',
  },
};

describe("v1 and v2 links load exactly as they did in session 7", () => {
  for (const [name, g] of Object.entries(GOLDEN)) {
    it(`${name} link`, () => {
      const r = decodeScenarioLink(g.hash);
      if (r.kind !== "loaded") throw new Error(JSON.stringify(r));
      expect(r.scenario.version).toBe(3); // migrated forward
      expect({ fromVersion: r.fromVersion, scenario: withoutVersion(r.scenario), dropped: r.dropped }).toEqual(JSON.parse(g.session7));
      expect(r.scenario.game.sports).toBeUndefined();
    });
  }
});

describe("sports games in links: rejected where they can't be, reported when invalid", () => {
  const base = { g: "european", b: 1000, bb: 10, tn: 1, r: 1000, n: 10000, sd: 12345, st: [["flat"]] };

  it("a sports game in a version 2 (or 1) link did not exist then: default game, reported", () => {
    for (const v of [1, 2]) {
      const r = decodeScenarioLink(fragmentOf({ ...base, v, g: ["o", "m", "a", -110, -110, "a", 0.5] }));
      expect(r.kind === "loaded" && r.scenario.game.presetId).toBe("european");
      expect(r.kind === "loaded" && r.dropped).toEqual([{ field: "Game", message: "sports odds need a version 3 link; using the default" }]);
    }
  });

  it("invalid odds in a v3 link: default game, with the odds errors", () => {
    const r = decodeScenarioLink(fragmentOf({ ...base, v: 3, g: ["o", "m", "a", -50, 0, "a", 0.5] }));
    expect(r.kind === "loaded" && r.scenario.game.presetId).toBe("european");
    expect(r.kind === "loaded" && r.dropped).toEqual([
      { field: "Game", message: "American odds must be +100 or higher, or -100 or lower (got -50). American odds must be +100 or higher, or -100 or lower (got 0). Using the default game." },
    ]);
  });

  it("malformed sports arrays are reported, never thrown", () => {
    for (const g of [["o"], ["o", "x", "a", -110, -110, "a", 0.5], ["o", "m", "a", "-110", -110, "a", 0.5], ["o", "m", "a", -110, -110, "c", 0.5], ["o", "e", "d", 1.9, 1.9, "a", null], ["o", "m", "a", -110, -110, "a", 0.5, "extra"]]) {
      const r = decodeScenarioLink(fragmentOf({ ...base, v: 3, g }));
      expect(r.kind).toBe("loaded");
      if (r.kind === "loaded") {
        expect(r.scenario.game.presetId).toBe("european");
        expect(r.dropped).toHaveLength(1);
        expect(r.dropped[0]!.field).toBe("Game");
      }
    }
  });
});
