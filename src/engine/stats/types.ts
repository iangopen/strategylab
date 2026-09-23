import type { Accumulator } from "./accumulator";

export interface StatDef {
  id: string;
  label: string;
  /** "money" values are in cents; the UI converts. "pct" values are fractions (0.05 = 5%). */
  format: "money" | "pct" | "ratio" | "int";
  emphasis?: boolean;
  /** Return NaN when undefined (e.g. nothing wagered); the UI shows a dash. */
  compute(acc: Accumulator): number;
}
