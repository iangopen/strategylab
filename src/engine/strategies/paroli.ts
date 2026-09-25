import type { Strategy } from "./types";

type ParoliConfig = { streakCap: number };
type ParoliState = { readonly streakCap: number; readonly wins: number };

/**
 * Paroli (reverse Martingale): bet = base × 2^wins. Win: wins + 1, back to 0 once it
 * reaches streakCap. Loss: back to 0. The largest bet is base × 2^(streakCap - 1).
 */
export const paroli: Strategy<ParoliConfig, ParoliState> = {
  id: "paroli",
  label: "Paroli",
  description:
    "Doubles the bet after each win, up to a streak cap, then returns to the base bet; any loss returns to the base bet. Many small losses, with occasional streak wins.",
  configSchema: [
    { key: "streakCap", label: "Wins before reset", kind: "integer", min: 1, max: 10, step: 1, help: "After this many wins in a row, go back to the base bet." },
  ],
  defaultConfig: { streakCap: 3 },
  init: (config) => ({ streakCap: config.streakCap, wins: 0 }),
  nextBet: (state, ctx) => ctx.baseBet * 2 ** state.wins,
  update: (state, result) => {
    if (result.kind !== "win") return { ...state, wins: 0 };
    const wins = state.wins + 1;
    return { ...state, wins: wins >= state.streakCap ? 0 : wins };
  },
};
