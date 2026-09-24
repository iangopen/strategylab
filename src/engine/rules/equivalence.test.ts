import { describe, expect, it } from "vitest";
import { GAME_PRESETS } from "../games";
import { sessionSeed } from "../rng";
import { runSession } from "../runner";
import { dalembert } from "../strategies/dalembert";
import { labouchere } from "../strategies/labouchere";
import { martingale } from "../strategies/martingale";
import { paroli } from "../strategies/paroli";
import type { AnyStrategy, StrategyConfig } from "../strategies/types";
import { INVARIANT_SCENARIO, sessionConfig } from "../testUtils";
import type { SessionConfig } from "../types";
import { compileRule } from "./compile";
import { DALEMBERT_RULE, EXAMPLE_RULES, LABOUCHERE_RULE, MARTINGALE_RULE, PAROLI_RULE } from "./examples";
import type { Rule } from "./types";

// The compiler's correctness proof: four built-ins expressed in the rule language produce
// BIT-IDENTICAL SessionResults over 10,000 sessions with the same seeds (CRN makes this possible).
const european = GAME_PRESETS.find((g) => g.id === "european")!;
const N = 10_000;
const PATH_SESSIONS = 200;

const PAIRS: [string, AnyStrategy, StrategyConfig, Rule][] = [
  ["Martingale ×2", martingale, { multiplier: 2 }, MARTINGALE_RULE],
  ["Paroli cap 3", paroli, { streakCap: 3 }, PAROLI_RULE],
  ["D'Alembert (unit 1)", dalembert, { unitSize: 1 }, DALEMBERT_RULE],
  ["Labouchère 1-2-3-4", labouchere, { sequence: "1-2-3-4", onComplete: "restart" }, LABOUCHERE_RULE],
];

const SCENARIOS: [string, SessionConfig, number][] = [
  // The app's default scenario in cents: $1,000, $10 base, $1,100 win target, no table max.
  ["app default", sessionConfig({ startBankroll: 100_000, baseBet: 1000, tableMin: 100, tableMax: null, stopWin: 110_000, stopLoss: null, maxRounds: 1000 }), 12345],
  // The invariant scenario: tableMax $250 clamps the progressions, stops on both sides.
  ["invariant (tableMax clamp, stops)", INVARIANT_SCENARIO, 777],
];

// Timeout: each case runs 2 x 10,000 full sessions (about 1-2 s idle). Under parallel-file CPU load
// "Paroli cap 3, invariant" once took 5,868 ms, over Vitest's 5 s default (session 9). The assertion
// is a deterministic bit-identity check, so the budget, not the engine, was the problem. Only this
// file gets a longer budget; everything else keeps the default so a hung test fails fast.
describe("equivalence: built-ins expressed as rules give bit-identical SessionResults", { timeout: 30_000 }, () => {
  it("the four proofs are the shipped examples", () => {
    for (const [, builtin, , rule] of PAIRS) expect(EXAMPLE_RULES.find((e) => e.builtinId === builtin.id)?.rule).toBe(rule);
  });

  for (const [name, builtin, config, rule] of PAIRS) {
    for (const [scenarioName, scenario, master] of SCENARIOS) {
      it(`${name}, ${scenarioName}: ${N.toLocaleString("en-US")} sessions`, () => {
        const compiled = compileRule(rule);
        let mismatches = 0;
        let rounds = 0;
        const reasons: Record<string, number> = {};
        for (let i = 0; i < N; i++) {
          const seed = sessionSeed(master, i);
          const withPath = i < PATH_SESSIONS;
          const a = runSession(european, builtin, config, scenario, seed, { recordPath: withPath });
          const b = runSession(european, compiled, {}, scenario, seed, { recordPath: withPath });
          // Every field, exact (toEqual on numbers is Object.is-strict, so no tolerance anywhere).
          if (JSON.stringify(a) !== JSON.stringify(b)) {
            if (mismatches === 0) expect(b, `first mismatch at session ${i}`).toEqual(a);
            mismatches++;
          }
          rounds += a.rounds;
          reasons[a.endReason] = (reasons[a.endReason] ?? 0) + 1;
        }
        console.log(`[equivalence] ${name} / ${scenarioName}: ${N} sessions, ${rounds} rounds, full paths compared for ${PATH_SESSIONS}; end reasons ${JSON.stringify(reasons)}; mismatches ${mismatches}`);
        expect(mismatches).toBe(0);
        expect(rounds).toBeGreaterThan(N); // real sessions, not all ending at round 0/1
      });
    }
  }

  it("negative control: a near-miss rule (Paroli with plain reset) is caught as different", () => {
    const nearMiss: Rule = { ...PAROLI_RULE, onWin: [{ when: { type: "winStreak", atLeast: 3 }, then: { type: "reset" } }, { then: { type: "multiply", by: 2 } }] };
    const compiled = compileRule(nearMiss);
    const [, scenario, master] = SCENARIOS[0]!;
    let mismatches = 0;
    for (let i = 0; i < 1000; i++) {
      const seed = sessionSeed(master, i);
      const a = runSession(european, paroli, { streakCap: 3 }, scenario, seed);
      const b = runSession(european, compiled, {}, scenario, seed);
      if (JSON.stringify(a) !== JSON.stringify(b)) mismatches++;
    }
    console.log(`[equivalence] negative control: ${mismatches} of 1000 sessions differ`);
    expect(mismatches).toBeGreaterThan(0);
  });
});
