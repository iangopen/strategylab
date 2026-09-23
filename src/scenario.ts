// The ONE serializable object that holds all scenario state (plain JSON), so URL sharing stays trivial.
// Money here is in DOLLARS as the user types it; toSimRequest converts to engine cents.
import { CUSTOM_GAME_ID, findPreset, validateGame } from "./engine/games";
import { MAX_SESSIONS } from "./engine/montecarlo";
import { getStrategy, STRATEGIES } from "./engine/strategies/registry";
import type { StrategyConfig } from "./engine/strategies/types";
import { validateStrategyConfig } from "./engine/strategies/validate";
import { DEFAULT_MAX_ROUNDS, MAX_ROUNDS_CAP } from "./engine/types";
import type { SimRequest } from "./worker/sim.worker";

export interface StrategyInstance {
  /** Stable id so the same strategy can be added more than once. */
  uid: string;
  strategyId: string;
  config: StrategyConfig;
}

export interface ScenarioConfig {
  version: 1;
  game: { presetId: string; winProb: number; netPayout: number };
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

let uidCounter = 0;
export function newUid(): string {
  uidCounter++;
  return `s${Date.now().toString(36)}${uidCounter.toString(36)}`;
}

export function newStrategyInstance(strategyId: string): StrategyInstance {
  const strategy = getStrategy(strategyId);
  if (!strategy) throw new Error(`Unknown strategy "${strategyId}"`);
  return { uid: newUid(), strategyId, config: { ...strategy.defaultConfig } };
}

export function defaultScenario(): ScenarioConfig {
  const european = findPreset("european")!;
  return {
    version: 1,
    game: { presetId: european.id, winProb: european.winProb, netPayout: european.netPayout },
    startBankroll: 1000,
    baseBet: 10,
    tableMin: 1,
    tableMax: null,
    stopWin: null,
    stopLoss: null,
    maxRounds: DEFAULT_MAX_ROUNDS,
    insufficientFunds: "stop",
    sessions: 10_000,
    seed: 12345,
    strategies: [newStrategyInstance(STRATEGIES[0]!.id)],
  };
}

export const toCents = (dollars: number): number => Math.round(dollars * 100);

/**
 * Errors keyed by field: top-level keys ("startBankroll", "game"), or
 * "strategy:<uid>:<fieldKey>" for strategy config fields. Empty object = valid.
 */
export function validateScenario(s: ScenarioConfig): Record<string, string> {
  const e: Record<string, string> = {};
  const money = (v: number) => Number.isFinite(v) && toCents(v) >= 1;

  const gameErrors = validateGame(s.game);
  if (gameErrors.length > 0) e.game = gameErrors.join(" ");
  if (s.game.presetId !== CUSTOM_GAME_ID && !findPreset(s.game.presetId)) e.game = "Unknown game preset.";

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
  for (const inst of s.strategies) {
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
    game: preset ?? { id: CUSTOM_GAME_ID, name: "Custom", winProb: s.game.winProb, netPayout: s.game.netPayout },
    strategies: s.strategies.map((i) => ({ strategyId: i.strategyId, config: i.config })),
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
