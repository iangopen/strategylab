import { describe, expect, it } from "vitest";
import { GAME_PRESETS } from "../games";
import { runSessionWithRng } from "../runner";
import { betSequence, deltasFromPath, expectPure, gameView, L, scriptedRng, sessionConfig, W } from "../testUtils";
import { compileRule, CUSTOM_STRATEGY_ID } from "./compile";
import { BLANK_PROGRESSION_RULE, BLANK_SEQUENCE_RULE, DALEMBERT_RULE, EXAMPLE_RULES, LABOUCHERE_RULE, MARTINGALE_RULE, PAROLI_RULE } from "./examples";
import { MAX_UNITS, MIN_UNITS } from "./limits";
import type { Entry, ProgressionRule } from "./types";

const european = GAME_PRESETS.find((g) => g.id === "european")!;
const script = (s: string) => [...s].map((c) => c === "W");
const bets = (rule: unknown, s: string, baseBet = 100, game = gameView()) => betSequence(compileRule(rule), {}, script(s), baseBet, game);

function progression(onWin: Entry[], onLoss: Entry[], startUnits = 1): ProgressionRule {
  return { kind: "progression", name: "test", startUnits, onWin, onLoss };
}

describe("compiled rules: the worked examples in CLAUDE.md", () => {
  it("1. double after a loss: LLLWLW -> 1, 2, 4, 8, 1, 2, next 1", () => {
    expect(bets(MARTINGALE_RULE, "LLLWLW", 1)).toEqual([1, 2, 4, 8, 1, 2, 1]);
  });

  it("2. Paroli cap 3: WWWWLW -> 1, 2, 4, 1, 2, 1, next 2 (resetCycle clears the streak)", () => {
    expect(bets(PAROLI_RULE, "WWWWLW", 1)).toEqual([1, 2, 4, 1, 2, 1, 2]);
    // With plain reset instead, the 4th win still sees streak 4 >= 3 and resets again.
    const plainReset = { ...PAROLI_RULE, onWin: [{ when: { type: "winStreak", atLeast: 3 }, then: { type: "reset" } }, { then: { type: "multiply", by: 2 } }] };
    expect(bets(plainReset, "WWWWLW", 1)).toEqual([1, 2, 4, 1, 1, 1, 2]);
  });

  it("3. flat, stop at +20% (through the runner: start $100, base $10): WLWW -> 110, 100, 110, 120, then strategyStop", () => {
    const rule = progression(
      [{ when: { type: "bankroll", op: ">=", pct: 120 }, then: { type: "stop" } }, { then: { type: "reset" } }],
      [{ then: { type: "reset" } }],
    );
    const cfg = sessionConfig({ startBankroll: 10_000, baseBet: 1000, maxRounds: 100 });
    const rng = scriptedRng(script("WLWW"));
    const r = runSessionWithRng(european, compileRule(rule), {}, cfg, rng, { recordPath: true });
    expect(r.path!.bankroll).toEqual([10_000, 11_000, 10_000, 11_000, 12_000]);
    expect(r.endReason).toBe("strategyStop");
    expect(rng.draws()).toBe(4); // the stop costs no draw
  });
});

