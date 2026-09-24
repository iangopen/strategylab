import { describe, expect, it } from "vitest";
import { sportsGame, type SportsInput } from "../engine/odds";
import { PUSH_NOTE, sportsReadoutLines } from "./sportsReadout";

const lines = (input: SportsInput) => {
  const r = sportsGame(input);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return Object.fromEntries(sportsReadoutLines(r.readout).map((l) => [l.label, l.value]));
};
const market = (sideA: number, sideB: number): SportsInput => ({ mode: "market", format: "american", sideA, sideB, side: "a", estimate: 0.5 });

describe("sports readout lines", () => {
  it("-110 / -110: implied 52.381% each, overround 4.762%, fair 50.000%, payout 0.9091, house edge 4.545%", () => {
    expect(lines(market(-110, -110))).toEqual({
      "Implied probability, side A": "52.381%",
      "Implied probability, side B": "52.381%",
      "Overround (the vig)": "4.762%",
      "Fair probability of your side (proportional de-vig)": "50.000%",
      "Net payout": "0.9091 per $1 staked",
      "House edge": "4.545% of every dollar wagered",
    });
  });

  it("a negative overround says it is rare and usually a data-entry error, not just 'player edge'", () => {
    const l = lines(market(110, 110));
    expect(l["Overround (the vig)"]).toBe("-4.762%");
    expect(l["Player edge"]).toBe("5.000% of every dollar wagered");
    expect(l["Check these prices"]).toMatch(/rare in real markets and is usually a data-entry error/);
  });

  it("my estimate: implied probability of the price, the estimate, and a plain statement about a believed edge", () => {
    const l = lines({ mode: "estimate", format: "american", sideA: -110, sideB: -110, side: "a", estimate: 0.55 });
    expect(l["Implied probability of your price (includes the vig)"]).toBe("52.381%");
    expect(l["Your estimated win probability"]).toBe("55.000%");
    expect(l["Player edge"]).toBe("5.000% of every dollar wagered");
    expect(l["About this edge"]).toMatch(/believing you have an edge is not the same as having one/);
    expect(l["Fair probability of your side (proportional de-vig)"]).toBeUndefined();
  });

  it("the push note is one plain line", () => {
    expect(PUSH_NOTE).toBe("Two-way markets only: pushes (a tie that returns the stake) are not modeled.");
  });
});

// Tone: the sports UI and math must not read like a tipster. Scan the sources (comments included).
const sources = {
  ...import.meta.glob<string>("./SportsOddsFields.tsx", { query: "?raw", import: "default", eager: true }),
  ...import.meta.glob<string>("./sportsReadout.ts", { query: "?raw", import: "default", eager: true }),
  ...import.meta.glob<string>("./ConfigPanel.tsx", { query: "?raw", import: "default", eager: true }),
  ...import.meta.glob<string>("../engine/odds.ts", { query: "?raw", import: "default", eager: true }),
};
const BANNED = [/\bpicks?\b/i, /\bsharps?\b/i, /value bets?/i, /\bguarantee/i, /winning system/i, /\bsure thing\b/i, /draftkings|fanduel|betmgm|caesars|bet365|pinnacle|bovada|betfair|william hill/i, /https?:\/\//i];

describe("sports tone: no sportsbook names, links, picks, 'sharp' or 'value bet' language", () => {
  it("found the sources", () => expect(Object.keys(sources)).toHaveLength(4));
  for (const [file, src] of Object.entries(sources)) {
    it(file, () => {
      for (const re of BANNED) expect(src, String(re)).not.toMatch(re);
    });
  }
});
