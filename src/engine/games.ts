export interface Game {
  id: string;
  name: string;
  /** Probability a single bet wins, strictly between 0 and 1. */
  winProb: number;
  /** Profit per unit staked on a win (even money = 1). */
  netPayout: number;
}

export const GAME_PRESETS: readonly Game[] = [
  { id: "european", name: "European roulette (even-money)", winProb: 18 / 37, netPayout: 1 },
  { id: "american", name: "American roulette (even-money)", winProb: 18 / 38, netPayout: 1 },
  { id: "fairCoin", name: "Fair coin", winProb: 0.5, netPayout: 1 },
];

export const CUSTOM_GAME_ID = "custom";

/** House edge: expected loss per unit staked. Negative means the player has the edge. */
export function edge(game: Pick<Game, "winProb" | "netPayout">): number {
  return 1 - game.winProb * (1 + game.netPayout);
}

/** Returns a list of problems; empty means valid. */
export function validateGame(game: Pick<Game, "winProb" | "netPayout">): string[] {
  const errors: string[] = [];
  if (!Number.isFinite(game.winProb) || !(game.winProb > 0 && game.winProb < 1)) {
    errors.push("Win probability must be strictly between 0 and 1.");
  }
  if (!Number.isFinite(game.netPayout) || !(game.netPayout > 0)) {
    errors.push("Net payout must be greater than 0.");
  }
  return errors;
}

export function findPreset(id: string): Game | undefined {
  return GAME_PRESETS.find((g) => g.id === id);
}
