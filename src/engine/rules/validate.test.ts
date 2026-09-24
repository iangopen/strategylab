import { describe, expect, it } from "vitest";
import { BLANK_PROGRESSION_RULE, DALEMBERT_RULE, EXAMPLE_RULES, LABOUCHERE_RULE, MARTINGALE_RULE, PAROLI_RULE } from "./examples";
import { RULE_LIMITS, type NumberRange } from "./limits";
import type { Action, Condition, Entry } from "./types";
import { formatRuleError, parseRuleJson, validateRule } from "./validate";

/** A mutable deep copy of a rule, typed loosely so tests can inject anything. */
const clone = (o: unknown): Record<string, unknown> => structuredClone(o) as Record<string, unknown>;

/** A progression whose onWin has one conditional entry and a default. */
function withEntry(when: unknown, then: unknown): Record<string, unknown> {
  return { ...clone(BLANK_PROGRESSION_RULE), onWin: [{ when, then }, { then: { type: "reset" } }] };
}

function errorsOf(raw: unknown): string[] {
  const r = validateRule(raw);
  expect(r.ok, `expected rejection of ${JSON.stringify(raw)}`).toBe(false);
  if (r.ok) return [];
  expect(r.errors.length).toBeGreaterThan(0);
  const msgs = r.errors.map(formatRuleError);
  for (const m of msgs) expect(m.length).toBeGreaterThan(10); // readable, not a code
  return msgs;
}

const accepts = (raw: unknown) => {
  const r = validateRule(raw);
  expect(r.ok, r.ok ? "" : r.errors.map(formatRuleError).join("\n")).toBe(true);
};

describe("rule validator: every grammar branch is accepted", () => {
  it("the shipped examples", () => {
    for (const e of EXAMPLE_RULES) accepts(e.rule);
    for (const r of [MARTINGALE_RULE, PAROLI_RULE, DALEMBERT_RULE, LABOUCHERE_RULE]) accepts(r);
  });

  const conditions: Condition[] = [
    { type: "winStreak", atLeast: 2 },
    { type: "lossStreak", atLeast: 3 },
    { type: "cycleProfit", atLeast: -5 },
    { type: "bankroll", op: ">=", pct: 120 },
    { type: "bankroll", op: "<=", pct: 50 },
    { type: "betUnits", atLeast: 4 },
  ];
  const actions: Action[] = [
    { type: "set", units: 3 },
    { type: "multiply", by: 1.5 },
    { type: "add", units: -2 },
    { type: "add", units: 0 },
    { type: "reset" },
    { type: "resetCycle" },
    { type: "stop" },
  ];

  for (const when of conditions) {
    it(`condition ${when.type} ${JSON.stringify(when)}`, () => accepts(withEntry(when, { type: "reset" })));
  }
  for (const then of actions) {
    it(`action ${then.type} ${JSON.stringify(then)} (conditional and default)`, () => {
      accepts(withEntry({ type: "winStreak", atLeast: 1 }, then));
      accepts({ ...clone(BLANK_PROGRESSION_RULE), onLoss: [{ then }] });
    });
  }

  it("sequence with onComplete stop", () => accepts({ ...clone(LABOUCHERE_RULE), onComplete: "stop" }));

  it("returns a fresh, deep-frozen copy (the input is never kept)", () => {
    const input = clone(PAROLI_RULE);
    const r = validateRule(input);
    if (!r.ok) throw new Error("expected ok");
    expect(r.rule).toEqual(PAROLI_RULE);
    expect(r.rule).not.toBe(input);
    expect(Object.isFrozen(r.rule)).toBe(true);
    expect(r.rule.kind === "progression" && Object.isFrozen(r.rule.onWin[0]!.when)).toBe(true);
  });
});

