import type { Strategy } from "./types";

type KellyConfig = { assumedWinProb: number; fraction: number };
type KellyState = {
  /** Play only when the Kelly fraction is positive; otherwise the strategy says do not bet. */
  readonly play: boolean;
  /** fraction × f*, the share of the current bankroll to stake each round (constant per session). */
  readonly sizeFraction: number;
};

/**
 * Kelly: f* = (b·p − q) / b, with b = netPayout, p = assumed win probability, q = 1 − p. If f* ≤ 0,
 * Kelly says do not play — the session ends immediately (strategyStop). Otherwise bet
 * fraction × f* × current bankroll. Because p, q and b are constant within a session, f* is
 * computed once at init; only the bankroll changes round to round.
 *
 * `assumedWinProb` is the probability KELLY BELIEVES, not a real one: setting it above the game's
 * true win probability models a MISJUDGED edge and still loses money on a negative-edge game.
 */
export const kelly: Strategy<KellyConfig, KellyState> = {
  id: "kelly",
  label: "Kelly",
  description:
    "Bets a fixed fraction of the current bankroll, sized by the Kelly criterion from an assumed win probability and the payout. With a true edge this maximises long-run growth; with no edge it refuses to bet.",
  configSchema: [
    {
      key: "assumedWinProb",
      label: "Assumed win probability",
      kind: "number",
      min: 0,
      max: 0.99,
      step: 0.01,
      help: "The win probability Kelly assumes when sizing bets. 0 = use the game's true probability. Setting it ABOVE the true probability models a MISJUDGED edge, not a real one — it still loses money on a negative-edge game.",
    },
    {
      key: "fraction",
      label: "Kelly fraction",
      kind: "number",
      min: 0.1,
      max: 2,
      step: 0.1,
      help: "Scales the Kelly stake: 1 = full Kelly, 0.5 = half Kelly (smaller swings), above 1 = over-betting.",
    },
  ],
  defaultConfig: { assumedWinProb: 0, fraction: 1 },
  init: (config, ctx) => {
    const b = ctx.game.netPayout;
    // 0 (or any non-positive) means "use the game's true win probability".
    const p = config.assumedWinProb > 0 ? config.assumedWinProb : ctx.game.winProb;
    const q = 1 - p;
    const fStar = (b * p - q) / b;
    return fStar > 0 ? { play: true, sizeFraction: config.fraction * fStar } : { play: false, sizeFraction: 0 };
  },
  nextBet: (state, ctx) => (state.play ? state.sizeFraction * ctx.bankroll : "stop"),
  update: (state) => state,
};
