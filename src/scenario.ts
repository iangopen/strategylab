// The ONE serializable object that holds all scenario state (plain JSON), so URL sharing stays trivial.
// Money here is in DOLLARS as the user types it; toSimRequest converts to engine cents.
import { CUSTOM_GAME_ID, findPreset, validateGame } from "./engine/games";
import { MAX_SESSIONS } from "./engine/montecarlo";
import { sportsGame, type SportsInput } from "./engine/odds";
import { formatRuleError, validateRule } from "./engine/rules/validate";
import { getStrategy } from "./engine/strategies/registry";
import type { StrategyConfig } from "./engine/strategies/types";
import { validateStrategyConfig } from "./engine/strategies/validate";
import { DEFAULT_MAX_ROUNDS, MAX_ROUNDS_CAP } from "./engine/types";
import type { StrategyRef } from "./worker/resolve";
import type { SimRequest } from "./worker/sim.worker";

/** A registered strategy with its config. */
export interface BuiltinInstance {
  /** Stable id so the same strategy can be added more than once. */
  uid: string;
  kind: "builtin";
  strategyId: string;
  config: StrategyConfig;
}

/** A user-defined rule, stored as plain JSON DATA (see "Rule language"); compiled only in the worker. */
export interface CustomInstance {
  uid: string;
  kind: "custom";
  /** Untrusted until validated: may be anything the user pasted. */
  rule: unknown;
}

export type StrategyInstance = BuiltinInstance | CustomInstance;

export const SCENARIO_VERSION = 3;

/** Game preset id for sports odds (session 8). The odds inputs compile to an ordinary Game. */
export const SPORTS_GAME_ID = "sports";

export interface ScenarioGame {
  /** A preset id, "custom", or "sports". */
  presetId: string;
  /** For sports games these two are DERIVED from `sports` (re-synced on every edit and load). */
  winProb: number;
  netPayout: number;
  /** Sports odds inputs: present exactly when presetId is "sports". The source of truth. */
  sports?: SportsInput;
}

export interface ScenarioConfig {
  version: 3;
  game: ScenarioGame;
  startBankroll: number;
  baseBet: number;
  tableMin: number;
  /** null = no table maximum. */
  tableMax: number | null;
  /** Session ends when bankroll >= this. null = off. */
  stopWin: number | null;
  /** Floor: session ends when bankroll <= this. null = off. */
  stopLoss: number | null;
  maxRounds: number;
  insufficientFunds: "stop" | "allIn";
  sessions: number;
  seed: number;
  strategies: StrategyInstance[];
}

export const MAX_SEED = 0xffffffff;
/** At most this many strategy instances per scenario (one per palette color; bounds a shared link). */
export const MAX_STRATEGIES = 8;

let uidCounter = 0;
export function newUid(): string {
  uidCounter++;
  return `s${Date.now().toString(36)}${uidCounter.toString(36)}`;
}

export function newStrategyInstance(strategyId: string): BuiltinInstance {
  const strategy = getStrategy(strategyId);
  if (!strategy) throw new Error(`Unknown strategy "${strategyId}"`);
  return { uid: newUid(), kind: "builtin", strategyId, config: { ...strategy.defaultConfig } };
}

/** A custom-rule instance holding a plain (unfrozen) JSON copy of the rule. */
export function newCustomInstance(rule: unknown): CustomInstance {
  return { uid: newUid(), kind: "custom", rule: JSON.parse(JSON.stringify(rule)) as unknown };
}

/**
 * The first run a new user sees: Flat vs Martingale x2 with a $1,100 win target, so Martingale's
 * high P(profit) sits next to the SAME negative EV per $ wagered. That contrast is the core lesson.
 */
export function defaultScenario(): ScenarioConfig {
  const european = findPreset("european")!;
  return {
    version: 3,
    game: { presetId: european.id, winProb: european.winProb, netPayout: european.netPayout },
    startBankroll: 1000,
    baseBet: 10,
    tableMin: 1,
    tableMax: null,
    stopWin: 1100,
    stopLoss: null,
    maxRounds: DEFAULT_MAX_ROUNDS,
    insufficientFunds: "stop",
    sessions: 10_000,
    seed: 12345,
    strategies: [newStrategyInstance("flat"), { ...newStrategyInstance("martingale"), config: { multiplier: 2 } }],
  };
}

