// Compiles a VALIDATED rule into the same Strategy contract as the built-ins. Pure data
// interpretation: a fixed switch over the closed grammar, no code generation of any kind.
// Compiled strategies are pure (new state objects only) and never touch the RNG.
import type { AnyStrategy, Strategy, StrategyContext } from "../strategies/types";
import { MAX_UNITS, MIN_UNITS } from "./limits";
import type { Action, Condition, Entry, ProgressionRule, Rule, SequenceRule } from "./types";
import { formatRuleError, validateRule } from "./validate";

/** Every compiled rule reports this strategy id; its label is the rule's name. */
export const CUSTOM_STRATEGY_ID = "custom";

type NoConfig = Record<string, never>;

interface ProgressionState {
  /** Units of the next bet (bet = baseBet × units). */
  readonly units: number;
  readonly winStreak: number;
  readonly lossStreak: number;
  /** Profit since the cycle began, in cents, from the PLACED bets. */
  readonly cycleProfit: number;
  readonly stopped: boolean;
  /** Starting bankroll (cents), copied from ctx at init for bankroll conditions. */
  readonly start: number;
}

interface SequenceState {
  /** Working line. IMMUTABLE: only slice/spread build the next one. */
  readonly line: readonly number[];
}

const clampUnits = (u: number) => Math.min(Math.max(u, MIN_UNITS), MAX_UNITS);

function holds(c: Condition, s: ProgressionState, ctx: StrategyContext): boolean {
  switch (c.type) {
    case "winStreak":
      return s.winStreak >= c.atLeast;
    case "lossStreak":
      return s.lossStreak >= c.atLeast;
    case "cycleProfit":
      return s.cycleProfit >= c.atLeast * ctx.baseBet;
    case "bankroll":
      // Integer cents × integer-ish pct: compare without dividing.
      return c.op === ">=" ? ctx.bankroll * 100 >= s.start * c.pct : ctx.bankroll * 100 <= s.start * c.pct;
    case "betUnits":
      return s.units >= c.atLeast;
  }
}

function apply(a: Action, s: ProgressionState, startUnits: number): ProgressionState {
  switch (a.type) {
    case "set":
      return { ...s, units: clampUnits(a.units) };
    case "multiply":
      return { ...s, units: clampUnits(s.units * a.by) };
    case "add":
      return { ...s, units: clampUnits(s.units + a.units) };
    case "reset":
      return { ...s, units: startUnits };
    case "resetCycle":
      return { ...s, units: startUnits, cycleProfit: 0, winStreak: 0, lossStreak: 0 };
    case "stop":
      return { ...s, stopped: true };
  }
}

/** First entry whose condition holds; the last entry has none, so one always matches. */
function firstMatch(entries: readonly Entry[], s: ProgressionState, ctx: StrategyContext): Entry {
  for (const e of entries) if (e.when === undefined || holds(e.when, s, ctx)) return e;
  return entries[entries.length - 1]!; // unreachable for a validated rule
}

function compileProgression(rule: ProgressionRule): Strategy<NoConfig, ProgressionState> {
  return {
    id: CUSTOM_STRATEGY_ID,
    label: rule.name,
    description: "A custom progression rule.",
    configSchema: [],
    defaultConfig: {},
    init: (_config, ctx) => ({ units: rule.startUnits, winStreak: 0, lossStreak: 0, cycleProfit: 0, stopped: false, start: ctx.bankroll }),
    // Capped only against float overflow, as in Martingale/Fibonacci; the runner applies table limits.
    nextBet: (state, ctx) => (state.stopped ? "stop" : Math.min(ctx.baseBet * state.units, Number.MAX_SAFE_INTEGER)),
    update: (state, won, ctx) => {
      if (state.stopped) return state;
      const placed = ctx.lastBet ?? 0; // the bet actually placed, after table rules
      const counted: ProgressionState = {
        ...state,
        winStreak: won ? state.winStreak + 1 : 0,
        lossStreak: won ? 0 : state.lossStreak + 1,
        // Exact winnings (fractional cents), as Oscar's Grind counts them. The runner pays whole cents with
        // a sub-cent carry, so over any stretch of rounds this is within 1 cent of the real bankroll change.
        cycleProfit: state.cycleProfit + (won ? placed * ctx.game.netPayout : -placed),
      };
      return apply(firstMatch(won ? rule.onWin : rule.onLoss, counted, ctx).then, counted, rule.startUnits);
    },
  };
}

function lineUnits(line: readonly number[]): number {
  return line.length === 1 ? line[0]! : line[0]! + line[line.length - 1]!;
}

function compileSequence(rule: SequenceRule): Strategy<NoConfig, SequenceState> {
  return {
    id: CUSTOM_STRATEGY_ID,
    label: rule.name,
    description: "A custom cancellation line.",
    configSchema: [],
    defaultConfig: {},
    init: () => ({ line: rule.line }),
    nextBet: (state, ctx) => (state.line.length === 0 ? "stop" : ctx.baseBet * lineUnits(state.line)),
    update: (state, won) => {
      if (state.line.length === 0) return state;
      if (!won) return { line: [...state.line, lineUnits(state.line)] };
      const next = state.line.length <= 2 ? [] : state.line.slice(1, -1);
      if (next.length > 0) return { line: next };
      return { line: rule.onComplete === "restart" ? rule.line : [] }; // cycle complete
    },
  };
}

/** Compiles a rule that has ALREADY been validated (validateRule's output). */
export function compileValidRule(rule: Rule): AnyStrategy {
  return (rule.kind === "progression" ? compileProgression(rule) : compileSequence(rule)) as AnyStrategy;
}

/** Validates untrusted input, then compiles it. Throws a readable Error listing every problem. */
export function compileRule(raw: unknown): AnyStrategy {
  const r = validateRule(raw);
  if (!r.ok) throw new Error(`Invalid custom rule: ${r.errors.map(formatRuleError).join("; ")}`);
  return compileValidRule(r.rule);
}
