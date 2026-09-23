import type { AnyStrategy } from "./types";
import { flat } from "./flat";
import { martingale } from "./martingale";

// The ONE place strategies are registered. A new strategy = one file + one line here.
export const STRATEGIES: readonly AnyStrategy[] = [
  flat,
  martingale,
];

export function getStrategy(id: string): AnyStrategy | undefined {
  return STRATEGIES.find((s) => s.id === id);
}
