// Every limit of the rule language, in one place. The validator and the builder UI both read these.

export interface NumberRange {
  readonly min: number;
  readonly max: number;
  readonly integer?: boolean;
}

export const RULE_LIMITS = {
  nameMaxLength: 40,
  /** Entries per onWin / onLoss list. */
  maxEntries: 10,
  /** Numbers in a sequence line. */
  lineLength: { min: 1, max: 20 },
  /** Hard cap on any list the validator will even look at, whatever the mode. */
  hardListCap: 1000,
  /** Characters of pasted rule JSON. */
  maxJsonLength: 20_000,

  startUnits: { min: 0.01, max: 1000 },
  streak: { min: 1, max: 100, integer: true },
  cycleProfit: { min: -1000, max: 1000 },
  bankrollPct: { min: 0, max: 1000 },
  betUnits: { min: 0.01, max: 1_000_000 },
  setUnits: { min: 0.01, max: 1_000_000 },
  multiplyBy: { min: 0.1, max: 10 },
  addUnits: { min: -1000, max: 1000 },
  lineValue: { min: 1, max: 100, integer: true },
} as const satisfies Record<string, unknown>;

/** Units after any action are clamped to [MIN_UNITS, MAX_UNITS] (overflow guard, as in session 2). */
export const MIN_UNITS = 0.01;
export const MAX_UNITS = Number.MAX_SAFE_INTEGER;
