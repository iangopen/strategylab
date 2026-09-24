// The compact payload of a scenario link: short keys and positional rule entries (documented in
// CLAUDE.md "URL scenario format"). Encoding is lossless: fields are omitted ONLY when they equal
// their documented default, numbers keep full precision. Expansion treats the payload as
// UNTRUSTED: it reads own properties only, never recurses beyond the known shape, and every custom
// rule it rebuilds goes through the session 6 validator.
import { CUSTOM_GAME_ID, findPreset } from "../engine/games";
import { RULE_LIMITS } from "../engine/rules/limits";
import type { Action, Condition, Entry, Rule } from "../engine/rules/types";
import { describeValue, formatRuleError, validateRule } from "../engine/rules/validate";
import { getStrategy } from "../engine/strategies/registry";
import type { StrategyConfig } from "../engine/strategies/types";
import { MAX_STRATEGIES, type ScenarioConfig } from "../scenario";
import { MAX_REPORTED_UNKNOWN_KEYS } from "./limits";

/** A field the link carried but that could not be loaded, and why. */
export interface Dropped {
  field: string;
  message: string;
}

/** Top-level key map: short key -> ScenarioConfig field. */
export const KEY_MAP = {
  v: "version",
  g: "game",
  b: "startBankroll",
  bb: "baseBet",
  tn: "tableMin",
  tx: "tableMax",
  sw: "stopWin",
  sl: "stopLoss",
  r: "maxRounds",
  f: "insufficientFunds",
  n: "sessions",
  sd: "seed",
  st: "strategies",
} as const;

/** Condition codes: [code, value]. The two bankroll comparisons are separate codes. */
const COND_CODES = { ws: "winStreak", ls: "lossStreak", cp: "cycleProfit", bu: "betUnits", bg: "bankroll>=", bl: "bankroll<=" } as const;
/** Action codes: [code] or [code, value]. */
const ACTION_CODES = { s: "set", m: "multiply", a: "add", r: "reset", rc: "resetCycle", x: "stop" } as const;

export type TopField = Exclude<(typeof KEY_MAP)[keyof typeof KEY_MAP], "version" | "strategies">;
export type TopValues = Pick<ScenarioConfig, TopField>;

export const FIELD_LABELS: Record<TopField, string> = {
  game: "Game",
  startBankroll: "Starting bankroll",
  baseBet: "Base bet",
  tableMin: "Table minimum",
  tableMax: "Table maximum",
  stopWin: "Win target",
  stopLoss: "Stop-loss floor",
  maxRounds: "Max rounds per session",
  insufficientFunds: "If a bet exceeds the bankroll",
  sessions: "Sessions",
  seed: "Seed",
};

type Obj = Record<string, unknown>;

