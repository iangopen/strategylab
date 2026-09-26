// Scenario <-> link fragment (#s=<base64url(compact JSON)>). A link is UNTRUSTED input: decoding
// never throws, never evaluates anything, and every stage is bounded by the length cap. What it
// loads passes the SAME validators the app uses everywhere (validateRule, validateScenario).
import { describeValue } from "../engine/rules/validate";
import { getStrategy } from "../engine/strategies/registry";
import { defaultScenario, migrateScenario, newCustomInstance, newUid, SCENARIO_VERSION, validateScenario, type BuiltinInstance, type ScenarioConfig, type ScenarioConfigV1, type ScenarioConfigV2, type StrategyInstance } from "../scenario";
import { base64urlToBytes, bytesToBase64url } from "./base64url";
import { compactScenario, expandPayload, FIELD_LABELS, type Dropped, type TopField, type TopValues } from "./compact";
import { FRAGMENT_PREFIX, MAX_FRAGMENT_CHARS, MAX_JSON_DEPTH, MAX_URL_CHARS } from "./limits";

export type LoadResult =
  | { kind: "none" }
  | { kind: "error"; message: string }
  | { kind: "loaded"; scenario: ScenarioConfig; dropped: Dropped[]; fromVersion: number };

export type EncodeResult =
  | { ok: true; fragment: string; urlLength: number; leftOut: number[] }
  | { ok: false; reason: "blocked" | "tooLarge"; message: string };

// ------------------------------------------------------------------------------------ save

/** Indices of the strategy instances that validate right now (only these go into a link). */
export function validStrategyIndices(s: ScenarioConfig): number[] {
  const errors = Object.keys(validateScenario(s));
  return s.strategies.flatMap((inst, i) => (errors.some((k) => k === `strategy:${inst.uid}` || k.startsWith(`strategy:${inst.uid}:`)) ? [] : [i]));
}

/** Why "Copy link" is unavailable right now, or null when it can run. */
export function copyBlocker(s: ScenarioConfig): string | null {
  const errors = validateScenario(s);
  const topLevel = Object.keys(errors).filter((k) => !k.startsWith("strategy:") && k !== "strategies");
  if (topLevel.length > 0) return "Fix the highlighted settings before copying a link.";
  if (s.strategies.length === 0) return "Add at least one strategy before copying a link.";
  if (errors.strategies) return errors.strategies;
  if (validStrategyIndices(s).length === 0) return "No strategy is valid yet: fix the highlighted strategy settings first.";
  return null;
}

/**
 * Encodes the valid part of a scenario. `baseUrl` is origin + path (+ query), without a fragment;
 * the WHOLE link must fit MAX_URL_CHARS, or this returns tooLarge. It never truncates.
 */
export function encodeScenarioLink(s: ScenarioConfig, baseUrl: string): EncodeResult {
  const blocker = copyBlocker(s);
  if (blocker !== null) return { ok: false, reason: "blocked", message: blocker };
  const valid = new Set(validStrategyIndices(s));
  const payload = compactScenario(s, (inst) => valid.has(s.strategies.indexOf(inst)));
  const fragment = FRAGMENT_PREFIX + bytesToBase64url(new TextEncoder().encode(JSON.stringify(payload)));
  const urlLength = baseUrl.length + fragment.length;
  if (urlLength > MAX_URL_CHARS) {
    return {
      ok: false,
      reason: "tooLarge",
      message: `This scenario's link would be ${urlLength.toLocaleString("en-US")} characters, over the ${MAX_URL_CHARS.toLocaleString("en-US")}-character limit that links can safely travel with. Nothing was copied. Remove a strategy or shorten a custom rule (fewer entries, shorter name).`,
    };
  }
  const leftOut = s.strategies.map((_, i) => i).filter((i) => !valid.has(i));
  return { ok: true, fragment, urlLength, leftOut };
}

// ------------------------------------------------------------------------------------ load

const NULLABLE: readonly TopField[] = ["tableMax", "stopWin", "stopLoss"];

