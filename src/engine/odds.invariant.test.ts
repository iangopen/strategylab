import { describe, expect, it } from "vitest";
import { edge, type Game } from "./games";
import { payoutRoundingBias, sportsGame, type SportsInput } from "./odds";
import { sessionSeed } from "./rng";
import { compileRule } from "./rules/compile";
import { runSession } from "./runner";
import { STRATEGIES } from "./strategies/registry";
import type { AnyStrategy, StrategyConfig } from "./strategies/types";
import { evPerWageredWithSE, INVARIANT_SCENARIO, INVARIANT_SESSIONS } from "./testUtils";
import type { SessionResult } from "./types";

// Sports odds compile to an ordinary Game, so the core invariant (EV per $ wagered = -edge) must hold
// on it for every strategy: all 8 built-ins plus one custom rule, the shared invariant scenario,
// 20,000 sessions, 4 SE with the SE from the samples. Rounding of non-even payouts to cents is the
// first suspect if anything fails (see "Cents rounding bias" in CLAUDE.md); the tolerance stays.

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

const market: Game = gameOf({ mode: "market", format: "american", sideA: -110, sideB: -110, side: "a", estimate: 0.5 }, "sports -110/-110");
const estimate: Game = gameOf({ mode: "estimate", format: "american", sideA: -110, sideB: -110, side: "a", estimate: 0.55 }, "sports -110 est 0.55");

function specs(kellyConfig: StrategyConfig): [string, AnyStrategy, StrategyConfig][] {
  return [
    ...STRATEGIES.map((s): [string, AnyStrategy, StrategyConfig] => [s.id, s, s.id === "kelly" ? kellyConfig : { ...s.defaultConfig }]),
    ["custom rule", CUSTOM, {}],
  ];
}

function runInvariant(game: Game, master: number, kellyConfig: StrategyConfig) {
  const expected = -edge(game);
  const rows: string[] = [];
  let worst = 0;
  for (const [name, strategy, config] of specs(kellyConfig)) {
    const results: SessionResult[] = [];
    for (let i = 0; i < INVARIANT_SESSIONS; i++) results.push(runSession(game, strategy, config, INVARIANT_SCENARIO, sessionSeed(master, i)));
    const { ev, se } = evPerWageredWithSE(results, INVARIANT_SCENARIO.startBankroll);
    const z = (ev - expected) / se;
    worst = Math.max(worst, Math.abs(z));
    rows.push(`| ${name} | ${(ev * 100).toFixed(3)}% | ${(expected * 100).toFixed(3)}% | ${(se * 100).toFixed(3)}% | ${z.toFixed(2)} |`);
    expect(Math.abs(ev - expected), `${name}: EV/$ ${ev} vs ${expected}, SE ${se}, z ${z.toFixed(2)}`).toBeLessThan(4 * se);
    if (name === "flat") {
      // Flat bets one size, so its cents-rounding shift is known exactly: check it against the
      // rounding-aware value too, and print how many SE the rounding alone accounts for.
      const bias = payoutRoundingBias(INVARIANT_SCENARIO.baseBet, game.netPayout, game.winProb);
      const zr = (ev - (expected + bias)) / se;
      console.log(`[sports invariant] flat: rounding shift ${(bias * 100).toFixed(4)}% = ${(bias / se).toFixed(2)} SE; z vs -edge ${z.toFixed(2)}, z vs rounding-aware ${zr.toFixed(2)}`);
      expect(Math.abs(zr)).toBeLessThan(4);
    }
  }
  console.log(`[sports invariant] ${game.name} (winProb ${game.winProb}, netPayout ${game.netPayout}, edge ${(edge(game) * 100).toFixed(4)}%), ${INVARIANT_SESSIONS} sessions each:\n| Strategy | EV per $ | -edge | SE | z |\n|---|---|---|---|---|\n${rows.join("\n")}\nworst |z| = ${worst.toFixed(2)}`);
}

describe("sports odds: EV per $ wagered = -edge for every strategy (the Game abstraction holds)", () => {
  it("the market compiles to fair p 0.5, payout 10/11, edge 1/22", () => {
    expect(market.winProb).toBeCloseTo(0.5, 15);
    expect(market.netPayout).toBe(100 / 110);
    expect(edge(market)).toBeCloseTo(1 / 22, 15);
    // Flat at the invariant scenario's $5 base: each win pays 455c instead of 454.545c.
    console.log(`[sports invariant] flat $5 rounding bias on this game: ${(payoutRoundingBias(INVARIANT_SCENARIO.baseBet, market.netPayout, market.winProb) * 100).toFixed(4)}% per $ (+0.0455%)`);
  });

  it("-110 / -110 market: all 8 built-ins + a custom rule within 4 SE of -edge", () => {
    // Kelly at the FAIR probability sees no edge and refuses to bet (0/0), so it gets a misjudged
    // edge here, as in every other invariant test.
    runInvariant(market, 808, { assumedWinProb: 0.6, fraction: 1 });
  }, 300_000);

  it("my estimate 0.55 on -110: edge -0.05, and the invariant holds with the sign flipped (EV per $ ≈ +5%)", () => {
    expect(edge(estimate)).toBeCloseTo(-0.05, 15);
    // Kelly's default (blank = the game's probability, 0.55) now sees a positive f* and bets.
    runInvariant(estimate, 809, { fraction: 1 });
  }, 300_000);
});
