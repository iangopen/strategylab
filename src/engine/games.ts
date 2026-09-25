// Games (see "Multi-outcome games" in CLAUDE.md). A game is a list of 1-12 outcomes { prob, net },
// where net = profit per $1 staked (-1 = stake lost, 0 = push, 1 = even money; gross return = 1 + net).
// The binary shorthand { winProb, netPayout } is exactly [{ prob: p, net: n }, { prob: 1 - p, net: -1 }]
// with p and n untouched, so every binary game (presets, custom, sports) stays bit-identical.

export interface Outcome {
  /** Probability of this outcome, > 0. */
  readonly prob: number;
  /** Profit per $1 staked: -1 = stake lost, 0 = push, 1 = even-money win. At least -1. */
  readonly net: number;
  /** Shown in the replay strip and the editor. */
  readonly label?: string;
}

/**
 * The binary shorthand: one winning outcome (net = netPayout) and a total loss. Named `Game` for
 * compatibility (every binary preset, custom and sports game, and every existing test, uses it).
 */
export interface Game {
  id: string;
  name: string;
  /** Probability a single bet wins, strictly between 0 and 1. */
  winProb: number;
  /** Profit per unit staked on a win (even money = 1). */
  netPayout: number;
}

/** A game given as its full list of outcomes, in the order the draw maps them. */
export interface OutcomesGame {
  id: string;
  name: string;
  outcomes: readonly Outcome[];
}

/** Any game the engine accepts: the binary shorthand or a full outcome list. */
export type AnyGame = Game | OutcomesGame;

/** Anything with a game's numbers: a Game, or a scenario's game (which also carries an id). */
export type GameNumbers = Pick<Game, "winProb" | "netPayout"> | { outcomes: readonly Outcome[] };

export const MAX_OUTCOMES = 12;
/** Probabilities must sum to 1 within this. */
export const PROB_SUM_TOLERANCE = 1e-9;

export const GAME_PRESETS: readonly Game[] = [
  { id: "european", name: "European roulette (even-money)", winProb: 18 / 37, netPayout: 1 },
  { id: "american", name: "American roulette (even-money)", winProb: 18 / 38, netPayout: 1 },
  { id: "fairCoin", name: "Fair coin", winProb: 0.5, netPayout: 1 },
];

export const CUSTOM_GAME_ID = "custom";

function isOutcomes(g: GameNumbers): g is { outcomes: readonly Outcome[] } {
  return "outcomes" in g && Array.isArray((g as { outcomes: unknown }).outcomes);
}

/** A game's outcomes. The binary shorthand becomes [{ prob: p, net: n }, { prob: 1 - p, net: -1 }]. */
export function outcomesOf(game: GameNumbers): readonly Outcome[] {
  if (isOutcomes(game)) return game.outcomes;
  return [
    { prob: game.winProb, net: game.netPayout },
    { prob: 1 - game.winProb, net: -1 },
  ];
}

/**
 * True for the legacy binary shape: exactly two outcomes, the first a win (net > 0), the second a total
 * loss (net = -1). Kelly keeps its closed form on these, so their results stay bit-identical.
 */
export function isBinary(game: GameNumbers): boolean {
  const o = outcomesOf(game);
  return o.length === 2 && o[0]!.net > 0 && o[1]!.net === -1;
}

/**
 * House edge: expected loss per unit staked, 1 - sum(prob x (1 + net)). Negative = player edge. For a
 * binary game the loss term is (1 - p) x 0 = 0, so this equals the old 1 - p(1 + n) bit for bit.
 */
export function edge(game: GameNumbers): number {
  if (!isOutcomes(game)) return 1 - game.winProb * (1 + game.netPayout);
  let r = 0;
  for (const o of game.outcomes) r += o.prob * (1 + o.net);
  return 1 - r;
}

/**
 * The legacy ctx.game fields. winProb = P(profit > 0). netPayout = the single winning outcome's net
 * (bit-exact for binary games), else the probability-weighted mean net over the winning outcomes (an
 * APPROXIMATION for multi-outcome games; Oscar's Grind uses it). No winning outcome: both 0.
 */
export function legacyView(game: GameNumbers): { winProb: number; netPayout: number } {
  if (!isOutcomes(game)) return { winProb: game.winProb, netPayout: game.netPayout };
  const wins = game.outcomes.filter((o) => o.net > 0);
  if (wins.length === 0) return { winProb: 0, netPayout: 0 };
  if (wins.length === 1) return { winProb: wins[0]!.prob, netPayout: wins[0]!.net };
  let p = 0;
  let pn = 0;
  for (const o of wins) {
    p += o.prob;
    pn += o.prob * o.net;
  }
  return { winProb: p, netPayout: pn / p };
}

/** Returns a list of problems; empty means valid. Never throws. */
export function validateGame(game: GameNumbers): string[] {
  const errors: string[] = [];
  if (!isOutcomes(game)) {
    if (!Number.isFinite(game.winProb) || !(game.winProb > 0 && game.winProb < 1)) {
      errors.push("Win probability must be strictly between 0 and 1.");
    }
    if (!Number.isFinite(game.netPayout) || !(game.netPayout > 0)) {
      errors.push("Net payout must be greater than 0.");
    }
    return errors;
  }
  const o = game.outcomes;
  if (o.length < 1 || o.length > MAX_OUTCOMES) {
    errors.push(`A game needs 1 to ${MAX_OUTCOMES} outcomes (got ${o.length}).`);
    return errors;
  }
  let sum = 0;
  o.forEach((x, i) => {
    const at = `Outcome ${i + 1}`;
    if (typeof x !== "object" || x === null) {
      errors.push(`${at}: not an outcome.`);
      return;
    }
    if (typeof x.prob !== "number" || !Number.isFinite(x.prob) || !(x.prob > 0)) errors.push(`${at}: probability must be a number greater than 0.`);
    else sum += x.prob;
    if (typeof x.net !== "number" || !Number.isFinite(x.net) || !(x.net >= -1)) errors.push(`${at}: the return must be at least 0 (net profit at least -1 per $1 staked).`);
  });
  if (errors.length === 0 && !(Math.abs(sum - 1) <= PROB_SUM_TOLERANCE)) errors.push(`Probabilities must add up to 1 (they add up to ${sum}).`);
  return errors;
}

export function findPreset(id: string): Game | undefined {
  return GAME_PRESETS.find((g) => g.id === id);
}
