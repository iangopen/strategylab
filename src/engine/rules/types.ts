// The rule language (see "Rule language" in CLAUDE.md). Rules are plain JSON DATA, never code.

export type Condition =
  | { readonly type: "winStreak"; readonly atLeast: number }
  | { readonly type: "lossStreak"; readonly atLeast: number }
  | { readonly type: "cycleProfit"; readonly atLeast: number }
  | { readonly type: "bankroll"; readonly op: ">=" | "<="; readonly pct: number }
  | { readonly type: "betUnits"; readonly atLeast: number };

export type Action =
  | { readonly type: "set"; readonly units: number }
  | { readonly type: "multiply"; readonly by: number }
  | { readonly type: "add"; readonly units: number }
  | { readonly type: "reset" }
  | { readonly type: "resetCycle" }
  | { readonly type: "stop" };

/** Every entry except the last has `when`; the last (the default) has none. */
export interface Entry {
  readonly when?: Condition;
  readonly then: Action;
}

export interface ProgressionRule {
  readonly kind: "progression";
  readonly name: string;
  readonly startUnits: number;
  readonly onWin: readonly Entry[];
  readonly onLoss: readonly Entry[];
}

export interface SequenceRule {
  readonly kind: "sequence";
  readonly name: string;
  readonly line: readonly number[];
  readonly onComplete: "restart" | "stop";
}

export type Rule = ProgressionRule | SequenceRule;

export type ConditionType = Condition["type"];
export type ActionType = Action["type"];
