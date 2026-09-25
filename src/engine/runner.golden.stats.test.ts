// Golden SessionResults on even-money and INTEGER-payout games, captured from the runner as it was
// BEFORE the session 11 sub-cent carry (commit 5d01387). On these games bet × netPayout is a whole
// number of cents, so the carry is always exactly 0 and every session must be bit-identical.
// Regenerate only on purpose: $env:GOLDEN="write"; npx vitest run src/engine/runner.golden.test.ts
import { describe, expect, it } from "vitest";
import golden from "./runner.golden.json";
import { edge, GAME_PRESETS, type Game } from "./games";
import { sportsGame } from "./odds";
import { sessionSeed } from "./rng";
import { compileRule } from "./rules/compile";
import { runSession } from "./runner";
import { flat } from "./strategies/flat";
import { STRATEGIES } from "./strategies/registry";
import type { AnyStrategy, StrategyConfig } from "./strategies/types";
import { END_REASONS, type SessionConfig, type SessionResult } from "./types";
import { evPerWageredWithSE, INVARIANT_SCENARIO, REGRESSION_MARKET, REGRESSION_MASTER, REGRESSION_SESSIONS, sessionConfig } from "./testUtils";

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

export const GOLDEN_GAMES: Game[] = [
  GAME_PRESETS.find((g) => g.id === "european")!,
  GAME_PRESETS.find((g) => g.id === "american")!,
  GAME_PRESETS.find((g) => g.id === "fairCoin")!,
  { id: "straight35", name: "European single number (35:1)", winProb: 1 / 37, netPayout: 35 },
  { id: "dozen2", name: "European dozen (2:1)", winProb: 12 / 37, netPayout: 2 },
];

const SCENARIOS: [string, SessionConfig][] = [
  ["invariant", INVARIANT_SCENARIO],
  ["allIn", sessionConfig({ startBankroll: 20_000, baseBet: 300, tableMin: 100, maxRounds: 400, insufficientFunds: "allIn" })],
];

const CUSTOM = compileRule({
  kind: "progression",
  name: "golden custom",
  startUnits: 1,
  onWin: [{ when: { type: "cycleProfit", atLeast: 3 }, then: { type: "resetCycle" } }, { then: { type: "multiply", by: 1.5 } }],
  onLoss: [{ when: { type: "lossStreak", atLeast: 3 }, then: { type: "reset" } }, { then: { type: "add", units: 1 } }],
});

const SPECS: [string, AnyStrategy, StrategyConfig][] = [
  ...STRATEGIES.map((s): [string, AnyStrategy, StrategyConfig] => [s.id, s, s.id === "kelly" ? { assumedWinProb: 0.6, fraction: 1 } : { ...s.defaultConfig }]),
  ["custom", CUSTOM, {}],
];

/** Sessions stored in full per cell, and sessions (with full paths) covered by the digest. */
const STORED = 50;
const DIGESTED = 2000;

type Row = number[]; // [final, rounds, wagered, peak, maxDrawdown, longestLosingStreak, endReason index]

function row(r: SessionResult): Row {
  return [r.finalBankroll, r.rounds, r.totalWagered, r.peak, r.maxDrawdown, r.longestLosingStreak, END_REASONS.indexOf(r.endReason)];
}

/** 64-bit FNV-1a (two 32-bit halves) over every number of every result and its full path. */
function digest(results: SessionResult[]): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ 0x5bd1e995;
  const mix = (x: number) => {
    const s = String(x);
    for (let k = 0; k < s.length; k++) {
      const c = s.charCodeAt(k);
      h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
      h2 = Math.imul(h2 ^ c, 0x01000193 ^ 0x2f) >>> 0;
    }
    h1 = Math.imul(h1 ^ 44, 0x01000193) >>> 0; // separator
    h2 = Math.imul(h2 ^ 44, 0x01000193 ^ 0x2f) >>> 0;
  };
  for (const r of results) {
    for (const v of row(r)) mix(v);
    for (const b of r.path!.bankroll) mix(b);
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

type Cell = { stored: Row[]; digest: string };

function computeCell(game: Game, cfg: SessionConfig, strategy: AnyStrategy, config: StrategyConfig, master: number): Cell {
  const results: SessionResult[] = [];
  for (let i = 0; i < DIGESTED; i++) results.push(runSession(game, strategy, config, cfg, sessionSeed(master, i), { recordPath: true }));
  return { stored: results.slice(0, STORED).map(row), digest: digest(results) };
}

const cells = () =>
  GOLDEN_GAMES.flatMap((game, gi) =>
    SCENARIOS.flatMap(([sName, cfg], si) => SPECS.map(([name, strategy, config]) => ({ key: `${game.id}/${sName}/${name}`, game, cfg, strategy, config, master: 9000 + 10 * gi + si }))),
  );

describe.skipIf(env.GOLDEN !== "write")("golden capture (writes runner.golden.json)", () => {
  it("captures", async () => {
    const out: Record<string, Cell> = {};
    for (const c of cells()) out[c.key] = computeCell(c.game, c.cfg, c.strategy, c.config, c.master);
    // The regression test's "before": Flat, -110 / -110 market, $5 base, stops on, 100k sessions,
    // under the pre-carry rule (Math.round per win). Only meaningful when captured from the old runner.
    const market = sportsGame(REGRESSION_MARKET);
    if (!market.ok) throw new Error("bad market");
    const game: Game = { id: "sports", name: "Sports odds", winProb: market.winProb, netPayout: market.netPayout };
    const results: SessionResult[] = [];
    for (let i = 0; i < REGRESSION_SESSIONS; i++) results.push(runSession(game, flat, { units: 1 }, INVARIANT_SCENARIO, sessionSeed(REGRESSION_MASTER, i)));
    const { ev, se } = evPerWageredWithSE(results, INVARIANT_SCENARIO.startBankroll);
    const oldRule = { rule: "Math.round(bet * netPayout) per win, no carry (runner before session 11)", sessions: REGRESSION_SESSIONS, master: REGRESSION_MASTER, ev, se, z: (ev + edge(game)) / se };
    // Specifier through a variable: the app tsconfig has no Node types, and this branch only runs in Node.
    const fsName = "node:fs";
    const fs = (await import(/* @vite-ignore */ fsName)) as { writeFileSync(u: URL, s: string): void };
    fs.writeFileSync(new URL("./runner.golden.json", import.meta.url), JSON.stringify({ oldRule, cells: out }) + "\n");
  });
});

describe("even and integer payouts are bit-identical to the pre-carry runner", () => {
  const stored = (golden as { cells: Record<string, Cell> }).cells;
  for (const c of cells()) {
    it(c.key, () => {
      const want = stored[c.key];
      expect(want, "missing golden cell").toBeDefined();
      const got = computeCell(c.game, c.cfg, c.strategy, c.config, c.master);
      expect(got.stored).toEqual(want!.stored);
      expect(got.digest).toBe(want!.digest);
    });
  }
  it("covers 5 games x 2 scenarios x 9 strategies", () => {
    expect(Object.keys(stored)).toHaveLength(GOLDEN_GAMES.length * SCENARIOS.length * SPECS.length);
  });
});
