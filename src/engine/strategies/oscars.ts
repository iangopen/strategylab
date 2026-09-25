import type { Strategy } from "./types";

type OscarsConfig = Record<string, never>;
type OscarsState = {
  /** Profit booked so far in the current cycle, in cents (can be negative). */
  readonly cycleProfit: number;
  /** Bet size in base units; raised by one only after a win that does not complete the cycle. */
  readonly betUnits: number;
};

/**
 * Oscar's Grind: aim for +1 base unit of profit per cycle. Raise the bet by one unit after a win
 * (never after a loss), but never bet more than what a single win needs to reach the goal, so the
 * cycle closes at exactly +1 unit. Profit is tracked from the PLACED bet (ctx.lastBet, after table
 * rules): cycle profit adds the round's exact profit (result.profit = placed bet × the outcome's net),
 * never the intended bet. The cap reads ctx.game.netPayout, which on a multi-outcome game is the
 * probability-weighted mean net over winning outcomes: an APPROXIMATION there (a win may pay more or
 * less, so a cycle can close above or below exactly +1 unit).
 */
export const oscars: Strategy<OscarsConfig, OscarsState> = {
  id: "oscars",
  label: "Oscar's Grind",
  description:
    "Aims to grind out one base bet of profit per cycle: raise the bet by one unit after each win, hold it after a loss, and never bet more than the win needed to close the cycle. Slow, shallow, with long grinds and the occasional deep hole.",
  configSchema: [],
  defaultConfig: {},
  init: () => ({ cycleProfit: 0, betUnits: 1 }),
  nextBet: (state, ctx) => {
    const goal = ctx.baseBet; // +1 base unit of profit
    // Smallest bet whose win reaches the goal: win adds bet x netPayout to profit.
    const capToGoal = Math.ceil((goal - state.cycleProfit) / ctx.game.netPayout);
    return Math.min(state.betUnits * ctx.baseBet, capToGoal);
  },
  update: (state, result, ctx) => {
    const goal = ctx.baseBet;
    // result.profit = the placed bet (after table rules) × the outcome's net: -placed on a total loss.
    if (result.kind !== "win") return { ...state, cycleProfit: state.cycleProfit + result.profit };
    const cycleProfit = state.cycleProfit + result.profit;
    if (cycleProfit >= goal) return { cycleProfit: 0, betUnits: 1 }; // cycle complete
    return { cycleProfit, betUnits: state.betUnits + 1 };
  },
};
