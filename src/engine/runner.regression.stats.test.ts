import { describe, expect, it } from "vitest";
import golden from "./runner.golden.json";
import { edge, type Game } from "./games";
import { sportsGame } from "./odds";
import { sessionSeed } from "./rng";
import { runSession } from "./runner";
import { flat } from "./strategies/flat";
import { evPerWageredWithSE, INVARIANT_SCENARIO, REGRESSION_MARKET, REGRESSION_MASTER, REGRESSION_SESSIONS } from "./testUtils";
import type { SessionResult } from "./types";

// The regression the session 11 carry fixes. Flat at $5 on -110 / -110: every win used to pay 455
// cents for an exact 454.545..., a +0.0455% shift in EV per $ that the SE shrinks toward at scale.
// "Before" was captured from the pre-carry runner with the SAME seeds (runner.golden.json, oldRule),
// so the two runs see identical outcomes and differ only in what a win pays.
describe("regression: -110 / -110, $5 base, Flat, 100,000 sessions, stops on", () => {
  it("EV per $ wagered is within 4 SE of -edge (it was ~5 SE away before the carry)", () => {
    const m = sportsGame(REGRESSION_MARKET);
    if (!m.ok) throw new Error("bad market");
    const game: Game = { id: "sports", name: "Sports odds", winProb: m.winProb, netPayout: m.netPayout };
    const results: SessionResult[] = [];
    for (let i = 0; i < REGRESSION_SESSIONS; i++) results.push(runSession(game, flat, { units: 1 }, INVARIANT_SCENARIO, sessionSeed(REGRESSION_MASTER, i)));
    const { ev, se } = evPerWageredWithSE(results, INVARIANT_SCENARIO.startBankroll);
    const expected = -edge(game);
    const z = (ev - expected) / se;
    const old = golden.oldRule;
    expect(old.sessions).toBe(REGRESSION_SESSIONS);
    expect(old.master).toBe(REGRESSION_MASTER);
    console.log(
      `[regression] -110 flat $5, ${REGRESSION_SESSIONS} sessions, -edge ${(expected * 100).toFixed(4)}%:\n` +
        `  before (Math.round per win): EV per $ ${(old.ev * 100).toFixed(4)}%, SE ${(old.se * 100).toFixed(4)}%, z ${old.z.toFixed(2)}\n` +
        `  after  (sub-cent carry):     EV per $ ${(ev * 100).toFixed(4)}%, SE ${(se * 100).toFixed(4)}%, z ${z.toFixed(2)}`,
    );
    expect(Math.abs(ev - expected)).toBeLessThan(4 * se);
  });
});