describe("rule validator: every limit at its boundary", () => {
  // [description, where the value goes, its range]
  const numeric: [string, (v: number) => unknown, NumberRange][] = [
    ["startUnits", (v) => ({ ...clone(BLANK_PROGRESSION_RULE), startUnits: v }), RULE_LIMITS.startUnits],
    ["winStreak.atLeast", (v) => withEntry({ type: "winStreak", atLeast: v }, { type: "reset" }), RULE_LIMITS.streak],
    ["lossStreak.atLeast", (v) => withEntry({ type: "lossStreak", atLeast: v }, { type: "reset" }), RULE_LIMITS.streak],
    ["cycleProfit.atLeast", (v) => withEntry({ type: "cycleProfit", atLeast: v }, { type: "reset" }), RULE_LIMITS.cycleProfit],
    ["bankroll.pct", (v) => withEntry({ type: "bankroll", op: ">=", pct: v }, { type: "reset" }), RULE_LIMITS.bankrollPct],
    ["betUnits.atLeast", (v) => withEntry({ type: "betUnits", atLeast: v }, { type: "reset" }), RULE_LIMITS.betUnits],
    ["set.units", (v) => withEntry({ type: "winStreak", atLeast: 1 }, { type: "set", units: v }), RULE_LIMITS.setUnits],
    ["multiply.by", (v) => withEntry({ type: "winStreak", atLeast: 1 }, { type: "multiply", by: v }), RULE_LIMITS.multiplyBy],
    ["add.units", (v) => withEntry({ type: "winStreak", atLeast: 1 }, { type: "add", units: v }), RULE_LIMITS.addUnits],
    ["line value", (v) => ({ ...clone(LABOUCHERE_RULE), line: [1, v, 3] }), RULE_LIMITS.lineValue],
  ];

  for (const [name, place, range] of numeric) {
    it(`${name}: accepts ${range.min} and ${range.max}, rejects just outside`, () => {
      accepts(place(range.min));
      accepts(place(range.max));
      const eps = range.integer ? 1 : 0.001;
      expect(errorsOf(place(range.min - eps)).join()).toMatch(/must be between/);
      expect(errorsOf(place(range.max + eps)).join()).toMatch(/must be between/);
    });
    if (range.integer) {
      it(`${name}: rejects a fraction`, () => expect(errorsOf(place(range.min + 0.5)).join()).toMatch(/whole number/));
    }
    it(`${name}: rejects NaN, Infinity, -Infinity, a string and null`, () => {
      expect(errorsOf(place(NaN)).join()).toMatch(/finite number \(got NaN\)/);
      expect(errorsOf(place(Infinity)).join()).toMatch(/finite number \(got Infinity\)/);
      expect(errorsOf(place(-Infinity)).join()).toMatch(/finite number \(got -Infinity\)/);
      expect(errorsOf(place("2" as unknown as number)).join()).toMatch(/must be a number \(got "2"\)/);
      expect(errorsOf(place(null as unknown as number)).join()).toMatch(/must be a number \(got null\)/);
    });
  }

  const entries = (n: number): Entry[] => [
    ...Array.from({ length: n - 1 }, (_, i): Entry => ({ when: { type: "lossStreak", atLeast: i + 1 }, then: { type: "add", units: 1 } })),
    { then: { type: "reset" } },
  ];

  it("onWin / onLoss: 1 and 10 entries accepted, 0 and 11 rejected", () => {
    for (const key of ["onWin", "onLoss"]) {
      accepts({ ...clone(BLANK_PROGRESSION_RULE), [key]: entries(1) });
      accepts({ ...clone(BLANK_PROGRESSION_RULE), [key]: entries(10) });
      expect(errorsOf({ ...clone(BLANK_PROGRESSION_RULE), [key]: [] }).join()).toMatch(/at least one entry/);
      expect(errorsOf({ ...clone(BLANK_PROGRESSION_RULE), [key]: entries(11) }).join()).toMatch(/11 entries; at most 10/);
    }
  });

  it("sequence line: 1 and 20 numbers accepted, 0 and 21 rejected; a huge list is rejected without iterating it", () => {
    accepts({ ...clone(LABOUCHERE_RULE), line: [7] });
    accepts({ ...clone(LABOUCHERE_RULE), line: Array<number>(20).fill(1) });
    expect(errorsOf({ ...clone(LABOUCHERE_RULE), line: [] }).join()).toMatch(/1 to 20 numbers \(got 0\)/);
    expect(errorsOf({ ...clone(LABOUCHERE_RULE), line: Array<number>(21).fill(1) }).join()).toMatch(/1 to 20 numbers \(got 21\)/);
    const huge = errorsOf({ ...clone(LABOUCHERE_RULE), line: Array<number>(1_000_000).fill(1) });
    expect(huge).toHaveLength(1);
  });

  it("name: 1 and 40 characters accepted; empty, 41 characters and control characters rejected", () => {
    accepts({ ...clone(BLANK_PROGRESSION_RULE), name: "x" });
    accepts({ ...clone(BLANK_PROGRESSION_RULE), name: "x".repeat(40) });
    expect(errorsOf({ ...clone(BLANK_PROGRESSION_RULE), name: "" }).join()).toMatch(/must not be empty/);
    expect(errorsOf({ ...clone(BLANK_PROGRESSION_RULE), name: "   " }).join()).toMatch(/must not be empty/);
    expect(errorsOf({ ...clone(BLANK_PROGRESSION_RULE), name: "x".repeat(41) }).join()).toMatch(/at most 40 characters \(got 41\)/);
    expect(errorsOf({ ...clone(BLANK_PROGRESSION_RULE), name: "a\nb" }).join()).toMatch(/control characters/);
    expect(errorsOf({ ...clone(BLANK_PROGRESSION_RULE), name: 5 }).join()).toMatch(/must be text/);
  });
});