export const toCents = (dollars: number): number => Math.round(dollars * 100);

/** The first sports market a user sees: -110 / -110 (a common two-way price), betting side A. */
export function defaultSportsInput(): SportsInput {
  return { mode: "market", format: "american", sideA: -110, sideB: -110, side: "a", estimate: 0.5 };
}

/**
 * A sports game with winProb / netPayout re-derived from its odds inputs. When the inputs are
 * invalid the previous numbers are kept (validation reports the inputs, and Run stays blocked).
 */
export function sportsScenarioGame(sports: SportsInput, previous?: Pick<ScenarioGame, "winProb" | "netPayout">): ScenarioGame {
  const r = sportsGame(sports);
  const base = previous ?? { winProb: 0.5, netPayout: 1 };
  return r.ok ? { presetId: SPORTS_GAME_ID, winProb: r.winProb, netPayout: r.netPayout, sports } : { presetId: SPORTS_GAME_ID, winProb: base.winProb, netPayout: base.netPayout, sports };
}

/**
 * Errors keyed by field: top-level keys ("startBankroll", "game"), or
 * "strategy:<uid>:<fieldKey>" for strategy config fields. Empty object = valid.
 */
export function validateScenario(s: ScenarioConfig): Record<string, string> {
  const e: Record<string, string> = {};
  const money = (v: number) => Number.isFinite(v) && toCents(v) >= 1;

  if (s.game.presetId === SPORTS_GAME_ID) {
    // The odds inputs are the source of truth: errors are keyed per input (game.sideA, ...).
    if (!s.game.sports) e.game = "Sports odds are missing.";
    else {
      const r = sportsGame(s.game.sports);
      if (!r.ok) for (const [k, msg] of Object.entries(r.errors)) e[`game.${k}`] = msg;
      else if (r.winProb !== s.game.winProb || r.netPayout !== s.game.netPayout) e.game = "The game's probability and payout are out of date with its odds.";
      else {
        const gameErrors = validateGame(s.game);
        if (gameErrors.length > 0) e.game = gameErrors.join(" ");
      }
    }
  } else {
    const gameErrors = validateGame(s.game);
    if (gameErrors.length > 0) e.game = gameErrors.join(" ");
    if (s.game.presetId !== CUSTOM_GAME_ID && !findPreset(s.game.presetId)) e.game = "Unknown game preset.";
    if (s.game.sports !== undefined) e.game = "Only a sports game has odds inputs.";
  }

  if (!money(s.startBankroll)) e.startBankroll = "Must be at least $0.01.";
  if (!money(s.baseBet)) e.baseBet = "Must be at least $0.01.";
  if (!money(s.tableMin)) e.tableMin = "Must be at least $0.01.";
  if (s.tableMax !== null && !(Number.isFinite(s.tableMax) && toCents(s.tableMax) >= toCents(s.tableMin))) {
    e.tableMax = "Must be at least the table minimum (or blank for no limit).";
  }
  if (s.stopWin !== null && !(Number.isFinite(s.stopWin) && toCents(s.stopWin) > toCents(s.startBankroll))) {
    e.stopWin = "Must be above the starting bankroll (or blank for off).";
  }
  if (s.stopLoss !== null && !(Number.isFinite(s.stopLoss) && s.stopLoss >= 0 && toCents(s.stopLoss) < toCents(s.startBankroll))) {
    e.stopLoss = "Floor must be at least $0 and below the starting bankroll (or blank for off).";
  }
  if (!Number.isInteger(s.maxRounds) || s.maxRounds < 1 || s.maxRounds > MAX_ROUNDS_CAP) {
    e.maxRounds = `Whole number from 1 to ${MAX_ROUNDS_CAP.toLocaleString("en-US")}.`;
  }
  if (!Number.isInteger(s.sessions) || s.sessions < 1 || s.sessions > MAX_SESSIONS) {
    e.sessions = `Whole number from 1 to ${MAX_SESSIONS.toLocaleString("en-US")}.`;
  }
  if (!Number.isInteger(s.seed) || s.seed < 0 || s.seed > MAX_SEED) e.seed = `Whole number from 0 to ${MAX_SEED}.`;

  if (s.strategies.length === 0) e.strategies = "Add at least one strategy.";
  else if (s.strategies.length > MAX_STRATEGIES) e.strategies = `At most ${MAX_STRATEGIES} strategies.`;
  for (const inst of s.strategies) {
    if (inst.kind === "custom") {
      // The SAME validator the worker runs before compiling.
      const r = validateRule(inst.rule);
      if (!r.ok) e[`strategy:${inst.uid}:rule`] = r.errors.map(formatRuleError).join("\n");
      continue;
    }
    const strategy = getStrategy(inst.strategyId);
    if (!strategy) {
      e[`strategy:${inst.uid}`] = `Unknown strategy "${inst.strategyId}".`;
      continue;
    }
    for (const [key, msg] of Object.entries(validateStrategyConfig(strategy, inst.config))) {
      e[`strategy:${inst.uid}:${key}`] = msg;
    }
  }
  return e;
}

