import type { Strategy } from "./types";

type MartingaleConfig = { multiplier: number };
type MartingaleState = { readonly multiplier: number; readonly level: number };

/**
 * Martingale: bet = base × multiplier^level. Loss: level + 1. Win: level back to 0.
 * The level lives in state, never derived from ctx.lastBet, so a tableMax clamp
 * (applied by the runner) cannot silently rewrite the progression.
 */
export const martingale: Strategy<MartingaleConfig, MartingaleState> = {
  id: "martingale",
  label: "Martingale",
  description:
    "Multiplies the bet after every loss and returns to the base bet after a win. Many small wins, with a rare loss of a long streak's worth of bets.",
  configSchema: [
    { key: "multiplier", label: "Multiplier after a loss", kind: "number", min: 1.1, max: 10, step: 0.1, help: "Classic Martingale doubles (2)." },
  ],
  defaultConfig: { multiplier: 2 },
  init: (config) => ({ multiplier: config.multiplier, level: 0 }),
  // Capped only against float overflow: a long enough streak would make multiplier^level
  // Infinity, which the runner rejects. The runner still applies tableMax and bankroll checks.
  nextBet: (state, ctx) => Math.min(ctx.baseBet * state.multiplier ** state.level, Number.MAX_SAFE_INTEGER),
  update: (state, result) => ({ ...state, level: result.kind === "win" ? 0 : state.level + 1 }),
};