describe("compiled rules: exact sequences for every condition and action", () => {
  it("D'Alembert example: +1 per loss, -1 per win, floored at 1 unit", () => {
    expect(bets(DALEMBERT_RULE, "LLWWWW")).toEqual([100, 200, 300, 200, 100, 100, 100]);
  });

  it("lossStreak + set: after 3 losses in a row, bet 5 units; otherwise stay", () => {
    const rule = progression([{ then: { type: "reset" } }], [{ when: { type: "lossStreak", atLeast: 3 }, then: { type: "set", units: 5 } }, { then: { type: "add", units: 0 } }]);
    expect(bets(rule, "LLLLW")).toEqual([100, 100, 100, 500, 500, 100]);
  });

  it("cycleProfit uses the placed bet and the payout: payout 1.2, stop once the cycle is up 2 units", () => {
    // Bets 100 each (flat): W +120, W +240 >= 200 -> stop.
    const rule = progression([{ when: { type: "cycleProfit", atLeast: 2 }, then: { type: "stop" } }, { then: { type: "reset" } }], [{ then: { type: "reset" } }]);
    expect(bets(rule, "WW", 100, gameView(1.2))).toEqual([100, 100, "stop"]);
    // L -100, W +20, W +140, W +260 -> stop after the 4th round.
    expect(bets(rule, "LWWW", 100, gameView(1.2))).toEqual([100, 100, 100, 100, "stop"]);
  });

  it("resetCycle zeroes cycle profit", () => {
    // onWin: cycle >= 1 unit -> resetCycle; else +1 unit. onLoss: keep.
    const rule = progression([{ when: { type: "cycleProfit", atLeast: 1 }, then: { type: "resetCycle" } }, { then: { type: "add", units: 1 } }], [{ then: { type: "add", units: 0 } }]);
    // L 100: -100. W 100: 0 < 100 -> units 2. W 200: +200 -> resetCycle (cycle 0, units 1).
    // L 100: -100. W 100: 0 < 100 -> units 2, so the next bet is 200. Had the cycle NOT been zeroed,
    // it would read +200 here, reset again, and the next bet would be 100.
    expect(bets(rule, "LWWLW")).toEqual([100, 100, 200, 100, 100, 200]);
  });

  it("betUnits reads the units of the bet just placed", () => {
    const rule = progression([{ then: { type: "reset" } }], [{ when: { type: "betUnits", atLeast: 4 }, then: { type: "reset" } }, { then: { type: "multiply", by: 2 } }]);
    expect(bets(rule, "LLLLL")).toEqual([100, 200, 400, 100, 200, 400]);
  });

  it("bankroll <= : stop once below 90% of start (through the runner)", () => {
    const rule = progression([{ then: { type: "reset" } }], [{ when: { type: "bankroll", op: "<=", pct: 90 }, then: { type: "stop" } }, { then: { type: "reset" } }]);
    const cfg = sessionConfig({ startBankroll: 10_000, baseBet: 500, maxRounds: 100 });
    const r = runSessionWithRng(european, compileRule(rule), {}, cfg, scriptedRng(script("LWLL")), { recordPath: true });
    expect(r.path!.bankroll).toEqual([10_000, 9_500, 10_000, 9_500, 9_000]);
    expect(r.endReason).toBe("strategyStop");
  });

  it("first match wins, top to bottom", () => {
    const rule = progression(
      [
        { when: { type: "winStreak", atLeast: 1 }, then: { type: "set", units: 3 } },
        { when: { type: "winStreak", atLeast: 2 }, then: { type: "set", units: 9 } }, // shadowed: streak >= 2 implies >= 1
        { then: { type: "reset" } },
      ],
      [{ then: { type: "reset" } }],
    );
    expect(bets(rule, "WW")).toEqual([100, 300, 300]);
  });

  it("units are clamped to [0.01, MAX_SAFE_INTEGER] and the bet never overflows", () => {
    const shrink = progression([{ then: { type: "add", units: -1000 } }], [{ then: { type: "reset" } }]);
    expect(bets(shrink, "W", 100)).toEqual([100, 100 * MIN_UNITS]);
    const grow = progression([{ then: { type: "reset" } }], [{ then: { type: "multiply", by: 10 } }]);
    const b = bets(grow, "L".repeat(400));
    expect(b.every((x) => typeof x === "number" && Number.isFinite(x) && x > 0)).toBe(true);
    expect(b[b.length - 1]).toBe(Number.MAX_SAFE_INTEGER);
    expect(MAX_UNITS).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("after stop, the rule keeps saying stop", () => {
    const rule = progression([{ then: { type: "stop" } }], [{ then: { type: "reset" } }]);
    expect(bets(rule, "LWLW")).toEqual([100, 100, "stop", "stop", "stop"]);
  });
});

describe("compiled rules: sequences (custom Labouchère)", () => {
  it("same sequences as the built-in Labouchère tests", () => {
    expect(bets(LABOUCHERE_RULE, "LWWW")).toEqual([500, 600, 600, 300, 500]);
    expect(bets(LABOUCHERE_RULE, "LLL")).toEqual([500, 600, 700, 800]);
    expect(bets({ ...LABOUCHERE_RULE, onComplete: "stop" }, "WW")).toEqual([500, 500, "stop"]);
    expect(bets({ ...LABOUCHERE_RULE, line: [2, 2, 2, 2] }, "WW", 500)).toEqual([2000, 2000, 2000]);
  });

  it("a custom line the built-in presets don't have", () => {
    // [5, 1, 3] -> W -> [1] -> L append 1 -> [1, 1] -> W clears -> restart [5, 1, 3]
    expect(bets({ ...BLANK_SEQUENCE_RULE, line: [5, 1, 3] }, "WLW")).toEqual([800, 100, 200, 800]);
  });
});

describe("compiled rules: purity, identity, and rejection", () => {
  it("every example is pure under deep-frozen inputs", () => {
    for (const e of EXAMPLE_RULES) expectPure(compileRule(e.rule), {});
    expectPure(compileRule(BLANK_SEQUENCE_RULE), {});
    expectPure(compileRule(progression([{ when: { type: "cycleProfit", atLeast: 1 }, then: { type: "resetCycle" } }, { then: { type: "stop" } }], [{ then: { type: "multiply", by: 1.5 } }])), {});
  });

  it("reports id 'custom', labels itself with the rule name, and has no config fields", () => {
    const s = compileRule(PAROLI_RULE);
    expect(s.id).toBe(CUSTOM_STRATEGY_ID);
    expect(s.label).toBe(PAROLI_RULE.name);
    expect(s.configSchema).toEqual([]);
  });

  it("never reads the caller's object after compiling (validated copy)", () => {
    const input = structuredClone(BLANK_PROGRESSION_RULE) as { startUnits: number };
    const s = compileRule(input);
    input.startUnits = 50;
    expect(betSequence(s, {}, [W])).toEqual([100, 100]);
  });

  it("invalid rules throw ONE readable Error listing every problem", () => {
    expect(() => compileRule({ kind: "progression" })).toThrow(/^Invalid custom rule: .*missing "name".*missing "startUnits"/);
    expect(() => compileRule("while(true){}")).toThrow(/a rule must be a JSON object/);
  });

  it("the placed bet (after a tableMax clamp) is what cycle profit counts", () => {
    // Martingale-like with a cycle stop at +1 unit; tableMax $2 clamps the 4-unit bet to 2 units.
    const rule = progression([{ when: { type: "cycleProfit", atLeast: 1 }, then: { type: "stop" } }, { then: { type: "reset" } }], [{ then: { type: "multiply", by: 2 } }]);
    const cfg = sessionConfig({ startBankroll: 10_000, baseBet: 100, tableMax: 200, maxRounds: 100 });
    const rng = scriptedRng([L, L, W, L, W, W]);
    const r = runSessionWithRng(european, compileRule(rule), {}, cfg, rng, { recordPath: true });
    // R1 100 L: cycle -100. R2 200 L: -300. R3 wants 400, PLACED 200 (clamp), W: -100 < +100 -> reset.
    // (Counting the intended 400 would give +100 and stop here.) R4 100 L: -200. R5 200 W: 0 -> reset.
    // R6 100 W: +100 >= +100 -> stop.
    expect(deltasFromPath(r.path!).map(Math.abs)).toEqual([100, 200, 200, 100, 200, 100]);
    expect(r.endReason).toBe("strategyStop");
    expect(rng.draws()).toBe(6);
  });
});
