// Golden runMonteCarlo outputs (everything EXCEPT the bands), captured before session 12 changed the
// band checkpoint schedule (commit 44151cf). Checkpoints only change what the band observer records,
// so every stat, end-reason count, histogram and sample path must stay bit-identical. If one moves,
// the observer is leaking into the simulation.
// Regenerate only on purpose: $env:GOLDEN_MC="write"; npx vitest run src/engine/montecarlo.golden.test.ts
import { describe, expect, it } from "vitest";
import golden from "./montecarlo.golden.json";
import { GAME_PRESETS, type Game } from "./games";
import { runMonteCarlo, type MonteCarloResult, type StrategySpec } from "./montecarlo";
import { sportsGame } from "./odds";
import { compileRule } from "./rules/compile";
import { STRATEGIES } from "./strategies/registry";
import { INVARIANT_SCENARIO, REGRESSION_MARKET, sessionConfig } from "./testUtils";
import type { SessionConfig } from "./types";

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

const market = sportsGame(REGRESSION_MARKET);
if (!market.ok) throw new Error("bad market");

const CUSTOM = compileRule({
  kind: "progression",
  name: "golden custom",
  startUnits: 1,
  onWin: [{ when: { type: "cycleProfit", atLeast: 3 }, then: { type: "resetCycle" } }, { then: { type: "multiply", by: 1.5 } }],
  onLoss: [{ when: { type: "lossStreak", atLeast: 3 }, then: { type: "reset" } }, { then: { type: "add", units: 1 } }],
});

const SPECS: StrategySpec[] = [
  ...STRATEGIES.map((strategy) => ({ strategy, config: strategy.id === "kelly" ? { assumedWinProb: 0.6, fraction: 1 } : { ...strategy.defaultConfig } })),
  { strategy: CUSTOM, config: {} },
];

/** 2,500 sessions: more than the 2,000-session band subset, so observed and unobserved sessions both count. */
const N = 2500;
const SCENARIOS: [string, Game, SessionConfig, number][] = [
  // The app's default scenario ($1,000, $10 base, $1,100 target, 1,000 rounds).
  ["default", GAME_PRESETS.find((g) => g.id === "european")!, sessionConfig({ startBankroll: 100_000, baseBet: 1_000, tableMin: 100, stopWin: 110_000 }), 12345],
  ["invariant", GAME_PRESETS.find((g) => g.id === "european")!, INVARIANT_SCENARIO, 7],
  ["sports -110 market", { id: "sports", name: "Sports odds", winProb: market.winProb, netPayout: market.netPayout }, INVARIANT_SCENARIO, 1110],
  // Long sessions: 20,000 max rounds, where the old and new schedules differ most after round 64.
  ["long", GAME_PRESETS.find((g) => g.id === "american")!, sessionConfig({ startBankroll: 1_000_000, baseBet: 1_000, tableMin: 100, maxRounds: 20_000 }), 31],
];

type Snapshot = { stats: Record<string, string>[]; endReasons: unknown[]; histogram: { edges: number[]; counts: number[][] }; samplePathsDigest: string };

/** 64-bit FNV-1a (two 32-bit halves) over the decimal text of every number. */
function digest(values: Iterable<number>): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x5bd1e995;
  for (const x of values) {
    const s = String(x) + ",";
    for (let k = 0; k < s.length; k++) {
      const c = s.charCodeAt(k);
      h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
      h2 = Math.imul(h2 ^ c, 0x0100012f) >>> 0;
    }
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

function* pathNumbers(r: MonteCarloResult): Generator<number> {
  for (const s of r.perStrategy) {
    for (const p of s.samplePaths) {
      yield p.rounds.length;
      yield* p.rounds;
      yield* p.bankroll;
    }
  }
}

/** Everything a run returns except the bands. Stats as String(v): exact decimal round trip, NaN kept. */
function snapshot(r: MonteCarloResult): Snapshot {
  return {
    stats: r.perStrategy.map((s) => Object.fromEntries(Object.entries(s.stats).map(([k, v]) => [k, String(v)]))),
    endReasons: r.perStrategy.map((s) => s.endReasonCounts),
    histogram: { edges: Array.from(r.histogram.edges), counts: r.perStrategy.map((s) => Array.from(s.histogramCounts)) },
    samplePathsDigest: digest(pathNumbers(r)),
  };
}

const run = ([, game, cfg, seed]: (typeof SCENARIOS)[number]) => snapshot(runMonteCarlo(game, SPECS, cfg, N, seed));

describe.skipIf(env.GOLDEN_MC !== "write")("golden capture (writes montecarlo.golden.json)", () => {
  it("captures", { timeout: 600_000 }, async () => {
    const out = Object.fromEntries(SCENARIOS.map((s) => [s[0], run(s)]));
    // Specifier through a variable: the app tsconfig has no Node types, and this branch only runs in Node.
    const fsName = "node:fs";
    const fs = (await import(/* @vite-ignore */ fsName)) as { writeFileSync(u: URL, s: string): void };
    fs.writeFileSync(new URL("./montecarlo.golden.json", import.meta.url), JSON.stringify(out) + "\n");
  });
});

describe("runMonteCarlo outputs other than the bands are bit-identical to the pre-session-12 run", { timeout: 60_000 }, () => {
  const stored = golden as Record<string, Snapshot>;
  it("covers every scenario", () => {
    expect(Object.keys(stored).sort()).toEqual(SCENARIOS.map((s) => s[0]).sort());
  });
  for (const s of SCENARIOS) {
    it(`${s[0]}: 9 strategies x ${N} sessions`, () => {
      expect(run(s)).toEqual(stored[s[0]]);
    });
  }
});
