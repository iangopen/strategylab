import { describe, expect, it } from "vitest";
import { DALEMBERT_RULE, LABOUCHERE_RULE, MARTINGALE_RULE, PAROLI_RULE } from "../../engine/rules/examples";
import { RULE_LIMITS } from "../../engine/rules/limits";
import type { ProgressionRule } from "../../engine/rules/types";
import { validateRule } from "../../engine/rules/validate";
import {
  ACTION_CHOICES,
  actionValue,
  addEntry,
  canMoveEntry,
  changeKind,
  CONDITION_CHOICES,
  conditionChoice,
  deleteEntry,
  moveEntry,
  newAction,
  newCondition,
  parseLine,
  withActionValue,
  withConditionValue,
} from "./edit";

const valid = (r: unknown) => expect(validateRule(r).ok).toBe(true);

describe("rule builder editing helpers", () => {
  it("every condition and action choice produces a valid, round-tripping value", () => {
    for (const c of CONDITION_CHOICES) {
      const cond = newCondition(c.value);
      expect(conditionChoice(cond)).toBe(c.value);
      valid({ ...MARTINGALE_RULE, onWin: [{ when: cond, then: { type: "reset" } }, { then: { type: "reset" } }] });
    }
    for (const a of ACTION_CHOICES) valid({ ...MARTINGALE_RULE, onLoss: [{ then: newAction(a.value) }] });
  });

  it("value setters change only the value", () => {
    expect(withConditionValue({ type: "bankroll", op: "<=", pct: 80 }, 70)).toEqual({ type: "bankroll", op: "<=", pct: 70 });
    expect(withConditionValue({ type: "lossStreak", atLeast: 2 }, 5)).toEqual({ type: "lossStreak", atLeast: 5 });
    expect(withActionValue({ type: "multiply", by: 2 }, 3)).toEqual({ type: "multiply", by: 3 });
    expect(actionValue({ type: "stop" })).toBeNull();
  });

  it("addEntry inserts above the default, up to the 10-entry limit", () => {
    let r: ProgressionRule = MARTINGALE_RULE;
    r = addEntry(r, "onLoss");
    expect(r.onLoss).toHaveLength(2);
    expect(r.onLoss[0]!.when).toEqual({ type: "lossStreak", atLeast: 2 });
    expect(r.onLoss[1]).toEqual(MARTINGALE_RULE.onLoss[0]); // default still last
    valid(r);
    for (let i = 0; i < 20; i++) r = addEntry(r, "onLoss");
    expect(r.onLoss).toHaveLength(RULE_LIMITS.maxEntries);
    valid(r);
  });

  it("moveEntry reorders conditional entries but never moves the default", () => {
    const r = addEntry(PAROLI_RULE, "onWin"); // [streak>=3 resetCycle, new streak>=2 reset, default]
    expect(canMoveEntry(r, "onWin", 0, -1)).toBe(false);
    expect(canMoveEntry(r, "onWin", 1, 1)).toBe(false); // would swap with the default
    expect(canMoveEntry(r, "onWin", 2, -1)).toBe(false); // the default itself
    const moved = moveEntry(r, "onWin", 1, -1);
    expect(moved.onWin.map((e) => e.when)).toEqual([r.onWin[1]!.when, r.onWin[0]!.when, undefined]);
    expect(moveEntry(r, "onWin", 1, 1)).toBe(r);
    valid(moved);
  });

  it("deleteEntry removes a conditional entry; the default cannot be deleted", () => {
    expect(deleteEntry(PAROLI_RULE, "onWin", 0).onWin).toEqual([PAROLI_RULE.onWin[1]]);
    expect(deleteEntry(PAROLI_RULE, "onWin", 1)).toBe(PAROLI_RULE);
    valid(deleteEntry(DALEMBERT_RULE, "onWin", 0));
  });

  it("changeKind swaps to a blank of the other kind, keeping the name", () => {
    const seq = changeKind(PAROLI_RULE, "sequence");
    expect(seq.kind).toBe("sequence");
    expect(seq.name).toBe(PAROLI_RULE.name);
    valid(seq);
    expect(changeKind(LABOUCHERE_RULE, "sequence")).toBe(LABOUCHERE_RULE);
    valid(changeKind(LABOUCHERE_RULE, "progression"));
  });

  it("does not mutate frozen inputs", () => {
    const frozen = validateRule(PAROLI_RULE);
    const rule = frozen.ok ? frozen.rule : undefined;
    if (rule?.kind !== "progression") throw new Error("expected a progression");
    expect(Object.isFrozen(rule.onWin)).toBe(true);
    expect(() => moveEntry(addEntry(rule, "onWin"), "onWin", 1, -1)).not.toThrow();
    expect(() => deleteEntry(rule, "onWin", 0)).not.toThrow();
  });

  it("parseLine accepts commas, dashes and spaces; rejects non-numbers", () => {
    expect(parseLine("1, 2, 3, 4")).toEqual([1, 2, 3, 4]);
    expect(parseLine("1-2-3-4")).toEqual([1, 2, 3, 4]);
    expect(parseLine(" 5 1  3 ")).toEqual([5, 1, 3]);
    expect(parseLine("1.5, 2")).toEqual([1.5, 2]); // the validator rejects the fraction, with a message
    expect(parseLine("")).toEqual([]);
    expect(parseLine("1, x")).toBeNull();
    expect(parseLine("1e3")).toBeNull();
  });
});
