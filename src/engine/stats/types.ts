import type { Game } from "../games";
import type { SessionConfig } from "../types";
import type { Accumulator } from "./accumulator";

/** Read-only facts about the run, passed to every stat. Money in cents. */
export interface RunContext {
  readonly game: Readonly<Game>;
  /** edge(game): expected loss per unit staked. */
  readonly edge: number;
  readonly config: Readonly<SessionConfig>;
  readonly nSessions: number;
}

export interface StatDef {
  id: string;
  label: string;
  /** "money" values are in cents; the UI converts. "pct" values are fractions (0.05 = 5%). */
  format: "money" | "pct" | "ratio" | "int";
  emphasis?: boolean;
  /** Return NaN when undefined (e.g. nothing wagered); the UI shows a dash. */
  compute(acc: Accumulator, ctx: RunContext): number;
}
