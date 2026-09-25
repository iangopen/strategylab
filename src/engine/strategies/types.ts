export type ConfigValue = number | boolean | string;
/** Plain JSON. A blank optionalNumber field is simply absent (undefined). */
export type StrategyConfig = Record<string, ConfigValue | undefined>;

export interface FieldSpec {
  key: string;
  label: string;
  /** optionalNumber: blank = undefined (the key is absent); otherwise a number within min/max. */
  kind: "number" | "integer" | "optionalNumber" | "boolean" | "select";
  min?: number;
  max?: number;
  step?: number;
  options?: readonly { value: string; label: string }[];
  help?: string;
  /** Applies only to win/lose games: the form disables it (with a note) on multi-outcome games. */
  binaryOnly?: boolean;
}

/** Read-only view of the session passed to strategies. Money in cents. */
export interface StrategyContext {
  readonly bankroll: number;
  readonly baseBet: number;
  /** Rounds completed so far (0 before the first bet). */
  readonly round: number;
  /** Bet actually placed last round after table rules, or null before the first bet. */
  readonly lastBet: number | null;
  /**
   * The game the session is played on. Read-only, filled by the runner. Kelly and Oscar's Grind
   * size bets from the payout; reading it never touches the RNG, so it does not affect CRN.
   */
  readonly game: {
    readonly winProb: number;
    readonly netPayout: number;
    /** House edge = 1 − winProb × (1 + netPayout). Negative means the player has the edge. */
    readonly edge: number;
    /** Every outcome, in draw order (binary games: [{ p, n }, { 1 - p, -1 }]). */
    readonly outcomes: readonly { readonly prob: number; readonly net: number; readonly label?: string }[];
  };
}

/**
 * What a resolved round meant for the bettor (session 13). `profit` is the EXACT profit of the round in
 * fractional cents: ctx.lastBet × the outcome's net (the bankroll moved by the same amount give or take
 * the sub-cent carry). kind follows its sign: "win" > 0, "loss" < 0, "push" = 0. The runner never calls
 * update on a push, so strategies only ever see "win" or "loss".
 */
export interface RoundResult {
  readonly kind: "win" | "loss" | "push";
  /** Index of the drawn outcome in ctx.game.outcomes (binary games: 0 = win, 1 = loss). */
  readonly outcomeIndex: number;
  readonly profit: number;
}

/**
 * Strategies are PURE: never mutate inputs, no side effects, never touch the RNG.
 * Table limits and bankroll checks are the runner's job, not the strategy's.
 */
export interface Strategy<Config extends StrategyConfig, State> {
  id: string;
  label: string;
  description: string;
  configSchema: readonly FieldSpec[];
  defaultConfig: Config;
  init(config: Config, ctx: StrategyContext): State;
  /** Desired bet in cents (the runner rounds it), or "stop" to end the session. */
  nextBet(state: State, ctx: StrategyContext): number | "stop";
  /**
   * Called after each resolved round EXCEPT a push (state is unchanged across a push); ctx is the
   * post-round view (lastBet = the bet just placed).
   */
  update(state: State, result: RoundResult, ctx: StrategyContext): State;
}

// Method syntax above makes parameters bivariant, so any concrete strategy fits here.
export type AnyStrategy = Strategy<StrategyConfig, unknown>;
