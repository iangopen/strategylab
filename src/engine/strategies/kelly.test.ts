import { describe, expect, it } from "vitest";
import type { Game } from "../games";
import { sessionSeed } from "../rng";
import { runSession } from "../runner";
import { betSequence, describeEvInvariant, expectPure, gameView, sessionConfig, L, W } from "../testUtils";
import { kelly } from "./kelly";

describe("kelly: f* and the do-not-play rule (no runner)", () => {
  it("f* <= 0 returns \"stop\" (Kelly says do not play)", () => {
    // Even money, true prob 0.5: f* = (1*0.5 - 0.5)/1 = 0. Not positive -> stop.
    expect(betSequence(kelly, { fraction: 1 }, [W, W])).toEqual(["stop", "stop", "stop"]);
    // A misjudged edge BELOW the true probability is still no edge: also stop.
    expect(betSequence(kelly, { assumedWinProb: 0.4, fraction: 1 }, [W])).toEqual(["stop", "stop"]);
  });

  it("f* > 0 bets fraction × f* × bankroll (bankroll is fixed at 1e9 in this harness)", () => {
    // Kelly returns an unrounded stake; the runner rounds to whole cents, so compare the rounded bet.
    const rounded = (bets: (number | "stop")[]) => bets.map((b) => (typeof b === "number" ? Math.round(b) : b));
    // Assumed 0.6, b = 1: f* = 0.2. Full Kelly stakes 0.2 × 1e9 = 2e8.
    expect(rounded(betSequence(kelly, { assumedWinProb: 0.6, fraction: 1 }, [L]))).toEqual([200_000_000, 200_000_000]);
    // Half Kelly halves the stake.
    expect(rounded(betSequence(kelly, { assumedWinProb: 0.6, fraction: 0.5 }, [L]))).toEqual([100_000_000, 100_000_000]);
    // Payout 2, assumed 0.5: f* = (2*0.5 - 0.5)/2 = 0.25 -> stakes 0.25 × 1e9.
    expect(rounded(betSequence(kelly, { assumedWinProb: 0.5, fraction: 1 }, [L], 100, gameView(2)))).toEqual([250_000_000, 250_000_000]);
  });
});

describe("kelly: blank assumedWinProb (optionalNumber) behaves as the old 0 sentinel did", () => {
  // The old 0 meant "use the game's true win probability", so blank must equal an explicit true p,
  // session for session, on a game where Kelly bets and on one where it refuses to.
  const cfg = sessionConfig({ startBankroll: 100_000, baseBet: 500, tableMin: 100, tableMax: 25_000, stopWin: 150_000, stopLoss: 50_000, maxRounds: 1000 });
  const games: Game[] = [
    { id: "posEdge", name: "p=0.55", winProb: 0.55, netPayout: 1 },
    { id: "payout2", name: "p=0.4, payout 2", winProb: 0.4, netPayout: 2 },
    { id: "european", name: "European", winProb: 18 / 37, netPayout: 1 },
  ];
  for (const game of games) {
    it(`${game.id}: 2,000 sessions identical to assumedWinProb = true p`, () => {
      let rounds = 0;
      for (let i = 0; i < 2000; i++) {
        const seed = sessionSeed(55, i);
        const blank = runSession(game, kelly, { fraction: 1 }, cfg, seed);
        const explicit = runSession(game, kelly, { assumedWinProb: game.winProb, fraction: 1 }, cfg, seed);
        expect(blank).toEqual(explicit);
        rounds += blank.rounds;
      }
      if (game.id === "european") expect(rounds).toBe(0); // f* < 0: refuses to bet, as before
      else expect(rounds).toBeGreaterThan(2000);
    });
  }
});

describe("kelly: purity", () => {
  it("does not mutate deep-frozen config, state, or ctx", () => {
    expectPure(kelly, { assumedWinProb: 0.6, fraction: 1 });
    expectPure(kelly, { fraction: 0.5 });
  });
});

// The invariant needs Kelly to actually bet on all three games, so it uses an assumed edge above
// 0.5 (a misjudged edge). EV per $ wagered is still -edge, whatever the (mis)sizing.
describeEvInvariant(kelly, { assumedWinProb: 0.6, fraction: 1 });

// ---------------------------------------------------------------------------------------------
// Kelly's defining property: on a +edge game, log-growth is maximised at full Kelly. Same session
// seeds for every fraction (CRN), so the differences are paired and their SE is tight.
describe("kelly: full Kelly maximises long-run growth", () => {
  const posEdge: Game = { id: "posEdge", name: "Positive edge (p=0.55, even money)", winProb: 0.55, netPayout: 1 };
  const start = 100_000_000; // $1,000,000, so 200 rounds never grind down to the table minimum
  const cfg = sessionConfig({ startBankroll: start, baseBet: 100, tableMin: 1, tableMax: null, stopWin: null, stopLoss: null, maxRounds: 200 });
  const n = 4000;
  const master = 909;

  const finals = (fraction: number) => {
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = runSession(posEdge, kelly, { fraction }, cfg, sessionSeed(master, i)).finalBankroll;
    return out;
  };

  it("mean log(final/start) is highest at fraction 1 vs 0.5 and 2 (each beyond 4 SE), and fraction 2's median is below start", () => {
    const f05 = finals(0.5);
    const f1 = finals(1);
    const f2 = finals(2);
    expect(Math.min(...f05, ...f1, ...f2)).toBeGreaterThan(0); // no session grinds to ruin (log stays finite)

    const meanLog = (a: Float64Array) => Array.from(a).reduce((s, v) => s + Math.log(v / start), 0) / n;
    // Paired difference of per-session log growth and its SE (CRN makes this pairing valid).
    const pairedZ = (a: Float64Array, b: Float64Array) => {
      const d = Array.from(a, (v, i) => Math.log(v / start) - Math.log(b[i]! / start));
      const mean = d.reduce((s, v) => s + v, 0) / n;
      const varr = d.reduce((s, v) => s + (v - mean) * (v - mean), 0) / (n - 1);
      return { mean, se: Math.sqrt(varr / n) };
    };
    const median = (a: Float64Array) => {
      const s = Array.from(a).sort((x, y) => x - y);
      return (s[Math.floor((n - 1) / 2)]! + s[Math.ceil((n - 1) / 2)]!) / 2;
    };

    const g05 = meanLog(f05);
    const g1 = meanLog(f1);
    const g2 = meanLog(f2);
    const d1 = pairedZ(f1, f05);
    const d2 = pairedZ(f1, f2);
    console.log(`[kelly growth] meanLog: half=${g05.toFixed(4)} full=${g1.toFixed(4)} double=${g2.toFixed(4)}`);
    console.log(`[kelly growth] full-half: mean=${d1.mean.toFixed(4)} SE=${d1.se.toFixed(4)} z=${(d1.mean / d1.se).toFixed(1)}`);
    console.log(`[kelly growth] full-double: mean=${d2.mean.toFixed(4)} SE=${d2.se.toFixed(4)} z=${(d2.mean / d2.se).toFixed(1)}`);
    console.log(`[kelly growth] fraction-2 median final=${(median(f2) / 100).toFixed(2)} vs start ${start / 100}`);

    expect(g1).toBeGreaterThan(g05);
    expect(g1).toBeGreaterThan(g2);
    expect(d1.mean).toBeGreaterThan(4 * d1.se);
    expect(d2.mean).toBeGreaterThan(4 * d2.se);
    expect(median(f2)).toBeLessThan(start); // over-betting: the typical session loses ground
  });
});
