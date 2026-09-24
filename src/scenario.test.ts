import { describe, expect, it } from "vitest";
import { validateSessionConfig } from "./engine/types";
import { MARTINGALE_RULE } from "./engine/rules/examples";
import {
  defaultScenario,
  defaultSportsInput,
  migrateScenario,
  newCustomInstance,
  newStrategyInstance,
  SPORTS_GAME_ID,
  sportsScenarioGame,
  toSimRequest,
  validateScenario,
  type ScenarioConfig,
  type ScenarioConfigV1,
  type ScenarioConfigV2,
} from "./scenario";

const withChanges = (c: Partial<ScenarioConfig>): ScenarioConfig => ({ ...defaultScenario(), ...c });

describe("ScenarioConfig", () => {
  it("default scenario: $1,000, $10 base, win target $1,100, no floor, 1,000 rounds, European, Flat + Martingale x2", () => {
    const s = defaultScenario();
    expect([s.startBankroll, s.baseBet, s.stopWin, s.stopLoss, s.maxRounds, s.game.presetId]).toEqual([1000, 10, 1100, null, 1000, "european"]);
    expect(s.strategies.map((i) => (i.kind === "builtin" ? [i.strategyId, i.config] : i))).toEqual([
      ["flat", { units: 1 }],
      ["martingale", { multiplier: 2 }],
    ]);
  });

  it("default scenario is valid, plain JSON, and survives a JSON round trip", () => {
    const s = defaultScenario();
    expect(validateScenario(s)).toEqual({});
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });

  it("converts dollars to integer cents that the engine accepts", () => {
    const s = withChanges({ startBankroll: 123.45, baseBet: 0.1, tableMin: 0.1, tableMax: 50, stopWin: 200, stopLoss: 20.5 });
    const req = toSimRequest(s);
    expect(req.session).toMatchObject({ startBankroll: 12345, baseBet: 10, tableMin: 10, tableMax: 5000, stopWin: 20000, stopLoss: 2050 });
    expect(validateSessionConfig(req.session)).toEqual([]);
  });

  it("flags invalid fields by key", () => {
    const s = withChanges({ stopWin: 1000, stopLoss: 1000, tableMax: 0.5, maxRounds: 0, sessions: 1.5, seed: -1 });
    expect(Object.keys(validateScenario(s)).sort()).toEqual(["maxRounds", "seed", "sessions", "stopLoss", "stopWin", "tableMax"]);
    expect(validateScenario(withChanges({ game: { presetId: "custom", winProb: 1, netPayout: 1 } })).game).toBeDefined();
    expect(validateScenario(withChanges({ strategies: [] })).strategies).toBeDefined();
  });

  it("stopWin/stopLoss boundaries: target must exceed start, floor must be below start", () => {
    expect(validateScenario(withChanges({ stopWin: 1000.01 })).stopWin).toBeUndefined();
    expect(validateScenario(withChanges({ stopWin: 1000 })).stopWin).toBeDefined();
    expect(validateScenario(withChanges({ stopLoss: 999.99 })).stopLoss).toBeUndefined();
    expect(validateScenario(withChanges({ stopLoss: 0 })).stopLoss).toBeUndefined();
    expect(validateScenario(withChanges({ stopLoss: 1000 })).stopLoss).toBeDefined();
  });

  it("the same strategy can be added twice with independent configs", () => {
    const a = newStrategyInstance("flat");
    const b = { ...newStrategyInstance("flat"), config: { units: -1 } };
    expect(a.uid).not.toBe(b.uid);
    const errors = validateScenario(withChanges({ strategies: [a, b] }));
    expect(Object.keys(errors)).toEqual([`strategy:${b.uid}:units`]);
  });

  it("a custom rule is stored as plain JSON data, validated by the rule validator, and sent to the worker as data", () => {
    const custom = newCustomInstance(MARTINGALE_RULE);
    expect(custom.rule).toEqual(MARTINGALE_RULE);
    expect(Object.isFrozen(custom.rule)).toBe(false); // an editable copy
    const s = withChanges({ strategies: [newStrategyInstance("flat"), custom] });
    expect(validateScenario(s)).toEqual({});
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
    expect(toSimRequest(s).strategies).toEqual([
      { kind: "builtin", strategyId: "flat", config: { units: 1 } },
      { kind: "custom", rule: MARTINGALE_RULE },
    ]);
  });

  it("an invalid custom rule is flagged under strategy:<uid>:rule with the validator's messages", () => {
    const bad = newCustomInstance({ ...MARTINGALE_RULE, onLoss: [{ then: { type: "multiply", by: 50 } }], extra: 1 });
    const errors = validateScenario(withChanges({ strategies: [bad] }));
    expect(Object.keys(errors)).toEqual([`strategy:${bad.uid}:rule`]);
    expect(errors[`strategy:${bad.uid}:rule`]).toMatch(/unknown key "extra"/);
  });

  it("migrates a version 1 scenario: instances become kind builtin, nothing else changes", () => {
    const current = defaultScenario();
    const v1: ScenarioConfigV1 = {
      ...current,
      version: 1,
      strategies: [
        { uid: "a", strategyId: "flat", config: { units: 2 } },
        { uid: "b", strategyId: "martingale", config: { multiplier: 3 } },
      ],
    };
    const m = migrateScenario(v1);
    expect(m.version).toBe(3); // v1 -> v2 -> v3 (session 8 bumped the version)
    expect(m.strategies).toEqual([
      { uid: "a", kind: "builtin", strategyId: "flat", config: { units: 2 } },
      { uid: "b", kind: "builtin", strategyId: "martingale", config: { multiplier: 3 } },
    ]);
    expect({ ...m, strategies: [] }).toEqual({ ...current, strategies: [] });
    expect(validateScenario(m)).toEqual({});
    expect(migrateScenario(current)).toBe(current); // already current
  });

  it("migrates Kelly's old 0 sentinel to blank (key removed); a real value is kept", () => {
    const v1: ScenarioConfigV1 = {
      ...defaultScenario(),
      version: 1,
      strategies: [
        { uid: "k0", strategyId: "kelly", config: { assumedWinProb: 0, fraction: 0.5 } },
        { uid: "k6", strategyId: "kelly", config: { assumedWinProb: 0.6, fraction: 1 } },
        { uid: "f", strategyId: "flat", config: { units: 1 } },
      ],
    };
    const m = migrateScenario(v1);
    expect(m.strategies.map((i) => (i.kind === "builtin" ? i.config : null))).toEqual([{ fraction: 0.5 }, { assumedWinProb: 0.6, fraction: 1 }, { units: 1 }]);
    expect("assumedWinProb" in (m.strategies[0] as { config: object }).config).toBe(false);
    expect(validateScenario(m)).toEqual({});
    // Unmigrated, the old 0 is out of range for the new field.
    const unmigrated = { ...m, strategies: [{ uid: "k0", kind: "builtin" as const, strategyId: "kelly", config: { assumedWinProb: 0, fraction: 0.5 } }] };
    expect(Object.keys(validateScenario(unmigrated))).toEqual(["strategy:k0:assumedWinProb"]);
    // The migrated scenario is still plain JSON.
    expect(JSON.parse(JSON.stringify(m))).toEqual(m);
  });

  it("sports odds (v3): the odds inputs compile to an ordinary Game and are the source of truth", () => {
    const game = sportsScenarioGame(defaultSportsInput());
    expect(game).toEqual({ presetId: SPORTS_GAME_ID, winProb: 0.5, netPayout: 100 / 110, sports: defaultSportsInput() });
    const s = withChanges({ game });
    expect(validateScenario(s)).toEqual({});
    expect(toSimRequest(s).game).toEqual({ id: "sports", name: "Sports odds", winProb: 0.5, netPayout: 100 / 110 });
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });

  it("sports odds: invalid inputs are reported per field; stale derived numbers are caught", () => {
    const bad = sportsScenarioGame({ ...defaultSportsInput(), sideA: -50, sideB: 0 }, { winProb: 0.5, netPayout: 1 });
    expect(bad.winProb).toBe(0.5); // previous numbers kept while the inputs are invalid
    expect(validateScenario(withChanges({ game: bad }))).toEqual({
      "game.sideA": "American odds must be +100 or higher, or -100 or lower (got -50).",
      "game.sideB": "American odds must be +100 or higher, or -100 or lower (got 0).",
    });
    const est = sportsScenarioGame({ ...defaultSportsInput(), mode: "estimate", estimate: 2 });
    expect(Object.keys(validateScenario(withChanges({ game: est })))).toEqual(["game.estimate"]);
    const stale = { ...sportsScenarioGame(defaultSportsInput()), winProb: 0.6 };
    expect(validateScenario(withChanges({ game: stale })).game).toBe("The game's probability and payout are out of date with its odds.");
    expect(validateScenario(withChanges({ game: { presetId: SPORTS_GAME_ID, winProb: 0.5, netPayout: 1 } })).game).toBe("Sports odds are missing.");
    expect(validateScenario(withChanges({ game: { presetId: "european", winProb: 18 / 37, netPayout: 1, sports: defaultSportsInput() } })).game).toBe("Only a sports game has odds inputs.");
  });

  it("migrates a version 2 scenario to version 3 with the game unchanged", () => {
    const current = defaultScenario();
    const v2: ScenarioConfigV2 = { ...current, version: 2, game: { presetId: "custom", winProb: 0.45, netPayout: 1.2 } };
    const m = migrateScenario(v2);
    expect(m.version).toBe(3);
    expect(m.game).toEqual({ presetId: "custom", winProb: 0.45, netPayout: 1.2 });
    expect({ ...m, version: 2 }).toEqual(v2);
    expect(validateScenario(m)).toEqual({});
  });
});
