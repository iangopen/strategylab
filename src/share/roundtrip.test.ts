import { describe, expect, it } from "vitest";
import { EXAMPLE_RULES } from "../engine/rules/examples";
import type { ProgressionRule } from "../engine/rules/types";
import { validateRule } from "../engine/rules/validate";
import { STRATEGIES } from "../engine/strategies/registry";
import { binaryScenarioGame, defaultScenario, migrateScenario, newCustomInstance, newStrategyInstance, SCENARIO_VERSION, validateScenario, type ScenarioConfig } from "../scenario";
import { decodeScenarioLink, encodeScenarioLink } from "./link";

const BASE = "https://strategylab.example.app/";

/** Scenario content without instance uids (React identity, deliberately not part of a link). */
const content = (s: ScenarioConfig) => ({ ...s, strategies: s.strategies.map(({ uid: _uid, ...rest }) => rest) });

function roundTrip(s: ScenarioConfig) {
  expect(validateScenario(s)).toEqual({});
  const enc = encodeScenarioLink(s, BASE);
  if (!enc.ok) throw new Error(enc.message);
  expect(enc.leftOut).toEqual([]);
  const dec = decodeScenarioLink(enc.fragment);
  if (dec.kind !== "loaded") throw new Error(JSON.stringify(dec));
  expect(dec.dropped).toEqual([]);
  expect(dec.fromVersion).toBe(SCENARIO_VERSION);
  const migrated = migrateScenario(dec.scenario);
  expect(migrated).toBe(dec.scenario); // already current: migration is the identity
  expect(migrated.version).toBe(SCENARIO_VERSION);
  expect(content(migrated)).toEqual(content(s));
  return enc;
}

/** Every field non-default, every condition and action code, both list maxima exercised. */
export const EVERYTHING_RULE: ProgressionRule = {
  kind: "progression",
  name: "Every field, non-default ✓",
  startUnits: 1.75,
  onWin: [
    { when: { type: "winStreak", atLeast: 3 }, then: { type: "resetCycle" } },
    { when: { type: "cycleProfit", atLeast: 4.5 }, then: { type: "stop" } },
    { when: { type: "bankroll", op: ">=", pct: 137.5 }, then: { type: "set", units: 0.25 } },
    { then: { type: "add", units: -0.5 } },
  ],
  onLoss: [
    { when: { type: "lossStreak", atLeast: 7 }, then: { type: "reset" } },
    { when: { type: "bankroll", op: "<=", pct: 62.25 }, then: { type: "stop" } },
    { when: { type: "betUnits", atLeast: 48.5 }, then: { type: "set", units: 3.3 } },
    { when: { type: "cycleProfit", atLeast: -12.75 }, then: { type: "multiply", by: 1.35 } },
    { when: { type: "lossStreak", atLeast: 2 }, then: { type: "add", units: 2.25 } },
    { when: { type: "winStreak", atLeast: 1 }, then: { type: "multiply", by: 0.8 } },
    { when: { type: "betUnits", atLeast: 0.01 }, then: { type: "resetCycle" } },
    { when: { type: "bankroll", op: ">=", pct: 999.99 }, then: { type: "set", units: 1_000_000 } },
    { when: { type: "cycleProfit", atLeast: 1000 }, then: { type: "add", units: -1000 } },
    { then: { type: "multiply", by: 2.5 } },
  ],
};

describe("scenario links round-trip exactly", () => {
  it("the hand-built rule is valid and covers every field", () => {
    expect(validateRule(EVERYTHING_RULE).ok).toBe(true);
    expect(EVERYTHING_RULE.onLoss).toHaveLength(10);
  });

  it("every built-in strategy with its default config (all 8, the maximum)", () => {
    const s: ScenarioConfig = { ...defaultScenario(), strategies: STRATEGIES.map((x) => newStrategyInstance(x.id)) };
    expect(s.strategies).toHaveLength(8);
    roundTrip(s);
  });

  it("every built-in with every setting changed from its default (Kelly with and without an assumed probability)", () => {
    const configs: Record<string, Record<string, number | string>> = {
      flat: { units: 2.5 },
      martingale: { multiplier: 2.7 },
      paroli: { streakCap: 5 },
      dalembert: { unitSize: 0.3 },
      fibonacci: {},
      labouchere: { sequence: "2-2-2-2", onComplete: "stop" },
      oscars: {},
      kelly: { assumedWinProb: 0.61, fraction: 0.35 },
    };
    const s: ScenarioConfig = { ...defaultScenario(), strategies: STRATEGIES.map((x) => ({ ...newStrategyInstance(x.id), config: { ...x.defaultConfig, ...configs[x.id] } })) };
    roundTrip(s);
    const blankKelly: ScenarioConfig = { ...defaultScenario(), strategies: [{ ...newStrategyInstance("kelly"), config: { fraction: 1.7 } }] };
    roundTrip(blankKelly);
  });

  it("the four session 6 example rules, the blank rule, and the every-field rule, with every top-level field non-default", () => {
    const s: ScenarioConfig = {
      version: 4,
      game: binaryScenarioGame("custom", 0.4712345678901234, 1.0833333333333333),
      startBankroll: 1234.56,
      baseBet: 2.5,
      tableMin: 0.5,
      tableMax: 250.75,
      stopWin: 1500.01,
      stopLoss: 400.4,
      maxRounds: 777,
      insufficientFunds: "allIn",
      sessions: 25_000,
      seed: 4_294_967_295,
      strategies: [...EXAMPLE_RULES.map((e) => newCustomInstance(e.rule)), newCustomInstance(EVERYTHING_RULE), newStrategyInstance("kelly")],
    };
    expect(s.strategies).toHaveLength(7);
    roundTrip(s);
  });

  it("preset games are carried by id; each preset round-trips", () => {
    for (const presetId of ["european", "american", "fairCoin"]) {
      const d = defaultScenario();
      const preset = { european: [18 / 37, 1], american: [18 / 38, 1], fairCoin: [0.5, 1] }[presetId]!;
      roundTrip({ ...d, game: binaryScenarioGame(presetId, preset[0]!, preset[1]!) });
    }
  });

  it("the default scenario round-trips, and the link is short", () => {
    const enc = roundTrip(defaultScenario());
    console.log(`[link] default scenario: fragment ${enc.fragment.length} chars, whole link ${enc.urlLength}`);
    expect(enc.urlLength).toBeLessThan(200);
  });
});