function fallbackValues(): TopValues {
  const d = defaultScenario();
  // Omitted nullable fields mean "off" in a link, not the default scenario's value.
  return { game: d.game, startBankroll: d.startBankroll, baseBet: d.baseBet, tableMin: d.tableMin, tableMax: null, stopWin: null, stopLoss: null, maxRounds: d.maxRounds, insufficientFunds: "stop", sessions: d.sessions, seed: d.seed };
}

function show(field: TopField, v: unknown): string {
  if (v === null) return "off";
  if (field === "game" && typeof v === "object") return (v as ScenarioConfig["game"]).presetId;
  return describeValue(v);
}

/**
 * True when brackets nest deeper than `max` (strings and escapes skipped). One linear pass over
 * already length-capped text, run BEFORE JSON.parse so no hostile nesting ever reaches the parser.
 */
export function jsonDepthExceeds(text: string, max: number): boolean {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (inString) {
      if (escaped) escaped = false;
      else if (c === 92) escaped = true; // backslash
      else if (c === 34) inString = false; // quote
      continue;
    }
    if (c === 34) inString = true;
    else if (c === 91 || c === 123) {
      if (++depth > max) return true;
    } else if (c === 93 || c === 125) depth--;
  }
  return false;
}

/** Parses the fragment into a plain object, or a readable error. Bounded and never throws. */
export function parseFragment(hash: string): { ok: true; payload: Record<string, unknown> } | { ok: false; message: string } | { ok: "none" } {
  if (!hash.startsWith(FRAGMENT_PREFIX)) return { ok: "none" };
  if (hash.length > MAX_FRAGMENT_CHARS) {
    return { ok: false, message: `This link is too long to be a StrategyLab scenario (${hash.length.toLocaleString("en-US")} characters; the limit is ${MAX_FRAGMENT_CHARS.toLocaleString("en-US")}). Nothing was loaded.` };
  }
  const bytes = base64urlToBytes(hash.slice(FRAGMENT_PREFIX.length));
  if (!bytes.ok) return { ok: false, message: `${bytes.error} Nothing was loaded.` };
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.bytes);
  } catch {
    return { ok: false, message: "This link's data is not valid text. It may be damaged; copy the whole link again. Nothing was loaded." };
  }
  if (jsonDepthExceeds(text, MAX_JSON_DEPTH)) {
    return { ok: false, message: `This link's data is nested too deeply to be a scenario (more than ${MAX_JSON_DEPTH} levels). Nothing was loaded.` };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, message: "This link's data is damaged or cut off (not valid JSON). Copy the whole link again. Nothing was loaded." };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    return { ok: false, message: "This link does not contain a scenario. Nothing was loaded." };
  }
  return { ok: true, payload: value as Record<string, unknown> };
}

/**
 * Decodes a location hash. `none` when it carries no scenario; `error` (defaults untouched) when
 * nothing can be loaded; otherwise `loaded`, with every field that could not be loaded listed in
 * `dropped`, in the same per-field style as the rule builder's JSON errors.
 */