describe("rule validator: rejects everything outside the grammar, with readable errors", () => {
  it("non-objects at the top level", () => {
    for (const v of [null, undefined, 3, "rule", true, [], [BLANK_PROGRESSION_RULE]]) {
      expect(errorsOf(v).join()).toMatch(/a rule must be a JSON object/);
    }
  });

  it("unknown or missing kind", () => {
    expect(errorsOf({ ...clone(BLANK_PROGRESSION_RULE), kind: "script" }).join()).toMatch(/kind: must be "progression" or "sequence" \(got "script"\)/);
    const noKind = clone(BLANK_PROGRESSION_RULE);
    delete noKind.kind;
    expect(errorsOf(noKind).join()).toMatch(/got nothing/);
  });

  it("unknown keys at every level", () => {
    expect(errorsOf({ ...clone(BLANK_PROGRESSION_RULE), code: "alert(1)" }).join()).toMatch(/unknown key "code"/);
    expect(errorsOf({ ...clone(LABOUCHERE_RULE), startUnits: 1 }).join()).toMatch(/unknown key "startUnits"/);
    expect(errorsOf({ ...clone(BLANK_PROGRESSION_RULE), onWin: [{ then: { type: "reset" }, else: 1 }] }).join()).toMatch(/onWin entry 1: unknown key "else"/);
    expect(errorsOf(withEntry({ type: "winStreak", atLeast: 2, extra: 1 }, { type: "reset" })).join()).toMatch(/condition: unknown key "extra"/);
    expect(errorsOf(withEntry({ type: "winStreak", atLeast: 2 }, { type: "reset", units: 3 })).join()).toMatch(/action: unknown key "units"/);
  });

  it("__proto__ / constructor keys from JSON.parse are unknown keys, and nothing is polluted", () => {
    const parsed: unknown = JSON.parse('{"kind":"progression","name":"x","startUnits":1,"onWin":[{"then":{"type":"reset"}}],"onLoss":[{"then":{"type":"reset"}}],"__proto__":{"polluted":true}}');
    expect(errorsOf(parsed).join()).toMatch(/unknown key "__proto__"/);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    const cond: unknown = JSON.parse('{"type":"winStreak","atLeast":2,"constructor":1}');
    expect(errorsOf(withEntry(cond, { type: "reset" })).join()).toMatch(/unknown key "constructor"/);
  });

  it("unknown condition and action types", () => {
    expect(errorsOf(withEntry({ type: "eval", atLeast: 1 }, { type: "reset" })).join()).toMatch(/condition → type: must be one of "winStreak"/);
    expect(errorsOf(withEntry({ type: "winStreak", atLeast: 1 }, { type: "doubleDown" })).join()).toMatch(/action → type: must be one of "set"/);
    expect(errorsOf(withEntry({ type: "bankroll", op: "==", pct: 100 }, { type: "reset" })).join()).toMatch(/op: must be one of ">=", "<=" \(got "=="\)/);
  });

  it("missing fields", () => {
    expect(errorsOf(withEntry({ type: "winStreak" }, { type: "reset" })).join()).toMatch(/missing "atLeast"/);
    expect(errorsOf(withEntry({ type: "winStreak", atLeast: 1 }, { type: "multiply" })).join()).toMatch(/missing "by"/);
    expect(errorsOf({ ...clone(BLANK_PROGRESSION_RULE), onWin: [{}] }).join()).toMatch(/missing "then"/);
    const noLine = clone(LABOUCHERE_RULE);
    delete noLine.line;
    expect(errorsOf(noLine).join()).toMatch(/missing "line"/);
  });

  it("wrong types where an object or list is expected", () => {
    expect(errorsOf({ ...clone(BLANK_PROGRESSION_RULE), onWin: { then: { type: "reset" } } }).join()).toMatch(/onWin: must be a list of entries \(got an object\)/);
    expect(errorsOf({ ...clone(BLANK_PROGRESSION_RULE), onWin: [null] }).join()).toMatch(/onWin entry 1: must be an object/);
    expect(errorsOf({ ...clone(BLANK_PROGRESSION_RULE), onWin: [{ then: [] }] }).join()).toMatch(/the action must be an object \(got a list\)/);
    expect(errorsOf(withEntry("winStreak >= 2", { type: "reset" })).join()).toMatch(/the condition must be an object/);
    expect(errorsOf({ ...clone(LABOUCHERE_RULE), line: "1-2-3-4" }).join()).toMatch(/line: must be a list of whole numbers/);
    expect(errorsOf({ ...clone(LABOUCHERE_RULE), onComplete: true }).join()).toMatch(/onComplete: must be one of "restart", "stop" \(got a boolean\)/);
  });

  it("the default entry: the last must have no condition, every other must have one", () => {
    expect(errorsOf({ ...clone(BLANK_PROGRESSION_RULE), onWin: [{ when: { type: "winStreak", atLeast: 2 }, then: { type: "reset" } }] }).join()).toMatch(/is the last entry \(the default\)/);
    expect(errorsOf({ ...clone(BLANK_PROGRESSION_RULE), onLoss: [{ then: { type: "reset" } }, { then: { type: "stop" } }] }).join()).toMatch(/onLoss entry 1: needs a "when" condition/);
  });

  it("errors name their location and the bad value", () => {
    const r = validateRule({ ...clone(BLANK_PROGRESSION_RULE), onLoss: [{ when: { type: "lossStreak", atLeast: 2 }, then: { type: "reset" } }, { then: { type: "multiply", by: 12 } }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map(formatRuleError)).toEqual(["onLoss entry 2 → action → by: must be between 0.1 and 10 (got 12)"]);
  });

  it("reports every problem at once, not only the first", () => {
    const r = validateRule({ ...clone(BLANK_PROGRESSION_RULE), name: "", startUnits: 0, onWin: [], extra: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.length).toBe(1); // unknown key stops the top level before field checks
    const r2 = validateRule({ ...clone(BLANK_PROGRESSION_RULE), name: "", startUnits: 0, onWin: [] });
    if (!r2.ok) expect(r2.errors.map((e) => e.path)).toEqual(["name", "startUnits", "onWin"]);
    else throw new Error("expected rejection");
  });

  it("never throws, even on exotic objects", () => {
    const hostile = new Proxy({}, { getPrototypeOf: () => { throw new Error("boom"); } });
    expect(() => validateRule(hostile)).not.toThrow();
    expect(validateRule(hostile).ok).toBe(false);
    expect(validateRule(new Date()).ok).toBe(false); // not a plain object
    expect(validateRule(Object.create({ kind: "progression" }) as unknown).ok).toBe(false); // inherited keys are never read
  });
});

describe("rule validator: ranges: false (the form's structural check)", () => {
  it("skips numeric ranges, integer-ness, name length and line length, but not structure", () => {
    const outOfRange = { ...clone(BLANK_PROGRESSION_RULE), name: "", startUnits: 5000, onLoss: [{ then: { type: "multiply", by: 99 } }] };
    expect(validateRule(outOfRange).ok).toBe(false);
    expect(validateRule(outOfRange, { ranges: false }).ok).toBe(true);
    expect(validateRule({ ...clone(LABOUCHERE_RULE), line: [] }, { ranges: false }).ok).toBe(true);
    expect(validateRule({ ...clone(LABOUCHERE_RULE), line: [1.5] }, { ranges: false }).ok).toBe(true);
    expect(validateRule({ ...clone(BLANK_PROGRESSION_RULE), startUnits: NaN }, { ranges: false }).ok).toBe(false);
    expect(validateRule({ ...clone(BLANK_PROGRESSION_RULE), extra: 1 }, { ranges: false }).ok).toBe(false);
    expect(validateRule({ ...clone(BLANK_PROGRESSION_RULE), onWin: [] }, { ranges: false }).ok).toBe(false);
  });
});

describe("parseRuleJson", () => {
  it("parses JSON, reports a parse error, and caps the length", () => {
    expect(parseRuleJson(JSON.stringify(MARTINGALE_RULE))).toEqual({ ok: true, value: MARTINGALE_RULE });
    const bad = parseRuleJson("{ kind: progression }");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/^Not valid JSON: /);
    const long = parseRuleJson(" ".repeat(RULE_LIMITS.maxJsonLength + 1));
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.error).toMatch(/too long/);
    expect(parseRuleJson(" ".repeat(RULE_LIMITS.maxJsonLength - 2) + "{}").ok).toBe(true);
  });
});
