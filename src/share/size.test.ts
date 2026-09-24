import { describe, expect, it } from "vitest";
import { RULE_LIMITS } from "../engine/rules/limits";
import type { Entry, ProgressionRule } from "../engine/rules/types";
import { validateRule } from "../engine/rules/validate";
import { defaultScenario, MAX_STRATEGIES, newCustomInstance, newStrategyInstance, validateScenario, type ScenarioConfig } from "../scenario";
import { decodeScenarioLink, encodeScenarioLink } from "./link";
import { MAX_URL_CHARS, ORIGIN_ALLOWANCE, TYPICAL_URL_BUDGET } from "./limits";

// The site address is not known in tests: count a fixed allowance for it (60 characters, longer
// than e.g. "https://strategylab.vercel.app/" at 31).
const BASE = "x".repeat(ORIGIN_ALLOWANCE);
const content = (s: ScenarioConfig) => ({ ...s, strategies: s.strategies.map(({ uid: _uid, ...rest }) => rest) });

/** The "typical" scenario: default money settings, a $250 table max, and 4 strategies, one a 10-entry rule. */
function typicalScenario(): ScenarioConfig {
  const rule: ProgressionRule = {
    kind: "progression",
    name: "Grow after two losses, bank a streak",
    startUnits: 1,
    onWin: [
      { when: { type: "winStreak", atLeast: 3 }, then: { type: "resetCycle" } },
      { when: { type: "cycleProfit", atLeast: 5 }, then: { type: "stop" } },
      { when: { type: "betUnits", atLeast: 4 }, then: { type: "multiply", by: 0.5 } },
      { then: { type: "reset" } },
    ],
    onLoss: [
      { when: { type: "bankroll", op: "<=", pct: 50 }, then: { type: "stop" } },
      { when: { type: "lossStreak", atLeast: 6 }, then: { type: "reset" } },
      { when: { type: "betUnits", atLeast: 16 }, then: { type: "set", units: 16 } },
      { when: { type: "lossStreak", atLeast: 2 }, then: { type: "multiply", by: 2 } },
      { when: { type: "cycleProfit", atLeast: -20 }, then: { type: "add", units: 1 } },
      { then: { type: "add", units: 0 } },
    ],
  };
  return {
    ...defaultScenario(),
    tableMax: 250,
    strategies: [newStrategyInstance("flat"), newStrategyInstance("martingale"), { ...newStrategyInstance("kelly"), config: { fraction: 0.5 } }, newCustomInstance(rule)],
  };
}

/** A maximum-size rule: 10 + 10 entries, a 40-character name, long numbers. */
function maxRule(name: string, longNumbers: boolean): ProgressionRule {
  const n = (x: number) => (longNumbers ? x + 0.123456789012345 : x);
  const entries = (seed: number): Entry[] => [
    ...Array.from({ length: RULE_LIMITS.maxEntries - 1 }, (_, i): Entry => ({
      when: i % 2 === 0 ? { type: "bankroll", op: ">=", pct: n(100 + seed + i) } : { type: "betUnits", atLeast: n(10 + i) },
      then: { type: "set", units: n(100_000 + i) },
    })),
    { then: { type: "multiply", by: n(1) } },
  ];
  return { kind: "progression", name, startUnits: n(12), onWin: entries(1), onLoss: entries(2) };
}

function maximalScenario(name: string, longNumbers: boolean): ScenarioConfig {
  return { ...defaultScenario(), strategies: Array.from({ length: MAX_STRATEGIES }, () => newCustomInstance(maxRule(name, longNumbers))) };
}

/** Either the link fits and round-trips EXACTLY, or it is refused as too large. Never truncated. */
function fitsOrRefused(s: ScenarioConfig, label: string): "fits" | "tooLarge" {
  expect(validateScenario(s)).toEqual({});
  const enc = encodeScenarioLink(s, BASE);
  if (enc.ok) {
    expect(enc.urlLength).toBeLessThanOrEqual(MAX_URL_CHARS);
    const dec = decodeScenarioLink(enc.fragment);
    expect(dec.kind === "loaded" && dec.dropped).toEqual([]);
    expect(dec.kind === "loaded" && content(dec.scenario)).toEqual(content(s));
    console.log(`[size] ${label}: fits, ${enc.urlLength} chars (limit ${MAX_URL_CHARS})`);
    return "fits";
  }
  expect(enc.reason).toBe("tooLarge");
  expect(enc).not.toHaveProperty("fragment"); // nothing to copy: no partial link exists
  expect(enc.message).toMatch(/over the 8,000-character limit.*Nothing was copied/);
  console.log(`[size] ${label}: refused as too large — ${enc.message.split(".")[0]}`);
  return "tooLarge";
}

describe("link size budget", () => {
  it(`the typical scenario (4 strategies, one a 10-entry rule) is under ${TYPICAL_URL_BUDGET} characters`, () => {
    const s = typicalScenario();
    const rule = s.strategies[3]!;
    expect(rule.kind === "custom" && validateRule(rule.rule).ok).toBe(true);
    const enc = encodeScenarioLink(s, BASE);
    if (!enc.ok) throw new Error(enc.message);
    const bytes = enc.fragment.length; // the fragment is pure ASCII: characters = bytes
    console.log(`[size] typical scenario: fragment ${bytes} chars/bytes + ${ORIGIN_ALLOWANCE} address allowance = ${enc.urlLength} (budget ${TYPICAL_URL_BUDGET})`);
    expect(enc.urlLength).toBeLessThan(TYPICAL_URL_BUDGET);
    const dec = decodeScenarioLink(enc.fragment);
    expect(dec.kind === "loaded" && content(dec.scenario)).toEqual(content(s));
  });

  it("maximal scenarios (8 strategies, each a maximum-size rule) fit exactly or are refused, never truncated", () => {
    // Realistic numbers, ASCII name.
    const a = fitsOrRefused(maximalScenario("M".repeat(40), false), "8 × max rule, short numbers");
    // Adversarial: 17-digit numbers everywhere and a 40-character name of 3-byte UTF-8 characters.
    const b = fitsOrRefused(maximalScenario("€".repeat(40), true), "8 × max rule, long numbers, 3-byte name");
    expect(b).toBe("tooLarge"); // this one is deliberately over the cap, so the refusal path is exercised
    expect([a, b]).toContain("tooLarge");
  });

  it("the whole-link limit includes the site address: the same scenario can fit on a short address and not on a long one", () => {
    const s = maximalScenario("M".repeat(40), false);
    const short = encodeScenarioLink(s, "");
    const len = short.ok ? short.urlLength : Infinity;
    if (len <= MAX_URL_CHARS) {
      const long = encodeScenarioLink(s, "x".repeat(MAX_URL_CHARS - len + 1));
      expect(long.ok).toBe(false);
    }
  });
});
