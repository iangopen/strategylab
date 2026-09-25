import { isBinary, type Outcome } from "../games";
import type { Strategy } from "./types";

/** assumedWinProb absent (blank) = use the game's true win probability. */
type KellyConfig = { assumedWinProb?: number; fraction: number };
type KellyState = {
  /** Play only when the Kelly fraction is positive; otherwise the strategy says do not bet. */
  readonly play: boolean;
  /** fraction × f*, the share of the current bankroll to stake each round (constant per session). */
  readonly sizeFraction: number;
};

/** Bisection steps for the generalized criterion: fixed, so the result is deterministic. */
export const KELLY_BISECTION_STEPS = 200;

/**
 * The generalized Kelly fraction: the f that maximizes G(f) = sum(prob x log(1 + f x net)) over
 * 0 <= f < f_max, f_max = 1 / (-min net) when some outcome loses money. G is concave, so this bisects
 * on G'(f) = sum(prob x net / (1 + f x net)), which is decreasing. G'(0) = -edge: if it is <= 0 the
 * answer is 0 (do not play). If NO outcome loses money G grows without bound, and f* is capped at 1
 * (the whole bankroll). Pure and deterministic (KELLY_BISECTION_STEPS iterations).
 */
export function kellyFraction(outcomes: readonly Pick<Outcome, "prob" | "net">[]): number {
  const slope = (f: number) => {
    let d = 0;
    for (const o of outcomes) d += (o.prob * o.net) / (1 + f * o.net);
    return d;
  };
  if (!(slope(0) > 0)) return 0;
  let minNet = 0;
  for (const o of outcomes) if (o.net < minNet) minNet = o.net;
  if (minNet >= 0) return 1;
  let lo = 0;
  let hi = 1 / -minNet;
  for (let i = 0; i < KELLY_BISECTION_STEPS; i++) {
    const mid = (lo + hi) / 2;
    if (slope(mid) > 0) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * Kelly. On a win/lose game: f* = (b·p − q) / b, with b = netPayout, p = assumed win probability,
 * q = 1 − p (the closed form, kept so every binary result stays bit-identical). On any other game
 * (several outcomes, pushes, partial losses): the generalized criterion, kellyFraction. If f* ≤ 0,
 * Kelly says do not play — the session ends immediately (strategyStop). Otherwise bet
 * fraction × f* × current bankroll. f* depends only on the game, so it is computed once at init; only
 * the bankroll changes round to round. A stake above the bankroll (fraction > 1, or f* > 1 on a game
 * whose worst outcome loses less than the stake) is handled by the runner like any other bet.
 *
 * `assumedWinProb` is the probability KELLY BELIEVES, not a real one: setting it above the game's
 * true win probability models a MISJUDGED edge and still loses money on a negative-edge game. It
 * applies ONLY to win/lose games; on multi-outcome games it is ignored (the field is disabled there).
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
      kind: "optionalNumber",
      min: 0.01,
      max: 0.99,
      step: 0.01,
      help: "The win probability Kelly assumes when sizing bets. Blank = use the game's true probability. Setting it ABOVE the true probability models a MISJUDGED edge, not a real one — it still loses money on a negative-edge game.",
      binaryOnly: true,
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
  defaultConfig: { fraction: 1 },
  init: (config, ctx) => {
    let fStar: number;
    if (isBinary(ctx.game)) {
      const b = ctx.game.netPayout;
      // Blank (absent) means "use the game's true win probability".
      const p = config.assumedWinProb ?? ctx.game.winProb;
      const q = 1 - p;
      fStar = (b * p - q) / b;
    } else {
      fStar = kellyFraction(ctx.game.outcomes); // assumedWinProb does not apply here
    }
    return fStar > 0 ? { play: true, sizeFraction: config.fraction * fStar } : { play: false, sizeFraction: 0 };
  },
  nextBet: (state, ctx) => (state.play ? state.sizeFraction * ctx.bankroll : "stop"),
  update: (state) => state,
};
