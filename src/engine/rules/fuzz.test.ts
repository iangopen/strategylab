import { describe, expect, it } from "vitest";
import { edge, GAME_PRESETS, type Game } from "../games";
import { mulberry32, sessionSeed, type Rng } from "../rng";
import { runSession } from "../runner";
import { evPerWageredWithSE, INVARIANT_SCENARIO } from "../testUtils";
import type { SessionResult } from "../types";
import { compileRule } from "./compile";
import { RULE_LIMITS, type NumberRange } from "./limits";
import type { Action, Condition, Entry, Rule } from "./types";
import { validateRule } from "./validate";

// Seeded fuzzing: 200 random VALID rules must satisfy the core invariant (EV per $ wagered within
// 4 SE of -edge) on a negative- and a positive-edge game with no crash, NaN or Infinity; 200
// random INVALID rules must all be rejected with an error, and none may throw uncaught.

const N_RULES = 200;
const SESSIONS = 1000;
const SCENARIO = { ...INVARIANT_SCENARIO, maxRounds: 200 };
const european = GAME_PRESETS.find((g) => g.id === "european")!;
const posEdge: Game = { id: "posEdge", name: "Positive edge (p=0.55, even money)", winProb: 0.55, netPayout: 1 };

class Gen {
  private readonly r: Rng;
  constructor(seed: number) {
    this.r = mulberry32(seed);
  }
  u = () => this.r();
  int = (lo: number, hi: number) => lo + Math.floor(this.u() * (hi - lo + 1));
  pick = <T>(xs: readonly T[]): T => xs[Math.floor(this.u() * xs.length)]!;
  /** A value in range: often a boundary, otherwise uniform (rounded to 2 dp unless integer). */
  num(range: NumberRange): number {
    const roll = this.u();
    if (roll < 0.1) return range.min;
    if (roll < 0.2) return range.max;
    if (range.integer) return this.int(range.min, range.max);
    const v = Math.round((range.min + this.u() * (range.max - range.min)) * 100) / 100;
    return Math.min(range.max, Math.max(range.min, v));
  }
  /** Mostly small, realistic values, sometimes anywhere in range. */
  small(range: NumberRange, lo: number, hi: number): number {
    return this.u() < 0.75 ? Math.min(range.max, Math.max(range.min, range.integer ? this.int(lo, hi) : Math.round((lo + this.u() * (hi - lo)) * 100) / 100)) : this.num(range);
  }

  condition(): Condition {
    switch (this.pick(["winStreak", "lossStreak", "cycleProfit", "bankroll", "betUnits"] as const)) {
      case "winStreak":
        return { type: "winStreak", atLeast: this.small(RULE_LIMITS.streak, 1, 6) };
      case "lossStreak":
        return { type: "lossStreak", atLeast: this.small(RULE_LIMITS.streak, 1, 6) };
      case "cycleProfit":
        return { type: "cycleProfit", atLeast: this.small(RULE_LIMITS.cycleProfit, -10, 10) };
      case "bankroll":
        return { type: "bankroll", op: this.pick([">=", "<="] as const), pct: this.small(RULE_LIMITS.bankrollPct, 50, 160) };
      case "betUnits":
        return { type: "betUnits", atLeast: this.small(RULE_LIMITS.betUnits, 1, 32) };
    }
  }

  action(): Action {
    switch (this.pick(["set", "multiply", "add", "reset", "resetCycle", "stop"] as const)) {
      case "set":
        return { type: "set", units: this.small(RULE_LIMITS.setUnits, 0.5, 20) };
      case "multiply":
        return { type: "multiply", by: this.small(RULE_LIMITS.multiplyBy, 0.5, 3) };
      case "add":
        return { type: "add", units: this.small(RULE_LIMITS.addUnits, -3, 3) };
      case "reset":
        return { type: "reset" };
      case "resetCycle":
        return { type: "resetCycle" };
      case "stop":
        // Rare, so most sessions run a while.
        return this.u() < 0.3 ? { type: "stop" } : { type: "reset" };
    }
  }

  entries(): Entry[] {
    const n = this.int(1, RULE_LIMITS.maxEntries);
    return Array.from({ length: n }, (_, i) => (i === n - 1 ? { then: this.action() } : { when: this.condition(), then: this.action() }));
  }

  rule(i: number): Rule {
    const name = `fuzz ${i}`;
    if (this.u() < 0.15) {
      const len = this.int(RULE_LIMITS.lineLength.min, RULE_LIMITS.lineLength.max);
      return { kind: "sequence", name, line: Array.from({ length: len }, () => this.small(RULE_LIMITS.lineValue, 1, 6)), onComplete: this.pick(["restart", "stop"] as const) };
    }
    return { kind: "progression", name, startUnits: this.small(RULE_LIMITS.startUnits, 0.5, 5), onWin: this.entries(), onLoss: this.entries() };
  }
}