export function decodeScenarioLink(hash: string): LoadResult {
  const parsed = parseFragment(hash);
  if (parsed.ok === "none") return { kind: "none" };
  if (!parsed.ok) return { kind: "error", message: parsed.message };
  const payload = parsed.payload;

  const v = Object.prototype.hasOwnProperty.call(payload, "v") ? payload.v : undefined;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1) {
    return { kind: "error", message: `This link has no valid scenario version (got ${describeValue(v)}). Nothing was loaded.` };
  }
  if (v > SCENARIO_VERSION) {
    return { kind: "error", message: `This link needs a newer version of the app (it is scenario version ${v}; this app reads up to version ${SCENARIO_VERSION}). Reload the page to get the latest version, then open the link again. Nothing was loaded.` };
  }

  let x: ReturnType<typeof expandPayload>;
  let scenario: ScenarioConfig;
  if (v === 1) {
    // Version 1 (before custom rules): built-ins only, then the EXISTING migration (e.g. Kelly's old
    // 0 sentinel becomes blank) BEFORE validation, exactly as for any older scenario.
    x = expandPayload(payload, { rules: false, sports: false, outcomes: false });
    // The expanded game is already in its v4 form; migrateScenario leaves such a game as it is.
    const v1 = {
      version: 1,
      ...fallbackValues(),
      ...x.top,
      strategies: x.strategies.flatMap((s) => (s.kind === "builtin" ? [{ uid: newUid(), strategyId: s.strategyId, config: s.config }] : [])),
    } as unknown as ScenarioConfigV1;
    scenario = migrateScenario(v1);
  } else {
    x = expandPayload(payload, { rules: true, sports: v >= 3, outcomes: v >= 4 });
    const assembled = assemble(x.top, x.strategies.map((s) => (s.kind === "custom" ? newCustomInstance(s.rule) : builtin(s.strategyId, s.config))));
    // A version-2 link is a v2 scenario: it goes through the EXISTING migration like any older one.
    scenario = v === 2 ? migrateScenario({ ...assembled, version: 2 } as unknown as ScenarioConfigV2) : assembled;
  }
  const dropped = [...x.dropped, ...settle(scenario, new Set(Object.keys(x.top) as TopField[]))];
  return { kind: "loaded", scenario, dropped, fromVersion: v };
}

/** Instance uids are not part of a link (they are React identity, not scenario content): new ones here. */
function builtin(strategyId: string, config: BuiltinInstance["config"]): BuiltinInstance {
  return { uid: newUid(), kind: "builtin", strategyId, config };
}

function assemble(top: Partial<TopValues>, strategies: StrategyInstance[]): ScenarioConfig {
  return { version: SCENARIO_VERSION, ...fallbackValues(), ...top, strategies };
}

/**
 * Partial load: while the scenario validator reports errors, replace each offending top-level
 * field with its fallback (default, or off for nullable fields), reset each offending built-in
 * setting to its default, and drop each strategy that is unknown or has an invalid rule. Every
 * change is reported. Each pass removes at least one error source, so it ends within a bounded
 * number of passes.
 */
function settle(s: ScenarioConfig, supplied: Set<TopField>): Dropped[] {
  const dropped: Dropped[] = [];
  const fb = fallbackValues();
  const labelOf = (inst: StrategyInstance, i: number) => `Strategy ${i + 1}${inst.kind === "builtin" ? ` (${getStrategy(inst.strategyId)?.label ?? inst.strategyId})` : ""}`;
  for (let pass = 0; pass < 64; pass++) {
    const errors = validateScenario(s);
    let changed = false;
    for (const [key, message] of Object.entries(errors)) {
      if (key in FIELD_LABELS) {
        const field = key as TopField;
        const target = NULLABLE.includes(field) ? null : fb[field];
        if (JSON.stringify(s[field]) === JSON.stringify(target)) continue;
        dropped.push({ field: FIELD_LABELS[field], message: `${message} The link had ${show(field, s[field])}; using ${show(field, target)}.${supplied.has(field) ? "" : " (not set in the link)"}` });
        (s as unknown as Record<string, unknown>)[field] = target;
        changed = true;
      } else if (key.startsWith("strategy:")) {
        const [, uid, cfgKey] = key.split(":");
        const i = s.strategies.findIndex((inst) => inst.uid === uid);
        const inst = s.strategies[i];
        if (!inst) continue;
        if (inst.kind === "builtin" && cfgKey !== undefined) {
          const strategy = getStrategy(inst.strategyId)!;
          const f = strategy.configSchema.find((c) => c.key === cfgKey);
          const d = strategy.defaultConfig[cfgKey];
          dropped.push({ field: `${labelOf(inst, i)}: ${f?.label ?? cfgKey}`, message: `${message} The link had ${describeValue(inst.config[cfgKey])}; using the default.` });
          const config = { ...inst.config };
          if (d === undefined) delete config[cfgKey];
          else config[cfgKey] = d;
          s.strategies[i] = { ...inst, config };
        } else {
          dropped.push({ field: labelOf(inst, i), message: `${message} Left out.` });
          s.strategies.splice(i, 1);
        }
        changed = true;
      }
    }
    if (!changed) break;
  }
  return dropped;
}