function isPlainObject(v: unknown): v is Obj {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const proto: unknown = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function own(o: Obj, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(o, key) ? o[key] : undefined;
}

function has(o: Obj, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(o, key);
}

// ------------------------------------------------------------------------------------ encoding

function compactCondition(c: Condition): unknown[] {
  switch (c.type) {
    case "winStreak":
      return ["ws", c.atLeast];
    case "lossStreak":
      return ["ls", c.atLeast];
    case "cycleProfit":
      return ["cp", c.atLeast];
    case "betUnits":
      return ["bu", c.atLeast];
    case "bankroll":
      return [c.op === ">=" ? "bg" : "bl", c.pct];
  }
}

function compactAction(a: Action): unknown[] {
  switch (a.type) {
    case "set":
      return ["s", a.units];
    case "multiply":
      return ["m", a.by];
    case "add":
      return ["a", a.units];
    case "reset":
      return ["r"];
    case "resetCycle":
      return ["rc"];
    case "stop":
      return ["x"];
  }
}

const compactEntry = (e: Entry): unknown[] => (e.when === undefined ? [compactAction(e.then)] : [compactCondition(e.when), compactAction(e.then)]);

/** A VALIDATED rule in compact form. */
export function compactRule(rule: Rule): unknown[] {
  if (rule.kind === "sequence") return ["q", rule.name, [...rule.line], rule.onComplete === "restart" ? "r" : "s"];
  return ["p", rule.name, rule.startUnits, rule.onWin.map(compactEntry), rule.onLoss.map(compactEntry)];
}

/** A VALID built-in config as [id] or [id, {only the keys that differ from the default}]; null = blank. */
export function compactBuiltin(strategyId: string, config: StrategyConfig): unknown[] {
  const strategy = getStrategy(strategyId);
  if (!strategy) return [strategyId];
  const diff: Record<string, unknown> = {};
  for (const f of strategy.configSchema) {
    const v = config[f.key];
    const d = strategy.defaultConfig[f.key];
    if (v === d) continue;
    diff[f.key] = v === undefined ? null : v;
  }
  return Object.keys(diff).length === 0 ? [strategyId] : [strategyId, diff];
}

/** The game as a preset id when it matches the preset exactly, else [presetId, winProb, netPayout]. */
function compactGame(g: ScenarioConfig["game"]): unknown {
  const preset = findPreset(g.presetId);
  return preset && preset.winProb === g.winProb && preset.netPayout === g.netPayout ? g.presetId : [g.presetId, g.winProb, g.netPayout];
}

/**
 * Compact payload for the given scenario, including ONLY the strategy instances listed in `include`
 * (the caller passes the valid ones). Nullable fields are omitted when null; `f` when "stop".
 */
export function compactScenario(s: ScenarioConfig, include: (inst: ScenarioConfig["strategies"][number]) => boolean): Obj {
  const out: Obj = { v: s.version, g: compactGame(s.game), b: s.startBankroll, bb: s.baseBet, tn: s.tableMin };
  if (s.tableMax !== null) out.tx = s.tableMax;
  if (s.stopWin !== null) out.sw = s.stopWin;
  if (s.stopLoss !== null) out.sl = s.stopLoss;
  out.r = s.maxRounds;
  if (s.insufficientFunds === "allIn") out.f = "a";
  out.n = s.sessions;
  out.sd = s.seed;
  out.st = s.strategies.filter(include).map((inst) => {
    if (inst.kind === "builtin") return compactBuiltin(inst.strategyId, inst.config);
    const v = validateRule(inst.rule);
    if (!v.ok) throw new Error("compactScenario: include() let an invalid rule through"); // programming error, never user input
    return compactRule(v.rule);
  });
  return out;
}

// ------------------------------------------------------------------------------------ expansion

type Expanded<T> = { ok: true; value: T } | { ok: false; error: string };

function expandCondition(raw: unknown, at: string): Expanded<unknown> {
  if (!Array.isArray(raw) || raw.length !== 2) return { ok: false, error: `${at}: a condition must be [code, value]` };
  const code = raw[0];
  const kind = typeof code === "string" && has(COND_CODES, code) ? COND_CODES[code as keyof typeof COND_CODES] : undefined;
  if (kind === undefined) return { ok: false, error: `${at}: unknown condition code ${describeValue(code)}` };
  const value: unknown = raw[1];
  if (kind === "bankroll>=" || kind === "bankroll<=") return { ok: true, value: { type: "bankroll", op: kind === "bankroll>=" ? ">=" : "<=", pct: value } };
  return { ok: true, value: { type: kind, atLeast: value } };
}

function expandAction(raw: unknown, at: string): Expanded<unknown> {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 2) return { ok: false, error: `${at}: an action must be [code] or [code, value]` };
  const code = raw[0];
  const kind = typeof code === "string" && has(ACTION_CODES, code) ? ACTION_CODES[code as keyof typeof ACTION_CODES] : undefined;
  if (kind === undefined) return { ok: false, error: `${at}: unknown action code ${describeValue(code)}` };
  const needsValue = kind === "set" || kind === "multiply" || kind === "add";
  if (needsValue !== (raw.length === 2)) return { ok: false, error: `${at}: action "${code as string}" ${needsValue ? "needs a value" : "takes no value"}` };
  const value: unknown = raw[1];
  if (kind === "set" || kind === "add") return { ok: true, value: { type: kind, units: value } };
  if (kind === "multiply") return { ok: true, value: { type: kind, by: value } };
  return { ok: true, value: { type: kind } };
}

