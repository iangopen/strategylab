import { describe, expect, it } from "vitest";
import { MARTINGALE_RULE } from "../engine/rules/examples";
import { defaultScenario, validateScenario } from "../scenario";
import { compactRule } from "./compact";
import { decodeScenarioLink } from "./link";
import { createLinkLoader, MAX_REMEMBERED_LINKS, type AppliedResult } from "./linkLoader";
import { fragmentOf } from "./testLinks";

const good = { v: 2, g: "european", b: 1000, bb: 10, tn: 1, sw: 1100, r: 1000, n: 10000, sd: 12345, st: [["flat"], ["martingale"]] };

function loaded(payload: unknown) {
  const r = decodeScenarioLink(fragmentOf(payload));
  if (r.kind !== "loaded") throw new Error(JSON.stringify(r));
  return r;
}

describe("load path: all valid, partially valid, fully invalid", () => {
  it("a valid link loads exactly, with nothing dropped", () => {
    const r = loaded(good);
    expect(r.dropped).toEqual([]);
    expect(validateScenario(r.scenario)).toEqual({});
    expect(r.scenario.strategies.map((s) => s.kind === "builtin" && s.strategyId)).toEqual(["flat", "martingale"]);
  });

  it("no #s= fragment: nothing to do", () => {
    expect(decodeScenarioLink("")).toEqual({ kind: "none" });
    expect(decodeScenarioLink("#section-2")).toEqual({ kind: "none" });
  });

  it("an invalid top-level value falls back to the default and is reported with the validator's message", () => {
    const r = loaded({ ...good, b: -5 });
    expect(r.scenario.startBankroll).toBe(defaultScenario().startBankroll);
    expect(r.dropped).toEqual([{ field: "Starting bankroll", message: "Must be at least $0.01. The link had -5; using 1000." }]);
    expect(validateScenario(r.scenario)).toEqual({});
  });

  it("a cross-field conflict turns the dependent optional field off (win target below the bankroll)", () => {
    const r = loaded({ ...good, b: 5000 });
    expect(r.scenario.startBankroll).toBe(5000);
    expect(r.scenario.stopWin).toBeNull();
    expect(r.dropped.map((d) => d.field)).toEqual(["Win target"]);
    expect(r.dropped[0]!.message).toMatch(/^Must be above the starting bankroll .* The link had 1100; using off\.$/);
  });

  it("a wrong TYPE is dropped at expansion; unknown settings are listed", () => {
    // Raw JSON text, as an attacker would write it (an object literal's __proto__ would not be a key).
    const r = loaded(JSON.stringify({ ...good, bb: "10", n: null, zz: 1 }).replace(/}$/, ',"__proto__":5}'));
    expect(r.scenario.baseBet).toBe(10);
    expect(r.dropped).toEqual([
      { field: "Link", message: 'unknown setting "zz" ignored' },
      { field: "Link", message: 'unknown setting "__proto__" ignored' },
      { field: "Base bet", message: 'must be a number (got "10"); using the default' },
      { field: "Sessions", message: "must be a number (got null); using the default" },
    ]);
    expect(({} as Record<string, unknown>).zz).toBeUndefined();
  });

  it("a built-in's invalid setting resets to its default; the strategy is kept", () => {
    const r = loaded({ ...good, st: [["kelly", { assumedWinProb: 5, fraction: 0.5, bogus: 1 }]] });
    const kelly = r.scenario.strategies[0]!;
    expect(kelly.kind === "builtin" && kelly.config).toEqual({ fraction: 0.5 });
    expect(r.dropped).toEqual([
      { field: "Strategy 1 (Kelly)", message: 'unknown setting "bogus" ignored' },
      { field: "Strategy 1 (Kelly): Assumed win probability", message: "Must be at most 0.99 (or blank). The link had 5; using the default." },
    ]);
  });

  it("an unknown strategy or an invalid rule is left out, with the rule validator's per-field errors", () => {
    const badRule = compactRule({ ...MARTINGALE_RULE, onLoss: [{ then: { type: "multiply", by: 50 } }] });
    const r = loaded({ ...good, st: [["flat"], ["doubleUpSystem"], badRule, ["p", "x", 1, [[["zz", 1], ["r"]], [["r"]]], [[["r"]]]]] });
    expect(r.scenario.strategies).toHaveLength(1);
    expect(r.dropped).toEqual([
      { field: "Strategy 2", message: 'unknown strategy "doubleUpSystem"; left out' },
      { field: "Strategy 3 (Double after a loss)", message: "onLoss entry 1 → action → by: must be between 0.1 and 10 (got 50); left out" },
      { field: "Strategy 4 (x)", message: 'onWin entry 1: unknown condition code "zz"; left out' },
    ]);
  });

  it("more than 8 strategies: the first 8 load, the rest are reported", () => {
    const r = loaded({ ...good, st: Array.from({ length: 12 }, () => ["flat"]) });
    expect(r.scenario.strategies).toHaveLength(8);
    expect(r.dropped).toEqual([{ field: "Strategies", message: "the link has 12; only the first 8 were loaded (the limit)" }]);
  });

  it("if no strategy survives, the scenario loads with none, and the app's own validation says so", () => {
    const r = loaded({ ...good, st: [["nope"]] });
    expect(r.scenario.strategies).toEqual([]);
    expect(validateScenario(r.scenario).strategies).toBe("Add at least one strategy.");
  });

  it("fully invalid links are errors: nothing is loaded", () => {
    for (const hash of ["#s=%%%", "#s=" + "e30", fragmentOf("[1,2]"), fragmentOf("not json"), fragmentOf({ g: "european" }), fragmentOf({ v: "2" })]) {
      const r = decodeScenarioLink(hash);
      expect(r.kind, hash).toBe("error");
      if (r.kind === "error") expect(r.message).toMatch(/Nothing was loaded\.$/);
    }
  });

  it("a link from a newer app version says so, instead of a partial load", () => {
    const r = decodeScenarioLink(fragmentOf({ ...good, v: 4, newThing: [1] }));
    expect(r).toEqual({ kind: "error", message: "This link needs a newer version of the app (it is scenario version 4; this app reads up to version 3). Reload the page to get the latest version, then open the link again. Nothing was loaded." });
  });
});

