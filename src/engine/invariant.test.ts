import { describe, expect, it } from "vitest";
import { edge, GAME_PRESETS, type Game } from "./games";
import { sportsGame, type SportsInput } from "./odds";
import { sessionSeed } from "./rng";
import { compileRule } from "./rules/compile";
import { runSession } from "./runner";
import { STRATEGIES } from "./strategies/registry";
import type { AnyStrategy, StrategyConfig } from "./strategies/types";
import { evPerWageredWithSE, INVARIANT_SCENARIO, INVARIANT_SESSIONS } from "./testUtils";
import type { SessionResult } from "./types";

// THE full invariant table: EV per $ wagered = -edge for all 8 built-ins plus a custom rule, on five
// games (three even-money, two sports-odds games with a non-integer payout), the shared invariant
// scenario, 20,000 sessions, 4 SE with the SE from the samples. Seeds match describeEvInvariant
// (101, 202, 303) and the session 8 sports test (808, 809). Since session 11 the runner pays wins
// with a per-session sub-cent carry, so there is no cents-rounding shift to allow for: if a
// non-integer-payout row fails, the carry is the first suspect. The tolerance never changes.

function gameOf(input: SportsInput, id: string): Game {
  const r = sportsGame(input);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return { id, name: id, winProb: r.winProb, netPayout: r.netPayout };
}

const CUSTOM = compileRule({
  kind: "progression",
  name: "invariant custom",
  startUnits: 1,
  onWin: [{ when: { type: "winStreak", atLeast: 2 }, then: { type: "resetCycle" } }, { then: { type: "multiply", by: 1.5 } }],
  onLoss: [{ when: { type: "lossStreak", atLeast: 3 }, then: { type: "reset" } }, { then: { type: "add", units: 1 } }],
});

const market: Game = gameOf({ mode: "market", format: "american", sideA: -110, sideB: -110, side: "a", estimate: 0.5 }, "-110/-110 market");
const estimate: Game = gameOf({ mode: "estimate", format: "american", sideA: -110, sideB: -110, side: "a", estimate: 0.55 }, "-110 estimate 0.55");

// Kelly bets only when it believes in an edge: a misjudged 0.6 everywhere except the estimate game,
// where its default (blank = the game's 0.55) already sees one.
const MISJUDGED: StrategyConfig = { assumedWinProb: 0.6, fraction: 1 };
const GAMES: [Game, number, StrategyConfig][] = [
  [GAME_PRESETS.find((g) => g.id === "european")!, 101, MISJUDGED],
  [GAME_PRESETS.find((g) => g.id === "fairCoin")!, 202, MISJUDGED],
  [{ id: "posEdge", name: "p = 0.55, even money", winProb: 0.55, netPayout: 1 }, 303, MISJUDGED],
  [market, 808, MISJUDGED],
  [estimate, 809, { fraction: 1 }],
];

function specs(kellyConfig: StrategyConfig): [string, AnyStrategy, StrategyConfig][] {
  return [
    ...STRATEGIES.map((s): [string, AnyStrategy, StrategyConfig] => [s.id, s, s.id === "kelly" ? kellyConfig : { ...s.defaultConfig }]),
    ["custom rule", CUSTOM, {}],
  ];
}

const table = new Map<string, Map<string, string>>(); // strategy -> game -> "EV% (z)"

describe("EV per $ wagered = -edge: 8 built-ins + a custom rule x 5 games, every |z| < 4", () => {
  it("the market compiles to fair p 0.5, payout 10/11, edge 1/22; the estimate game to edge -0.05", () => {
    expect(market.winProb).toBeCloseTo(0.5, 15);
    expect(market.netPayout).toBe(100 / 110);
    expect(edge(market)).toBeCloseTo(1 / 22, 15);
    expect(edge(estimate)).toBeCloseTo(-0.05, 15);
  });

  for (const [game, master, kellyConfig] of GAMES) {
    it(`${game.name} (edge ${(edge(game) * 100).toFixed(3)}%, seed ${master})`, { timeout: 300_000 }, () => {
      const expected = -edge(game);
      for (const [name, strategy, config] of specs(kellyConfig)) {
        const results: SessionResult[] = [];
        for (let i = 0; i < INVARIANT_SESSIONS; i++) results.push(runSession(game, strategy, config, INVARIANT_SCENARIO, sessionSeed(master, i)));
        const { ev, se } = evPerWageredWithSE(results, INVARIANT_SCENARIO.startBankroll);
        const z = (ev - expected) / se;
        if (!table.has(name)) table.set(name, new Map());
        table.get(name)!.set(game.name, `${(ev * 100).toFixed(3)}% (${z.toFixed(2)})`);
        expect(Math.abs(ev - expected), `${name} on ${game.name}: EV/$ ${ev} vs ${expected}, SE ${se}, z ${z.toFixed(2)}`).toBeLessThan(4 * se);
      }
    });
  }

  it("prints the table", () => {
    const names = GAMES.map(([g]) => g.name);
    const head = `| Strategy | ${GAMES.map(([g]) => `${g.name}: EV per $ (z), -edge ${(-edge(g) * 100).toFixed(3)}%`).join(" | ")} |`;
    const rows = [...table].map(([s, cells]) => `| ${s} | ${names.map((n) => cells.get(n) ?? "not run").join(" | ")} |`);
    console.log(`[invariant table] ${INVARIANT_SESSIONS} sessions per cell, 4 SE:\n${head}\n|${"---|".repeat(names.length + 1)}\n${rows.join("\n")}`);
  });
});
