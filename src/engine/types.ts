// Shared engine types. All money is integer cents.

export const END_REASONS = [
  "ruin",
  "insufficientFunds",
  "stopWin",
  "stopLoss",
  "maxRounds",
  "strategyStop",
] as const;

export type EndReason = (typeof END_REASONS)[number];

export const MAX_ROUNDS_CAP = 1_000_000;
export const DEFAULT_MAX_ROUNDS = 1000;

export interface SessionConfig {
  startBankroll: number;
  /** Passed to strategies via ctx; strategies decide how to use it. */
  baseBet: number;
  tableMin: number;
  /** null = no table maximum. */
  tableMax: number | null;
  /** Session ends when bankroll >= stopWin. null = off. */
  stopWin: number | null;
  /** Floor: session ends when bankroll <= stopLoss. null = off. */
  stopLoss: number | null;
  /** Required and finite, 1..MAX_ROUNDS_CAP. */
  maxRounds: number;
  insufficientFunds: "stop" | "allIn";
}

export interface SamplePath {
  /** Round count at which each bankroll value was recorded (0 = start). */
  rounds: number[];
  bankroll: number[];
}

export interface SessionResult {
  finalBankroll: number;
  rounds: number;
  totalWagered: number;
  peak: number;
  maxDrawdown: number;
  longestLosingStreak: number;
  endReason: EndReason;
  path?: SamplePath;
}

/** Called with (round, bankroll) at round 0 and after every resolved round. Must not throw or touch the RNG. */
export type RoundObserver = (round: number, bankroll: number) => void;

export interface RunOptions {
  /** Full path, every round (tests and single-session replay). runMonteCarlo uses observer instead. */
  recordPath?: boolean;
  /** Optional per-round observer. Sessions without one pay only a branch check per round. */
  observer?: RoundObserver;
}

function isCents(x: number): boolean {
  return Number.isSafeInteger(x);
}

/** Returns a list of problems; empty means valid. */
export function validateSessionConfig(c: SessionConfig): string[] {
  const e: string[] = [];
  if (!isCents(c.startBankroll) || c.startBankroll <= 0) e.push("startBankroll must be a positive integer (cents).");
  if (!isCents(c.baseBet) || c.baseBet <= 0) e.push("baseBet must be a positive integer (cents).");
  if (!isCents(c.tableMin) || c.tableMin < 1) e.push("tableMin must be an integer >= 1 cent.");
  if (c.tableMax !== null && (!isCents(c.tableMax) || c.tableMax < c.tableMin)) {
    e.push("tableMax must be an integer >= tableMin.");
  }
  if (c.stopWin !== null && (!isCents(c.stopWin) || c.stopWin <= c.startBankroll)) {
    e.push("stopWin must be an integer above startBankroll.");
  }
  if (c.stopLoss !== null && (!isCents(c.stopLoss) || c.stopLoss < 0 || c.stopLoss >= c.startBankroll)) {
    e.push("stopLoss must be an integer floor in [0, startBankroll).");
  }
  if (!Number.isInteger(c.maxRounds) || c.maxRounds < 1 || c.maxRounds > MAX_ROUNDS_CAP) {
    e.push(`maxRounds must be an integer in 1..${MAX_ROUNDS_CAP}.`);
  }
  if (c.insufficientFunds !== "stop" && c.insufficientFunds !== "allIn") {
    e.push('insufficientFunds must be "stop" or "allIn".');
  }
  return e;
}
