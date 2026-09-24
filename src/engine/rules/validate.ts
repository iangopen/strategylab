// The ONE rule validator, used by the worker (before compiling) and by the UI (to show errors).
// Closed grammar: anything not listed in "Rule language" (CLAUDE.md) is rejected with a readable
// error. It never throws, never evaluates anything, and only ever reads the keys it knows.
import { RULE_LIMITS, type NumberRange } from "./limits";
import type { Action, Condition, Entry, ProgressionRule, Rule, SequenceRule } from "./types";

export interface RuleError {
  /** Human-readable location, e.g. `onLoss entry 3 → action → by`. Empty for the rule itself. */
  path: string;
  message: string;
}

export type RuleResult = { ok: true; rule: Rule } | { ok: false; errors: RuleError[] };

export interface ValidateOptions {
  /**
   * false = structure and types only (keys, types, finite numbers, list shape, where "when" may
   * appear). Numeric ranges, integer-ness, name length and line length are skipped. The builder
   * form uses this to keep showing a rule while the user fixes an out-of-range value.
   */
  ranges?: boolean;
}

type FieldSpec = { kind: "number"; range: NumberRange } | { kind: "enum"; values: readonly string[] };
type Obj = Record<string, unknown>;

const CONDITIONS: Record<Condition["type"], Record<string, FieldSpec>> = {
  winStreak: { atLeast: { kind: "number", range: RULE_LIMITS.streak } },
  lossStreak: { atLeast: { kind: "number", range: RULE_LIMITS.streak } },
  cycleProfit: { atLeast: { kind: "number", range: RULE_LIMITS.cycleProfit } },
  bankroll: { op: { kind: "enum", values: [">=", "<="] }, pct: { kind: "number", range: RULE_LIMITS.bankrollPct } },
  betUnits: { atLeast: { kind: "number", range: RULE_LIMITS.betUnits } },
};

const ACTIONS: Record<Action["type"], Record<string, FieldSpec>> = {
  set: { units: { kind: "number", range: RULE_LIMITS.setUnits } },
  multiply: { by: { kind: "number", range: RULE_LIMITS.multiplyBy } },
  add: { units: { kind: "number", range: RULE_LIMITS.addUnits } },
  reset: {},
  resetCycle: {},
  stop: {},
};

const PROGRESSION_KEYS = ["kind", "name", "startUnits", "onWin", "onLoss"];
const SEQUENCE_KEYS = ["kind", "name", "line", "onComplete"];

