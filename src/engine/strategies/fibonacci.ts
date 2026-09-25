import type { Strategy } from "./types";

type FibonacciConfig = Record<string, never>;
type FibonacciState = { readonly step: number };

/** fib(0) = fib(1) = 1, fib(n) = fib(n-1) + fib(n-2). Stops early once past `cap`. */
export function fib(step: number, cap = Number.MAX_SAFE_INTEGER): number {
  let a = 1;
  let b = 1;
  for (let i = 1; i < step; i++) {
    [a, b] = [b, a + b];
    if (b > cap) return cap;
  }
  return step === 0 ? a : Math.min(b, cap);
}

/**
 * Fibonacci: bet = base × fib(step). Loss: step + 1. Win: step - 2, never below 0.
 */
export const fibonacci: Strategy<FibonacciConfig, FibonacciState> = {
  id: "fibonacci",
  label: "Fibonacci",
  description:
    "Moves one step up the Fibonacci sequence (1, 1, 2, 3, 5, 8, …) × base bet after a loss and two steps back after a win. Grows more slowly than Martingale.",
  configSchema: [],
  defaultConfig: {},
  init: () => ({ step: 0 }),
  // Capped only against float overflow on very long losing streaks; the runner still applies
  // tableMax and bankroll checks to the result.
  nextBet: (state, ctx) => Math.min(ctx.baseBet * fib(state.step), Number.MAX_SAFE_INTEGER),
  update: (state, result) => ({ step: result.kind === "win" ? Math.max(0, state.step - 2) : state.step + 1 }),
};