function expandEntries(raw: unknown, list: string): Expanded<unknown[]> {
  if (!Array.isArray(raw)) return { ok: false, error: `${list}: must be a list of entries (got ${describeValue(raw)})` };
  if (raw.length > RULE_LIMITS.maxEntries) return { ok: false, error: `${list} has ${raw.length} entries; at most ${RULE_LIMITS.maxEntries} are allowed` };
  const out: unknown[] = [];
  for (let i = 0; i < raw.length; i++) {
    const e: unknown = raw[i];
    const at = `${list} entry ${i + 1}`;
    if (!Array.isArray(e) || e.length < 1 || e.length > 2) return { ok: false, error: `${at}: must be [action] or [condition, action]` };
    if (e.length === 1) {
      const a = expandAction(e[0], at);
      if (!a.ok) return a;
      out.push({ then: a.value });
    } else {
      const c = expandCondition(e[0], at);
      if (!c.ok) return c;
      const a = expandAction(e[1], at);
      if (!a.ok) return a;
      out.push({ when: c.value, then: a.value });
    }
  }
  return { ok: true, value: out };
}

/** Compact rule -> full rule JSON (NOT yet validated: the caller runs validateRule on it). */
export function expandRule(raw: unknown): Expanded<unknown> {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: "a custom rule must be a list" };
  const tag: unknown = raw[0];
  if (tag === "p") {
    if (raw.length !== 5) return { ok: false, error: "a progression rule must be [\"p\", name, startUnits, onWin, onLoss]" };
    const onWin = expandEntries(raw[3], "onWin");
    if (!onWin.ok) return onWin;
    const onLoss = expandEntries(raw[4], "onLoss");
    if (!onLoss.ok) return onLoss;
    return { ok: true, value: { kind: "progression", name: raw[1], startUnits: raw[2], onWin: onWin.value, onLoss: onLoss.value } };
  }
  if (tag === "q") {
    if (raw.length !== 4) return { ok: false, error: "a sequence rule must be [\"q\", name, line, \"r\" | \"s\"]" };
    const end: unknown = raw[3];
    return { ok: true, value: { kind: "sequence", name: raw[1], line: raw[2], onComplete: end === "r" ? "restart" : end === "s" ? "stop" : end } };
  }
  return { ok: false, error: `unknown rule kind ${describeValue(tag)}` };
}

export type ExpandedStrategy = { kind: "builtin"; strategyId: string; config: StrategyConfig } | { kind: "custom"; rule: Rule };

export interface ExpandedPayload {
  top: Partial<TopValues>;
  strategies: ExpandedStrategy[];
  dropped: Dropped[];
}

function expandBuiltin(raw: unknown[], field: string, dropped: Dropped[]): ExpandedStrategy | null {
  const id: unknown = raw[0];
  const strategy = typeof id === "string" ? getStrategy(id) : undefined;
  if (!strategy) {
    dropped.push({ field, message: `unknown strategy ${describeValue(id)}; left out` });
    return null;
  }
  const label = `${field} (${strategy.label})`;
  if (raw.length > 2) dropped.push({ field: label, message: "extra items after the settings were ignored" });
  const config: StrategyConfig = { ...strategy.defaultConfig };
  const rawConfig: unknown = raw[1];
  if (raw.length >= 2 && !isPlainObject(rawConfig)) {
    dropped.push({ field: label, message: `settings must be an object (got ${describeValue(rawConfig)}); using the defaults` });
    return { kind: "builtin", strategyId: strategy.id, config };
  }
  if (isPlainObject(rawConfig)) {
    let unknownKeys = 0;
    for (const key of Object.keys(rawConfig)) {
      const f = strategy.configSchema.find((x) => x.key === key);
      const v = own(rawConfig, key);
      if (!f) {
        if (++unknownKeys <= MAX_REPORTED_UNKNOWN_KEYS) dropped.push({ field: label, message: `unknown setting ${describeValue(key)} ignored` });
      } else if (v === null) {
        if (f.kind === "optionalNumber") delete config[key];
        else dropped.push({ field: `${label}: ${f.label}`, message: "can't be blank; using the default" });
      } else if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") {
        config[key] = v;
      } else {
        dropped.push({ field: `${label}: ${f.label}`, message: `unsupported value ${describeValue(v)}; using the default` });
      }
    }
    if (unknownKeys > MAX_REPORTED_UNKNOWN_KEYS) dropped.push({ field: label, message: `${unknownKeys - MAX_REPORTED_UNKNOWN_KEYS} more unknown settings ignored` });
  }
  return { kind: "builtin", strategyId: strategy.id, config };
}

function ruleName(raw: unknown[]): string {
  const n: unknown = raw[1];
  return typeof n === "string" && n.trim() !== "" ? ` (${n.slice(0, 40)})` : "";
}

/**
 * Type-level expansion of an untrusted payload object (the version is checked by the caller).
 * Returns the top-level values that have the right TYPE, the strategies that expand (rules
 * validated by the session 6 validator), and everything dropped. Range and cross-field checks are
 * the scenario validator's job, afterwards.
 */
