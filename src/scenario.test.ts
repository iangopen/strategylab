import { describe, expect, it } from "vitest";
import { validateSessionConfig } from "./engine/types";
import { defaultScenario, newStrategyInstance, toSimRequest, validateScenario, type ScenarioConfig } from "./scenario";

const withChanges = (c: Partial<ScenarioConfig>): ScenarioConfig => ({ ...defaultScenario(), ...c });

describe("ScenarioConfig", () => {
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
});