/** Only plain objects (as JSON.parse produces). Arrays, null, class instances are not objects here. */
function isPlainObject(v: unknown): v is Obj {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const proto: unknown = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** Own property only: never read anything inherited. */
function own(o: Obj, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(o, key) ? o[key] : undefined;
}

/** A short description of a bad value for error messages. */
export function describeValue(v: unknown): string {
  if (v === null) return "null";
  if (v === undefined) return "nothing";
  if (Array.isArray(v)) return "a list";
  if (typeof v === "number") return Number.isNaN(v) ? "NaN" : String(v);
  if (typeof v === "string") return JSON.stringify(v.length > 24 ? `${v.slice(0, 24)}…` : v);
  if (typeof v === "object") return "an object";
  return `a ${typeof v}`;
}

function fmt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

function join(path: string, part: string): string {
  return path === "" ? part : `${path} → ${part}`;
}

class Checker {
  readonly errors: RuleError[] = [];
  readonly ranges: boolean;
  constructor(ranges: boolean) {
    this.ranges = ranges;
  }

  fail(path: string, message: string): undefined {
    this.errors.push({ path, message });
    return undefined;
  }

  /** Rejects any key not in `allowed`, and reports missing required keys. */
  keys(o: Obj, path: string, allowed: readonly string[], required: readonly string[]): boolean {
    let ok = true;
    for (const k of Object.keys(o)) {
      if (!allowed.includes(k)) {
        ok = false;
        this.fail(path, `unknown key ${JSON.stringify(k.length > 24 ? `${k.slice(0, 24)}…` : k)} (allowed: ${allowed.join(", ")})`);
      }
    }
    for (const k of required) {
      if (!Object.prototype.hasOwnProperty.call(o, k)) {
        ok = false;
        this.fail(path, `missing "${k}"`);
      }
    }
    return ok;
  }

  number(v: unknown, path: string, range: NumberRange): number | undefined {
    if (typeof v !== "number") return this.fail(path, `must be a number (got ${describeValue(v)})`);
    if (!Number.isFinite(v)) return this.fail(path, `must be a finite number (got ${describeValue(v)})`);
    if (this.ranges) {
      if (range.integer && !Number.isInteger(v)) return this.fail(path, `must be a whole number (got ${fmt(v)})`);
      if (v < range.min || v > range.max) return this.fail(path, `must be between ${fmt(range.min)} and ${fmt(range.max)} (got ${fmt(v)})`);
    }
    return v;
  }

  oneOf<T extends string>(v: unknown, path: string, values: readonly T[]): T | undefined {
    if (typeof v === "string" && (values as readonly string[]).includes(v)) return v as T;
    return this.fail(path, `must be one of ${values.map((x) => JSON.stringify(x)).join(", ")} (got ${describeValue(v)})`);
  }

  name(v: unknown, path: string): string | undefined {
    if (typeof v !== "string") return this.fail(path, `must be text (got ${describeValue(v)})`);
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(v)) return this.fail(path, "must not contain control characters");
    if (this.ranges) {
      if (v.trim().length === 0) return this.fail(path, "must not be empty");
      if (v.length > RULE_LIMITS.nameMaxLength) return this.fail(path, `must be at most ${RULE_LIMITS.nameMaxLength} characters (got ${v.length})`);
    }
    return v;
  }

  /** A { type, ...fields } object from a closed table of types. */
  tagged<T>(v: unknown, path: string, what: string, table: Record<string, Record<string, FieldSpec>>): T | undefined {
    if (!isPlainObject(v)) return this.fail(path, `${what} must be an object (got ${describeValue(v)})`);
    const type = own(v, "type");
    const types = Object.keys(table);
    if (typeof type !== "string" || !types.includes(type)) {
      return this.fail(join(path, "type"), `must be one of ${types.map((t) => JSON.stringify(t)).join(", ")} (got ${describeValue(type)})`);
    }
    const fields = table[type]!;
    const fieldKeys = Object.keys(fields);
    if (!this.keys(v, path, ["type", ...fieldKeys], ["type", ...fieldKeys])) return undefined;
    const out: Obj = { type };
    let ok = true;
    for (const k of fieldKeys) {
      const spec = fields[k]!;
      const val = spec.kind === "number" ? this.number(own(v, k), join(path, k), spec.range) : this.oneOf(own(v, k), join(path, k), spec.values);
      if (val === undefined) ok = false;
      else out[k] = val;
    }
    return ok ? (out as T) : undefined;
  }

  entries(v: unknown, path: string): Entry[] | undefined {
    if (!Array.isArray(v)) return this.fail(path, `must be a list of entries (got ${describeValue(v)})`);
    if (v.length === 0) return this.fail(path, "needs at least one entry (the last one, with no condition, is the default)");
    if (v.length > RULE_LIMITS.maxEntries) return this.fail(path, `has ${v.length} entries; at most ${RULE_LIMITS.maxEntries} are allowed`);
    const out: Entry[] = [];
    let ok = true;
    v.forEach((raw: unknown, i) => {
      const at = `${path} entry ${i + 1}`;
      const last = i === v.length - 1;
      if (!isPlainObject(raw)) {
        ok = false;
        this.fail(at, `must be an object with "when" and "then" (got ${describeValue(raw)})`);
        return;
      }
      if (!this.keys(raw, at, ["when", "then"], ["then"])) {
        ok = false;
        return;
      }
      const hasWhen = Object.prototype.hasOwnProperty.call(raw, "when");
      if (last && hasWhen) {
        ok = false;
        this.fail(at, 'is the last entry (the default), so it must not have a "when" condition');
        return;
      }
      if (!last && !hasWhen) {
        ok = false;
        this.fail(at, 'needs a "when" condition: only the last entry may have none, or the entries after it could never run');
        return;
      }
      const then = this.tagged<Action>(own(raw, "then"), join(at, "action"), "the action", ACTIONS);
      const when = hasWhen ? this.tagged<Condition>(own(raw, "when"), join(at, "condition"), "the condition", CONDITIONS) : undefined;
      if (then === undefined || (hasWhen && when === undefined)) {
        ok = false;
        return;
      }
      out.push(when === undefined ? { then } : { when, then });
    });
    return ok ? out : undefined;
  }

  progression(o: Obj): ProgressionRule | undefined {
    if (!this.keys(o, "", PROGRESSION_KEYS, PROGRESSION_KEYS)) return undefined;
    const name = this.name(own(o, "name"), "name");
    const startUnits = this.number(own(o, "startUnits"), "startUnits", RULE_LIMITS.startUnits);
    const onWin = this.entries(own(o, "onWin"), "onWin");
    const onLoss = this.entries(own(o, "onLoss"), "onLoss");
    if (name === undefined || startUnits === undefined || onWin === undefined || onLoss === undefined) return undefined;
    return { kind: "progression", name, startUnits, onWin, onLoss };
  }

  sequence(o: Obj): SequenceRule | undefined {
    if (!this.keys(o, "", SEQUENCE_KEYS, SEQUENCE_KEYS)) return undefined;
    const name = this.name(own(o, "name"), "name");
    const onComplete = this.oneOf(own(o, "onComplete"), "onComplete", ["restart", "stop"] as const);
    const rawLine = own(o, "line");
    let line: number[] | undefined;
    if (!Array.isArray(rawLine)) {
      this.fail("line", `must be a list of whole numbers (got ${describeValue(rawLine)})`);
    } else if (rawLine.length > RULE_LIMITS.hardListCap || (this.ranges && (rawLine.length < RULE_LIMITS.lineLength.min || rawLine.length > RULE_LIMITS.lineLength.max))) {
      this.fail("line", `must have ${RULE_LIMITS.lineLength.min} to ${RULE_LIMITS.lineLength.max} numbers (got ${rawLine.length})`);
    } else {
      const vals = rawLine.map((v: unknown, i) => this.number(v, `line number ${i + 1}`, RULE_LIMITS.lineValue));
      if (vals.every((v) => v !== undefined)) line = vals as number[];
    }
    if (name === undefined || onComplete === undefined || line === undefined) return undefined;
    return { kind: "sequence", name, line, onComplete };
  }
}

