// Example rules shipped in the builder. The first four reproduce built-in strategies EXACTLY
// (bit-identical SessionResults, see equivalence.test.ts); they are the compiler's correctness proof.
import type { ProgressionRule, Rule, SequenceRule } from "./types";

/** Martingale ×2: double after a loss, back to 1 unit after a win. */
export const MARTINGALE_RULE: ProgressionRule = {
  kind: "progression",
  name: "Double after a loss",
  startUnits: 1,
  onWin: [{ then: { type: "reset" } }],
  onLoss: [{ then: { type: "multiply", by: 2 } }],
};

/** Paroli cap 3: double after a win; the third win in a row, or any loss, goes back to 1 unit. */
export const PAROLI_RULE: ProgressionRule = {
  kind: "progression",
  name: "Double after a win, cap 3",
  startUnits: 1,
  onWin: [
    { when: { type: "winStreak", atLeast: 3 }, then: { type: "resetCycle" } },
    { then: { type: "multiply", by: 2 } },
  ],
  onLoss: [{ then: { type: "reset" } }],
};

/** D'Alembert (unit size 1): +1 unit after a loss, −1 after a win, never below 1 unit. */
export const DALEMBERT_RULE: ProgressionRule = {
  kind: "progression",
  name: "+1 after a loss, -1 after a win",
  startUnits: 1,
  onWin: [
    { when: { type: "betUnits", atLeast: 2 }, then: { type: "add", units: -1 } },
    { then: { type: "reset" } },
  ],
  onLoss: [{ then: { type: "add", units: 1 } }],
};

/** Labouchère 1-2-3-4, restarting when the line clears. */
export const LABOUCHERE_RULE: SequenceRule = {
  kind: "sequence",
  name: "Cancellation line 1-2-3-4",
  line: [1, 2, 3, 4],
  onComplete: "restart",
};

/** A starting point for a new rule: the same bet every round. */
export const BLANK_PROGRESSION_RULE: ProgressionRule = {
  kind: "progression",
  name: "My rule",
  startUnits: 1,
  onWin: [{ then: { type: "reset" } }],
  onLoss: [{ then: { type: "reset" } }],
};

export const BLANK_SEQUENCE_RULE: SequenceRule = {
  kind: "sequence",
  name: "My line",
  line: [1, 2, 3],
  onComplete: "restart",
};

/** The rules offered in the strategy picker, in order. `builtinId` names the strategy it reproduces. */
export const EXAMPLE_RULES: readonly { id: string; label: string; builtinId?: string; rule: Rule }[] = [
  { id: "blank", label: "Blank rule (same bet every round)", rule: BLANK_PROGRESSION_RULE },
  { id: "martingale", label: "Example: Martingale ×2 as a rule", builtinId: "martingale", rule: MARTINGALE_RULE },
  { id: "paroli", label: "Example: Paroli cap 3 as a rule", builtinId: "paroli", rule: PAROLI_RULE },
  { id: "dalembert", label: "Example: D'Alembert as a rule", builtinId: "dalembert", rule: DALEMBERT_RULE },
  { id: "labouchere", label: "Example: Labouchère 1-2-3-4 as a rule", builtinId: "labouchere", rule: LABOUCHERE_RULE },
];
