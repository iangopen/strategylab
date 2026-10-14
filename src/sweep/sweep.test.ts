import { describe, expect, it } from "vitest";
import { sessionSeed, splitmix32 } from "../engine/rng";
import { defaultScenario, validateScenario, type ScenarioConfig } from "../scenario";
import { bytesToBase64url } from "../share/base64url";
import { compactScenario } from "../share/compact";
import { MAX_SWEEP_SESSIONS, MIN_SWEEP_CELL_SESSIONS } from "../share/limits";
import { copyBlocker, decodeScenarioLink, encodeScenarioLink } from "../share/link";
import { assertSweepWithinCaps, runSweep } from "./run";
import { toSweepRequest } from "./request";
import { axisValues, cellIndex, cellScenario, cellSeed, defaultSweep, sweepGrid, sweepSessionsPerCell, type SweepConfig } from "./sweep";
import { isSweepErrorKey } from "./validate";

/** The default scenario with a sweep of Martingale (strategy 2) over the given axes. */
function withSweep(patch: Partial<SweepConfig> = {}, scenario: Partial<ScenarioConfig> = {}): ScenarioConfig {
  const s = { ...defaultScenario(), ...scenario };
  return { ...s, sweep: { ...defaultSweep(s.strategies[1]!.uid), ...patch } };
}
const sweepErrors = (s: ScenarioConfig) => Object.fromEntries(Object.entries(validateScenario(s)).filter(([k]) => isSweepErrorKey(k)));

/** A link built by hand from a payload (what a crafted link can carry, bypassing the app's encoder). */
function craftedLink(payload: Record<string, unknown>): string {
  return "#s=" + bytesToBase64url(new TextEncoder().encode(JSON.stringify(payload)));
}

describe("sweep grid", () => {
  it("axis values: evenly spaced, both ends included, money in whole cents, rounds whole", () => {
    expect(axisValues({ field: "startBankroll", start: 100, end: 1000, steps: 10 })).toEqual([100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]);
    expect(axisValues({ field: "baseBet", start: 1, end: 2, steps: 4 })).toEqual([1, 1.33, 1.67, 2]);
    expect(axisValues({ field: "maxRounds", start: 100, end: 200, steps: 3 })).toEqual([100, 150, 200]);
    expect(axisValues({ field: "maxRounds", start: 10, end: 11, steps: 4 })).toEqual([10, 10, 11, 11]); // rejected by validation (repeats)
    expect(axisValues({ field: "baseBet", start: 5, end: 99, steps: 1 })).toEqual([5]);
  });

  it("cells are numbered row by row; a cell's scenario has the swept values, the capped sessions, the derived seed and one strategy", () => {
    const s = withSweep();
    expect(cellIndex(s.sweep!, 2, 3)).toBe(23);
    const grid = sweepGrid(s, s.sweep!);
    expect(grid).toEqual({ xValues: [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000], yValues: [5, 10, 15, 20, 25], cells: 50, sessionsPerCell: 10_000 });
    const c = cellScenario(s, s.sweep!, 23);
    expect([c.startBankroll, c.baseBet, c.sessions, c.seed]).toEqual([400, 15, 10_000, cellSeed(12345, 23)]);
    expect(c.strategies).toEqual([s.strategies[1]]);
    expect(c.sweep).toBeUndefined();
    expect(Object.keys(validateScenario(c))).toEqual([]);
  });

  it("the cell seed: splitmix32(base XOR splitmix32(k XOR 0x53574550)), pinned, and never the session seed of the same index", () => {
    const documented = (base: number, k: number) => splitmix32((base ^ splitmix32((k ^ 0x53574550) >>> 0)) >>> 0);
    for (const k of [0, 1, 2, 57, 399]) expect(cellSeed(12345, k)).toBe(documented(12345, k));
    expect([0, 1, 2, 399].map((k) => cellSeed(12345, k))).toEqual([424358590, 3265506571, 4018092712, 3441367838]);
    for (const k of [0, 1, 2]) expect(cellSeed(12345, k)).not.toBe(sessionSeed(12345, k));
    const seeds = new Set(Array.from({ length: 400 }, (_, k) => cellSeed(12345, k)));
    expect(seeds.size).toBe(400);
    for (const k of [0, 5]) {
      expect(cellSeed(0xffffffff, k)).toBeGreaterThanOrEqual(0);
      expect(cellSeed(0xffffffff, k)).toBeLessThanOrEqual(0xffffffff);
    }
  });
});