describe("history: a link is applied at most once per page lifetime (verification 7)", () => {
  const hash = fragmentOf(good);

  it("the same fragment again (StrictMode double effect, hashchange + popstate, Back) does not re-fire the load", () => {
    const applied: AppliedResult[] = [];
    const loader = createLinkLoader();
    expect(loader.handle(hash, (r) => applied.push(r))).toBe("applied"); // initial page load
    expect(loader.handle(hash, (r) => applied.push(r))).toBe("skipped"); // StrictMode re-run
    expect(loader.handle(hash, (r) => applied.push(r))).toBe("skipped"); // hashchange
    expect(loader.handle(hash, (r) => applied.push(r))).toBe("skipped"); // popstate (Back) to it later
    expect(applied).toHaveLength(1);
  });

  it("a fragment the app wrote itself (copy link / canonical form) is not loaded back", () => {
    const loader = createLinkLoader();
    loader.markSeen(hash);
    expect(loader.handle(hash, () => { throw new Error("must not apply"); })).toBe("skipped");
  });

  it("a real reload is a new page lifetime: the link is applied again (the lost-on-reload fix)", () => {
    const first = createLinkLoader();
    const second = createLinkLoader(); // what a reload creates
    let n = 0;
    first.handle(hash, () => n++);
    second.handle(hash, () => n++);
    expect(n).toBe(2);
  });

  it("a different fragment still loads; no fragment does nothing; errors are applied once too", () => {
    const loader = createLinkLoader();
    const got: string[] = [];
    loader.handle(hash, (r) => got.push(r.kind));
    loader.handle(fragmentOf({ ...good, sd: 7 }), (r) => got.push(r.kind));
    expect(loader.handle("", (r) => got.push(r.kind))).toBe("none");
    loader.handle("#s=!!", (r) => got.push(r.kind));
    loader.handle("#s=!!", (r) => got.push(r.kind));
    expect(got).toEqual(["loaded", "loaded", "error"]);
  });

  it("remembers a bounded number of fragments", () => {
    const loader = createLinkLoader(() => ({ kind: "error", message: "x" }));
    for (let i = 0; i <= MAX_REMEMBERED_LINKS; i++) loader.handle(`#s=${i}`, () => {});
    expect(loader.handle(`#s=${MAX_REMEMBERED_LINKS}`, () => {})).toBe("skipped"); // newest kept
    expect(loader.handle("#s=0", () => {})).toBe("applied"); // oldest forgotten
  });
});
