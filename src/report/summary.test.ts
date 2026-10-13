import { describe, expect, it } from "vitest";
import { MARTINGALE_RULE } from "../engine/rules/examples";
import { defaultScenario, newCustomInstance, newStrategyInstance, sportsScenarioGame, ticketExampleGame, type ScenarioConfig } from "../scenario";
import * as layout from "./layout";
import { edgeText, gameText, REPORT_ROWS, scenarioSummary, strategyText } from "./summary";

describe("report configuration summary", () => {
  it("the default scenario in words: every setting a rerun needs", () => {
    const s = defaultScenario();
    expect(scenarioSummary(s, ["Flat", "Martingale"])).toEqual([
      { label: "Game", value: "European roulette (even-money); house edge 2.703%" },
      { label: "Bankroll", value: "$1,000.00 to start; base bet $10.00" },
      { label: "Table limits", value: "minimum $1.00; no maximum" },
      { label: "Stops", value: "win target $1,100.00; no loss floor" },
      { label: "Rounds", value: "at most 1,000 per session; if a bet can't be covered, the session stops" },
      { label: "Sessions and seed", value: "10,000 sessions per strategy; master seed 12345" },
      { label: "Strategies", value: "Flat (Units per bet: 1); Martingale (Multiplier after a loss: 2)" },
    ]);
  });

  it("sports, outcome-editor and custom games, edges of either sign, and custom rules", () => {
    const sports = sportsScenarioGame({ mode: "market", format: "american", sideA: -110, sideB: -110, side: "a", estimate: 0.5 });
    expect(gameText(sports)).toBe("Sports odds (American): -110 / -110, betting side A");
    expect(edgeText(sports)).toBe("house edge 4.545%");
    expect(gameText(ticketExampleGame())).toBe("Custom outcomes: 3 outcomes, ticket price $70.00");
    const custom: ScenarioConfig["game"] = { presetId: "custom", outcomes: [{ prob: 0.55, net: 1 }, { prob: 0.45, net: -1 }] };
    expect(gameText(custom)).toBe("Custom win/lose game: win probability 0.55, pays 1 to 1");
    expect(edgeText(custom)).toBe("player edge 10.000%");
    expect(edgeText({ presetId: "fairCoin", outcomes: [{ prob: 0.5, net: 1 }, { prob: 0.5, net: -1 }] })).toBe("fair game (no edge)");
    expect(strategyText(newCustomInstance(MARTINGALE_RULE), "Double after a loss")).toBe("Double after a loss (custom rule; the full rule is in the link)");
    expect(strategyText(newStrategyInstance("kelly"), "Kelly")).toBe("Kelly (Assumed win probability: blank (the game's own); Kelly fraction: 1)");
  });

  it("key-statistics rows use the shared interval formatter and say rounds to bust counts busted sessions only", () => {
    const stats = { evPerWagered: -0.02758, evSE: 0.00042, evTheory: -1 / 37, pProfit: 0.5376, pProfitLow: 0.52782, pProfitHigh: 0.54736, pBust: 0.016, pBustLow: 0.01372, pBustHigh: 0.01865, bustRoundsMedian: 874, bustRoundsP10: 647.4, pDrawdownHalf: 0.3087, finalP5: 24_000, medianFinal: 110_000, meanFinal: 84_222, meanWagered: 572_035 };
    expect(REPORT_ROWS.map((r) => [r.label, r.cell(stats)])).toEqual([
      ["EV per $ wagered (95% interval)", "-2.76% (-2.84% to -2.68%)"],
      ["Theoretical EV per $ (−edge)", "-2.70%"],
      ["P(profit > 0) (95% interval)", "53.8% (52.8–54.7%)"],
      ["P(bust) (95% interval)", "1.6% (1.4–1.9%)"],
      ["Median rounds to bust (busted sessions only)", "874"],
      ["p10 rounds to bust (busted sessions only)", "647.4"],
      ["P(max drawdown ≥ 50% of start)", "30.9%"],
      ["Final bankroll: p5 / median", "$240.00 / $1,100.00"],
      ["Final bankroll: mean", "$842.22"],
      ["Mean total wagered", "$5,720.35"],
    ]);
  });
});

describe("report chart layout", () => {
  it("up to 8 panels fit in at most two rows; one row gets taller panels", () => {
    const { reportChartLayout } = layout;
    const rows = (n: number) => Math.ceil(n / reportChartLayout(n).columns);
    for (let n = 1; n <= 8; n++) expect(rows(n), `n = ${n}`).toBeLessThanOrEqual(2);
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((n) => reportChartLayout(n).columns)).toEqual([1, 2, 3, 2, 3, 3, 4, 4]);
    expect(reportChartLayout(2).height).toBe(165);
    expect(reportChartLayout(5).height).toBe(92);
  });
});
