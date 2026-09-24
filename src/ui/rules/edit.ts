// Pure editing helpers for the rule builder form. Every function returns a NEW rule (inputs may be
// the validator's frozen output). The form only ever produces structurally valid rules; values can
// still be out of range, which the validator reports inline.
import { BLANK_PROGRESSION_RULE, BLANK_SEQUENCE_RULE } from "../../engine/rules/examples";
import { RULE_LIMITS } from "../../engine/rules/limits";
import type { Action, Condition, Entry, ProgressionRule, Rule } from "../../engine/rules/types";

export type ListKey = "onWin" | "onLoss";

/** Condition choices in the form. The two bankroll comparisons are separate choices. */
export const CONDITION_CHOICES = [
  { value: "winStreak", label: "Wins in a row, at least" },
  { value: "lossStreak", label: "Losses in a row, at least" },
  { value: "cycleProfit", label: "Cycle profit (units), at least" },
  { value: "bankroll>=", label: "Bankroll at or above % of start" },
  { value: "bankroll<=", label: "Bankroll at or below % of start" },
  { value: "betUnits", label: "Bet just placed (units), at least" },
] as const;
export type ConditionChoice = (typeof CONDITION_CHOICES)[number]["value"];

export const ACTION_CHOICES = [
  { value: "set", label: "Set the bet to (units)" },
  { value: "multiply", label: "Multiply the bet by" },
  { value: "add", label: "Add to the bet (units, may be negative)" },
  { value: "reset", label: "Back to the start bet" },
  { value: "resetCycle", label: "Start a new cycle (start bet, cycle profit and streaks to 0)" },
  { value: "stop", label: "Stop the session" },
] as const satisfies readonly { value: Action["type"]; label: string }[];

export function conditionChoice(c: Condition): ConditionChoice {
  return c.type === "bankroll" ? (c.op === ">=" ? "bankroll>=" : "bankroll<=") : c.type;
}

/** A fresh condition of the chosen kind, with a sensible default value. */
export function newCondition(choice: ConditionChoice): Condition {
  switch (choice) {
    case "winStreak":
      return { type: "winStreak", atLeast: 2 };
    case "lossStreak":
      return { type: "lossStreak", atLeast: 2 };
    case "cycleProfit":
      return { type: "cycleProfit", atLeast: 1 };
    case "bankroll>=":
      return { type: "bankroll", op: ">=", pct: 120 };
    case "bankroll<=":
      return { type: "bankroll", op: "<=", pct: 80 };
    case "betUnits":
      return { type: "betUnits", atLeast: 4 };
  }
}

export function newAction(type: Action["type"]): Action {
  switch (type) {
    case "set":
      return { type: "set", units: 1 };
    case "multiply":
      return { type: "multiply", by: 2 };
    case "add":
      return { type: "add", units: 1 };
    case "reset":
    case "resetCycle":
    case "stop":
      return { type };
  }
}

/** The one numeric field of a condition/action, if any: [key, value]. */
export function conditionValue(c: Condition): number {
  return c.type === "bankroll" ? c.pct : c.atLeast;
}
export function withConditionValue(c: Condition, v: number): Condition {
  return c.type === "bankroll" ? { ...c, pct: v } : { ...c, atLeast: v };
}
export function conditionValueKey(c: Condition): "pct" | "atLeast" {
  return c.type === "bankroll" ? "pct" : "atLeast";
}
export function actionValue(a: Action): { key: "units" | "by"; value: number } | null {
  if (a.type === "set" || a.type === "add") return { key: "units", value: a.units };
  if (a.type === "multiply") return { key: "by", value: a.by };
  return null;
}
export function withActionValue(a: Action, v: number): Action {
  if (a.type === "set" || a.type === "add") return { ...a, units: v };
  if (a.type === "multiply") return { ...a, by: v };
  return a;
}

function setList(rule: ProgressionRule, key: ListKey, list: Entry[]): ProgressionRule {
  return { ...rule, [key]: list };
}

export function replaceEntry(rule: ProgressionRule, key: ListKey, index: number, entry: Entry): ProgressionRule {
  return setList(rule, key, rule[key].map((e, i) => (i === index ? entry : e)));
}

export function canAddEntry(rule: ProgressionRule, key: ListKey): boolean {
  return rule[key].length < RULE_LIMITS.maxEntries;
}

/** Adds a new conditional entry just above the default (the default always stays last). */
export function addEntry(rule: ProgressionRule, key: ListKey): ProgressionRule {
  if (!canAddEntry(rule, key)) return rule;
  const list = rule[key];
  const fresh: Entry = { when: newCondition(key === "onWin" ? "winStreak" : "lossStreak"), then: newAction("reset") };
  return setList(rule, key, [...list.slice(0, -1), fresh, list[list.length - 1]!]);
}

/** Conditional entries can be reordered among themselves; the default never moves. */
export function canMoveEntry(rule: ProgressionRule, key: ListKey, index: number, dir: -1 | 1): boolean {
  const last = rule[key].length - 1;
  const to = index + dir;
  return index < last && to >= 0 && to < last;
}

export function moveEntry(rule: ProgressionRule, key: ListKey, index: number, dir: -1 | 1): ProgressionRule {
  if (!canMoveEntry(rule, key, index, dir)) return rule;
  const list = [...rule[key]];
  [list[index], list[index + dir]] = [list[index + dir]!, list[index]!];
  return setList(rule, key, list);
}

/** Conditional entries can be deleted; the default cannot. */
export function deleteEntry(rule: ProgressionRule, key: ListKey, index: number): ProgressionRule {
  if (index >= rule[key].length - 1) return rule;
  return setList(rule, key, rule[key].filter((_, i) => i !== index));
}

/** Switches between a progression and a sequence, keeping the name. */
export function changeKind(rule: Rule, kind: Rule["kind"]): Rule {
  if (rule.kind === kind) return rule;
  const blank = kind === "progression" ? BLANK_PROGRESSION_RULE : BLANK_SEQUENCE_RULE;
  return { ...structuredClone(blank), name: rule.name };
}

/**
 * Parses a line typed as "1, 2, 3, 4" or "1-2-3-4" (commas, dashes or spaces). Returns null when a
 * token is not a number; range and integer checks are the validator's job.
 */
export function parseLine(text: string): number[] | null {
  const tokens = text.split(/[\s,-]+/).filter((t) => t !== "");
  const nums = tokens.map((t) => (/^\d+(\.\d+)?$/.test(t) ? Number(t) : NaN));
  return nums.every((n) => Number.isFinite(n)) ? nums : null;
}

export function formatLine(line: readonly number[]): string {
  return line.join(", ");
}