export function expandPayload(obj: Obj, options: { rules: boolean } = { rules: true }): ExpandedPayload {
  const dropped: Dropped[] = [];
  const top: Partial<TopValues> = {};

  const unknown = Object.keys(obj).filter((k) => !has(KEY_MAP, k));
  unknown.slice(0, MAX_REPORTED_UNKNOWN_KEYS).forEach((k) => dropped.push({ field: "Link", message: `unknown setting ${describeValue(k)} ignored` }));
  if (unknown.length > MAX_REPORTED_UNKNOWN_KEYS) dropped.push({ field: "Link", message: `${unknown.length - MAX_REPORTED_UNKNOWN_KEYS} more unknown settings ignored` });

  const num = (key: string, field: TopField, nullable: boolean) => {
    if (!has(obj, key)) return;
    const v = own(obj, key);
    if (typeof v === "number" && Number.isFinite(v)) (top as Record<string, unknown>)[field] = v;
    else if (nullable && v === null) (top as Record<string, unknown>)[field] = null;
    else dropped.push({ field: FIELD_LABELS[field], message: `must be a number (got ${describeValue(v)}); using the default` });
  };
  num("b", "startBankroll", false);
  num("bb", "baseBet", false);
  num("tn", "tableMin", false);
  num("tx", "tableMax", true);
  num("sw", "stopWin", true);
  num("sl", "stopLoss", true);
  num("r", "maxRounds", false);
  num("n", "sessions", false);
  num("sd", "seed", false);

  if (has(obj, "g")) {
    const g = own(obj, "g");
    const preset = typeof g === "string" ? findPreset(g) : undefined;
    if (preset) top.game = { presetId: preset.id, winProb: preset.winProb, netPayout: preset.netPayout };
    else if (Array.isArray(g) && g.length === 3 && typeof g[0] === "string" && (g[0] === CUSTOM_GAME_ID || findPreset(g[0])) && typeof g[1] === "number" && typeof g[2] === "number") {
      top.game = { presetId: g[0], winProb: g[1], netPayout: g[2] };
    } else dropped.push({ field: FIELD_LABELS.game, message: `not a known game (got ${describeValue(g)}); using the default` });
  }

  if (has(obj, "f")) {
    const f = own(obj, "f");
    if (f === "a") top.insufficientFunds = "allIn";
    else if (f === "s") top.insufficientFunds = "stop";
    else dropped.push({ field: FIELD_LABELS.insufficientFunds, message: `must be "a" or "s" (got ${describeValue(f)}); using the default` });
  }

  const strategies: ExpandedStrategy[] = [];
  const st = own(obj, "st");
  if (!has(obj, "st")) {
    dropped.push({ field: "Strategies", message: "the link has no strategies" });
  } else if (!Array.isArray(st)) {
    dropped.push({ field: "Strategies", message: `must be a list (got ${describeValue(st)})` });
  } else {
    if (st.length > MAX_STRATEGIES) dropped.push({ field: "Strategies", message: `the link has ${st.length}; only the first ${MAX_STRATEGIES} were loaded (the limit)` });
    const n = Math.min(st.length, MAX_STRATEGIES);
    for (let i = 0; i < n; i++) {
      const raw: unknown = st[i];
      const field = `Strategy ${i + 1}`;
      if (!Array.isArray(raw) || raw.length === 0) {
        dropped.push({ field, message: `must be a list (got ${describeValue(raw)}); left out` });
        continue;
      }
      if (raw[0] === "p" || raw[0] === "q") {
        const label = `${field}${ruleName(raw)}`;
        if (!options.rules) {
          dropped.push({ field: label, message: "custom rules need a version 2 link; left out" });
          continue;
        }
        const x = expandRule(raw);
        if (!x.ok) {
          dropped.push({ field: label, message: `${x.error}; left out` });
          continue;
        }
        const v = validateRule(x.value); // THE session 6 validator
        if (!v.ok) {
          dropped.push({ field: label, message: `${v.errors.map(formatRuleError).join("; ")}; left out` });
          continue;
        }
        strategies.push({ kind: "custom", rule: v.rule });
        continue;
      }
      const b = expandBuiltin(raw, field, dropped);
      if (b) strategies.push(b);
    }
  }
  return { top, strategies, dropped };
}