function validRules(): Rule[] {
  const g = new Gen(20260923);
  return Array.from({ length: N_RULES }, (_, i) => g.rule(i));
}

const isCents = (x: number) => Number.isSafeInteger(x);

describe("fuzz: 200 random VALID rules satisfy the EV-per-$ invariant", () => {
  const rules = validRules();

  it("the generator produces only valid rules, of both kinds and every condition/action type", () => {
    const types = new Set<string>();
    for (const r of rules) {
      const v = validateRule(r);
      expect(v.ok, JSON.stringify(r)).toBe(true);
      types.add(r.kind);
      if (r.kind === "progression") for (const e of [...r.onWin, ...r.onLoss]) types.add(e.when?.type ?? "default").add(e.then.type);
    }
    for (const t of ["progression", "sequence", "winStreak", "lossStreak", "cycleProfit", "bankroll", "betUnits", "set", "multiply", "add", "reset", "resetCycle", "stop"]) expect(types).toContain(t);
  });

  for (const [game, master] of [[european, 61], [posEdge, 62]] as const) {
    it(`${game.id}: every rule within 4 SE of ${(-edge(game)).toFixed(6)}, all results finite integers`, () => {
      const expected = -edge(game);
      let worst = { z: 0, i: -1 };
      let totalRounds = 0;
      const zs: number[] = [];
      rules.forEach((rule, i) => {
        const strategy = compileRule(rule);
        const results: SessionResult[] = [];
        for (let s = 0; s < SESSIONS; s++) {
          const r = runSession(game, strategy, {}, SCENARIO, sessionSeed(master + i * 7919, s)); // throws on a non-finite bet
          if (!(isCents(r.finalBankroll) && isCents(r.totalWagered) && isCents(r.peak) && isCents(r.maxDrawdown) && Number.isInteger(r.rounds) && r.finalBankroll >= 0)) {
            throw new Error(`rule ${i} session ${s}: non-integer or negative result ${JSON.stringify(r)}`);
          }
          totalRounds += r.rounds;
          results.push(r);
        }
        const { ev, se } = evPerWageredWithSE(results, SCENARIO.startBankroll);
        expect(Number.isFinite(ev), `rule ${i}: EV per $ is ${ev}`).toBe(true);
        expect(se, `rule ${i}: SE`).toBeGreaterThan(0);
        const z = (ev - expected) / se;
        zs.push(z);
        if (Math.abs(z) > Math.abs(worst.z)) worst = { z, i };
        expect(Math.abs(ev - expected), `rule ${i} ${JSON.stringify(rule)}: EV/$=${ev} expected=${expected} SE=${se} z=${z.toFixed(2)}`).toBeLessThan(4 * se);
      });
      const meanZ = zs.reduce((a, b) => a + b, 0) / zs.length;
      const sdZ = Math.sqrt(zs.reduce((a, b) => a + (b - meanZ) ** 2, 0) / (zs.length - 1));
      console.log(`[fuzz] ${game.id}: ${N_RULES} rules x ${SESSIONS} sessions, ${totalRounds} rounds; worst |z| = ${Math.abs(worst.z).toFixed(2)} (rule ${worst.i}); z mean ${meanZ.toFixed(2)}, sd ${sdZ.toFixed(2)}`);
    }, 300_000);
  }
});

// ------------------------------------------------------------------------------------------------
// Invalid rules: a valid rule with ONE random corruption, or junk.

type Json = Record<string, unknown> | unknown[];

/** Every object/array inside a value, with the parent path, for picking a corruption site. */
function containers(v: unknown, out: Json[] = []): Json[] {
  if (v !== null && typeof v === "object") {
    out.push(v as Json);
    for (const c of Object.values(v)) containers(c, out);
  }
  return out;
}

function numericSites(v: unknown, out: [Json, string | number][] = []): [Json, string | number][] {
  if (v !== null && typeof v === "object") {
    for (const [k, c] of Object.entries(v)) {
      if (typeof c === "number") out.push([v as Json, Array.isArray(v) ? Number(k) : k]);
      else numericSites(c, out);
    }
  }
  return out;
}

const BAD_NUMBERS: unknown[] = [NaN, Infinity, -Infinity, 1e9, -1e9, "3", null, true, {}, []];