describe("sweep size caps", () => {
  it("sessions per cell = min(Sessions, floor(1,000,000 / cells))", () => {
    expect(sweepSessionsPerCell(50, 10_000)).toBe(10_000);
    expect(sweepSessionsPerCell(400, 10_000)).toBe(2_500);
    expect(sweepSessionsPerCell(300, 1_000_000)).toBe(3_333);
    // The grid floor binds only above 2,000 cells, which the 20 × 20 cap already rules out.
    expect(sweepSessionsPerCell(2001, 10_000)).toBe(499);
  });

  it("20 × 20 is accepted (2,500 sessions per cell at the default 10,000); 21 × 20 and 20 × 21 are rejected", () => {
    const max = withSweep({ x: { field: "startBankroll", start: 100, end: 1000, steps: 20 }, y: { field: "baseBet", start: 1, end: 20, steps: 20 } });
    expect(sweepErrors(max)).toEqual({});
    expect(sweepGrid(max, max.sweep!).sessionsPerCell * 400).toBe(MAX_SWEEP_SESSIONS);
    const wide = withSweep({ x: { field: "startBankroll", start: 100, end: 1000, steps: 21 }, y: { field: "baseBet", start: 1, end: 20, steps: 20 } });
    expect(sweepErrors(wide)).toEqual({ "sweep.x": "Steps must be a whole number from 1 to 20 (a sweep is at most 20 × 20 cells)." });
    const tall = withSweep({ y: { field: "baseBet", start: 1, end: 20, steps: 21 } });
    expect(Object.keys(sweepErrors(tall))).toEqual(["sweep.y"]);
  });

  it("a grid that can't give every cell 500 sessions is rejected, never run thinner", () => {
    const thin = withSweep({}, { sessions: MIN_SWEEP_CELL_SESSIONS - 1 });
    expect(sweepErrors(thin)).toEqual({ sweep: "Each cell needs at least 500 sessions: set Sessions to 500 or more." });
    expect(sweepErrors(withSweep({}, { sessions: MIN_SWEEP_CELL_SESSIONS }))).toEqual({});
  });

  it("the worker re-checks the caps on the request itself (an oversize request never starts)", () => {
    const s = withSweep({}, { sessions: 600 });
    const req = toSweepRequest(s, s.sweep!);
    expect(() => assertSweepWithinCaps(req)).not.toThrow();
    const cell = req.cells[0]!;
    expect(() => runSweep({ cells: Array(401).fill(cell) })).toThrow("A sweep has 1 to 400 cells (got 401)");
    expect(() => runSweep({ cells: Array(400).fill({ ...cell, nSessions: 2501 }) })).toThrow("A sweep runs at most 1,000,000 sessions (got 1,000,400)");
    expect(() => runSweep({ cells: [{ ...cell, nSessions: 499 }] })).toThrow("at least 500 sessions");
    expect(() => runSweep({ cells: [{ ...cell, strategies: [...cell.strategies, ...cell.strategies] }] })).toThrow("exactly one strategy");
    expect(() => runSweep({ cells: [] })).toThrow("A sweep has 1 to 400 cells (got 0)");
  });

  it("other checks: distinct settings, increasing ranges, no repeated values, a known strategy, a target in (0, 100)", () => {
    expect(sweepErrors(withSweep({ y: { field: "startBankroll", start: 1, end: 2, steps: 2 } }))).toEqual({ "sweep.y": "The two axes must sweep different settings." });
    expect(sweepErrors(withSweep({ x: { field: "startBankroll", start: 500, end: 100, steps: 3 } }))).toEqual({ "sweep.x": "End must be above start." });
    expect(Object.keys(sweepErrors(withSweep({ y: { field: "maxRounds", start: 10, end: 11, steps: 4 } })))).toEqual(["sweep.y"]);
    expect(sweepErrors(withSweep({ strategyUid: "gone" }))).toEqual({ "sweep.strategy": "Pick one of the scenario's strategies to sweep." });
    for (const t of [0, 100, NaN]) expect(Object.keys(sweepErrors(withSweep({ targetPct: t }))), String(t)).toEqual(["sweep.target"]);
  });

  it("every cell must be a scenario the app would run: a bankroll at or above the win target names the cell", () => {
    const s = withSweep({ x: { field: "startBankroll", start: 500, end: 1500, steps: 3 } });
    expect(sweepErrors(s)).toEqual({ sweep: "The cell with starting bankroll $1,500, base bet $5 can't run: win target: Must be above the starting bankroll (or blank for off)." });
    expect(sweepErrors({ ...s, stopWin: null })).toEqual({});
  });

  it("a plain Run ignores sweep errors, and Copy link leaves an invalid sweep out instead of blocking", () => {
    const s = withSweep({ targetPct: 0 });
    expect(Object.keys(validateScenario(s)).every(isSweepErrorKey)).toBe(true);
    expect(copyBlocker(s)).toBeNull();
    const enc = encodeScenarioLink(s, "https://x.test/");
    expect(enc.ok && enc.sweepLeftOut).toBe(true);
    const back = decodeScenarioLink(enc.ok ? enc.fragment : "");
    expect(back.kind === "loaded" && back.scenario.sweep).toBeUndefined();
  });
});