/** Converts a VALID scenario into the worker request (dollars -> integer cents). */
export function toSimRequest(s: ScenarioConfig): SimRequest {
  const preset = findPreset(s.game.presetId);
  return {
    // Sports odds compile to an ordinary Game: nothing downstream knows about odds.
    game:
      preset ??
      (s.game.presetId === SPORTS_GAME_ID
        ? { id: SPORTS_GAME_ID, name: "Sports odds", winProb: s.game.winProb, netPayout: s.game.netPayout }
        : { id: CUSTOM_GAME_ID, name: "Custom", winProb: s.game.winProb, netPayout: s.game.netPayout }),
    strategies: s.strategies.map((i): StrategyRef => (i.kind === "custom" ? { kind: "custom", rule: i.rule } : { kind: "builtin", strategyId: i.strategyId, config: i.config })),
    session: {
      startBankroll: toCents(s.startBankroll),
      baseBet: toCents(s.baseBet),
      tableMin: toCents(s.tableMin),
      tableMax: s.tableMax === null ? null : toCents(s.tableMax),
      stopWin: s.stopWin === null ? null : toCents(s.stopWin),
      stopLoss: s.stopLoss === null ? null : toCents(s.stopLoss),
      maxRounds: s.maxRounds,
      insufficientFunds: s.insufficientFunds,
    },
    nSessions: s.sessions,
    masterSeed: s.seed,
  };
}

/** Version 2 scenarios (custom rules, before sports odds): the game had no odds inputs. */
export interface ScenarioConfigV2 extends Omit<ScenarioConfig, "version" | "game"> {
  version: 2;
  game: { presetId: string; winProb: number; netPayout: number };
}

/** Version 1 scenarios (before custom rules): every strategy instance was a built-in, without `kind`. */
export interface ScenarioConfigV1 extends Omit<ScenarioConfigV2, "version" | "strategies"> {
  version: 1;
  strategies: { uid: string; strategyId: string; config: StrategyConfig }[];
}

/**
 * Upgrades an older scenario to the current version. Not a parser for untrusted input (session 7's
 * URL loader validates first); it only reshapes known older versions.
 *   v1 -> v2: strategy instances gain kind "builtin"; Kelly's assumedWinProb 0 (the old "use the
 *   true probability" sentinel) becomes blank, i.e. the key is removed (optionalNumber field).
 *   v2 -> v3: version only. v2 games (presets and custom) are unchanged; sports odds are new in v3.
 */
export function migrateScenario(s: ScenarioConfigV1 | ScenarioConfigV2 | ScenarioConfig): ScenarioConfig {
  if (s.version === SCENARIO_VERSION) return s;
  const v2: ScenarioConfigV2 =
    s.version === 2
      ? s
      : {
          ...s,
          version: 2,
          strategies: s.strategies.map((i): BuiltinInstance => ({ uid: i.uid, kind: "builtin", strategyId: i.strategyId, config: migrateConfigV1(i.strategyId, i.config) })),
        };
  return { ...v2, version: 3 };
}

function migrateConfigV1(strategyId: string, config: StrategyConfig): StrategyConfig {
  if (strategyId === "kelly" && config.assumedWinProb === 0) {
    const { assumedWinProb: _sentinel, ...rest } = config;
    return rest;
  }
  return { ...config };
}