function invalidRule(g: Gen, i: number): { kind: string; value: unknown } {
  const base = structuredClone(g.rule(i)) as unknown as Record<string, unknown>;
  const mutation = g.int(0, 11);
  switch (mutation) {
    case 0: {
      // unknown key somewhere
      const objs = containers(base).filter((c) => !Array.isArray(c)) as Record<string, unknown>[];
      g.pick(objs)[g.pick(["extra", "code", "script", "onTie", "__proto__x", "then2"])] = 1;
      return { kind: "unknown key", value: base };
    }
    case 1: {
      const [o, k] = g.pick(numericSites(base));
      (o as Record<string | number, unknown>)[k] = g.pick(BAD_NUMBERS);
      return { kind: "bad number", value: base };
    }
    case 2: {
      // delete a present key (every present key is required, including "when" on non-final entries)
      const objs = containers(base).filter((c) => !Array.isArray(c) && Object.keys(c).length > 0) as Record<string, unknown>[];
      const o = g.pick(objs);
      delete o[g.pick(Object.keys(o))];
      return { kind: "missing key", value: base };
    }
    case 3:
      base.kind = g.pick(["script", "", 1, null, "Progression"]);
      return { kind: "bad kind", value: base };
    case 4:
      if (base.kind === "progression") base[g.pick(["onWin", "onLoss"])] = g.pick([[], "reset", null, Array.from({ length: 11 + g.int(0, 50) }, () => ({ then: { type: "reset" } }))]);
      else base.line = g.pick([[], Array<number>(21 + g.int(0, 5000)).fill(1), [1, 2.5], [0], [101], "1-2-3"]);
      return { kind: "bad list", value: base };
    case 5:
      if (base.kind === "progression") {
        const list = base[g.pick(["onWin", "onLoss"])] as Record<string, unknown>[];
        list[list.length - 1]!.when = { type: "winStreak", atLeast: 1 }; // default entry with a condition
      } else base.onComplete = g.pick(["again", true, null]);
      return { kind: "bad default/onComplete", value: base };
    case 6: {
      const typed = containers(base).filter((c) => !Array.isArray(c) && "type" in c) as Record<string, unknown>[];
      if (typed.length === 0) {
        base.name = 42;
        return { kind: "bad name", value: base };
      }
      g.pick(typed).type = g.pick(["eval", "martingale", "doubleUp", "", 3, null]);
      return { kind: "bad type", value: base };
    }
    case 7:
      base.name = g.pick(["", "x".repeat(41 + g.int(0, 1000)), "tab\there", 42, null, ["a"]]);
      return { kind: "bad name", value: base };
    case 8:
      return { kind: "junk", value: g.pick([null, undefined, 0, "rule", "alert(1)", [], [base], true, NaN]) };
    case 9:
      return { kind: "__proto__", value: JSON.parse(JSON.stringify(base).replace(/^\{/, '{"__proto__":{"x":1},')) as unknown };
    case 10: {
      // a non-object where an object is required
      const objs = containers(base).filter((c) => !Array.isArray(c) && c !== base) as Record<string, unknown>[];
      if (objs.length === 0) {
        base.line = null;
        return { kind: "bad list", value: base };
      }
      const o = g.pick(objs);
      for (const k of Object.keys(o)) delete o[k];
      Object.assign(o, { type: g.pick([[], null, 42]) }); // never a real type name
      return { kind: "bad object", value: base };
    }
    default:
      if (base.kind === "progression") {
        const list = base[g.pick(["onWin", "onLoss"])] as Record<string, unknown>[];
        list.unshift({ then: { type: "reset" } }); // unconditioned entry before the default
      } else base.line = [1, "2", 3];
      return { kind: "unreachable entry / bad line value", value: base };
  }
}

describe("fuzz: 200 random INVALID rules are all rejected", () => {
  it("validateRule returns ok:false with readable errors, never throws; compileRule throws an Error", () => {
    const g = new Gen(8675309);
    const kinds: Record<string, number> = {};
    for (let i = 0; i < N_RULES; i++) {
      const { kind, value } = invalidRule(g, i);
      kinds[kind] = (kinds[kind] ?? 0) + 1;
      let result: ReturnType<typeof validateRule> | undefined;
      expect(() => (result = validateRule(value)), `invalid rule ${i} (${kind}) threw`).not.toThrow();
      expect(result!.ok, `invalid rule ${i} (${kind}) was ACCEPTED: ${JSON.stringify(value)}`).toBe(false);
      if (!result!.ok) {
        expect(result!.errors.length).toBeGreaterThan(0);
        for (const e of result!.errors) expect(e.message.length).toBeGreaterThan(5);
      }
      expect(() => compileRule(value)).toThrow(/^Invalid custom rule: /);
    }
    console.log(`[fuzz] ${N_RULES} invalid rules rejected; corruption kinds ${JSON.stringify(kinds)}`);
    expect(Object.keys(kinds).length).toBeGreaterThanOrEqual(10);
  });
});
