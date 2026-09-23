import type { AnyStrategy } from "./types";
import { dalembert } from "./dalembert";
import { fibonacci } from "./fibonacci";
import { flat } from "./flat";
import { labouchere } from "./labouchere";
import { martingale } from "./martingale";
import { oscars } from "./oscars";
import { paroli } from "./paroli";

// The ONE place strategies are registered. A new strategy = one file + one line here.
export const STRATEGIES: readonly AnyStrategy[] = [
  flat,
  martingale,
  paroli,
  dalembert,
  fibonacci,
  labouchere,
  oscars,
];

export function getStrategy(id: string): AnyStrategy | undefined {
  return STRATEGIES.find((s) => s.id === id);
}