describe("sweeps in share links", () => {
  it("a sweep round-trips; its strategy is stored by position and gets the loaded instance's uid", () => {
    const s = withSweep({ x: { field: "baseBet", start: 2, end: 20, steps: 4 }, y: { field: "maxRounds", start: 100, end: 400, steps: 4 }, targetPct: 2.5 }, { stopWin: null });
    const enc = encodeScenarioLink(s, "https://x.test/");
    if (!enc.ok) throw new Error(enc.message);
    expect(enc.sweepLeftOut).toBe(false);
    const r = decodeScenarioLink(enc.fragment);
    if (r.kind !== "loaded") throw new Error(r.kind);
    expect(r.dropped).toEqual([]);
    const { strategyUid, ...rest } = r.scenario.sweep!;
    const { strategyUid: _orig, ...expected } = s.sweep!;
    expect(rest).toEqual(expected);
    expect(strategyUid).toBe(r.scenario.strategies[1]!.uid);
    expect(r.scenario.strategies[1]!.kind === "builtin" && r.scenario.strategies[1]!.strategyId).toBe("martingale");
  });

  it("the swept strategy's position counts the link's strategies: an invalid strategy left out before it shifts it", () => {
    const base = withSweep();
    const broken = { ...base.strategies[0]!, uid: "broken", config: { units: -5 } };
    const s: ScenarioConfig = { ...base, strategies: [broken, ...base.strategies] };
    const enc = encodeScenarioLink(s, "https://x.test/");
    if (!enc.ok) throw new Error(enc.message);
    expect(enc.leftOut).toEqual([0]);
    const r = decodeScenarioLink(enc.fragment);
    if (r.kind !== "loaded") throw new Error(r.kind);
    const swept = r.scenario.strategies.find((i) => i.uid === r.scenario.sweep!.strategyUid)!;
    expect(swept.kind === "builtin" && swept.strategyId).toBe("martingale");
  });

  it("a crafted link with an oversize sweep loads the scenario but NOT the sweep, and says why", () => {
    const s = defaultScenario();
    const payload = compactScenario(s, () => true);
    for (const [sp, why] of [
      [["b", 100, 1000, 21, "bb", 1, 20, 20, 1, 5], "Steps must be a whole number from 1 to 20"],
      [["b", 100, 1000, 1e9, "bb", 1, 20, 1e9, 1, 5], "Steps must be a whole number from 1 to 20"],
      [["b", 100, 1000, 20, "bb", 1, 20, 20.5, 1, 5], "Steps must be a whole number from 1 to 20"],
    ] as const) {
      const r = decodeScenarioLink(craftedLink({ ...payload, sp }));
      if (r.kind !== "loaded") throw new Error(r.kind);
      expect(r.scenario.sweep).toBeUndefined();
      expect(r.dropped).toEqual([{ field: "Sweep", message: expect.stringContaining(why) as string }]);
      expect(r.scenario.strategies).toHaveLength(2);
    }
    // Too few sessions per cell for the 500 floor, in a crafted link.
    const thin = decodeScenarioLink(craftedLink({ ...payload, n: 499, sp: ["b", 100, 1000, 10, "bb", 5, 25, 5, 1, 5] }));
    if (thin.kind !== "loaded") throw new Error(thin.kind);
    expect(thin.scenario.sweep).toBeUndefined();
    expect(thin.scenario.sessions).toBe(499);
    expect(thin.dropped).toEqual([{ field: "Sweep", message: "Each cell needs at least 500 sessions: set Sessions to 500 or more. Left out." }]);
  });

  it("damaged sweep data is left out with a reason; the rest of the link loads", () => {
    const payload = compactScenario(defaultScenario(), () => true);
    const cases: [unknown, string][] = [
      ["nope", "a sweep must be"],
      [["zz", 1, 2, 2, "bb", 1, 2, 2, 0, 5], 'x axis: unknown setting "zz"'],
      [["b", "1", 2, 2, "bb", 1, 2, 2, 0, 5], "x axis: start, end and steps must be numbers"],
      [["b", 1, 2, 2, "bb", 1, 2, 2, 7, 5], "the swept strategy (number 8) is not among the strategies loaded from the link"],
      [["b", 1, 2, 2, "bb", 1, 2, 2, -1, 5], "the swept strategy must be a position"],
      [["b", 1, 2, 2, "bb", 1, 2, 2, 0, null], "the target must be a number"],
    ];
    for (const [sp, why] of cases) {
      const r = decodeScenarioLink(craftedLink({ ...payload, sp }));
      if (r.kind !== "loaded") throw new Error(r.kind);
      expect(r.scenario.sweep, why).toBeUndefined();
      expect(r.dropped.map((d) => `${d.field}: ${d.message}`).join("\n"), why).toContain(why);
    }
  });

  it("a scenario without a sweep encodes no sweep key (existing links are unchanged)", () => {
    const enc = encodeScenarioLink(defaultScenario(), "https://x.test/");
    if (!enc.ok) throw new Error(enc.message);
    const json = new TextDecoder().decode(Uint8Array.from(atob(enc.fragment.slice(3).replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)));
    expect(JSON.parse(json)).not.toHaveProperty("sp");
  });
});