function deepFreeze<T>(o: T): T {
  if (o !== null && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

/**
 * Validates untrusted input against the closed rule grammar. On success, returns a FRESH,
 * deep-frozen rule built only from the known keys (the input is never kept or mutated).
 * Never throws.
 */
export function validateRule(raw: unknown, options: ValidateOptions = {}): RuleResult {
  const c = new Checker(options.ranges ?? true);
  try {
    let rule: Rule | undefined;
    if (!isPlainObject(raw)) {
      c.fail("", `a rule must be a JSON object (got ${describeValue(raw)})`);
    } else {
      const kind = own(raw, "kind");
      if (kind === "progression") rule = c.progression(raw);
      else if (kind === "sequence") rule = c.sequence(raw);
      else c.fail("kind", `must be "progression" or "sequence" (got ${describeValue(kind)})`);
    }
    if (rule !== undefined && c.errors.length === 0) return { ok: true, rule: deepFreeze(rule) };
    if (c.errors.length === 0) c.fail("", "the rule is not valid");
    return { ok: false, errors: c.errors };
  } catch {
    // Defensive only: plain JSON cannot reach here, but exotic objects (proxies, getters) might.
    return { ok: false, errors: [{ path: "", message: "the rule could not be read" }] };
  }
}

/** One line per error, e.g. `onLoss entry 3 → action → by: must be between 0.1 and 10 (got 12)`. */
export function formatRuleError(e: RuleError): string {
  return e.path === "" ? e.message : `${e.path}: ${e.message}`;
}

/** Parses pasted JSON text (length-capped). Never throws. */
export function parseRuleJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  if (text.length > RULE_LIMITS.maxJsonLength) {
    return { ok: false, error: `Rule JSON is too long (${text.length.toLocaleString("en-US")} characters; the limit is ${RULE_LIMITS.maxJsonLength.toLocaleString("en-US")}).` };
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (err) {
    return { ok: false, error: `Not valid JSON: ${(err as Error).message}` };
  }
}
