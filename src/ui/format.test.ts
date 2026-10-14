import { describe, expect, it } from "vitest";
import { MARTINGALE_RULE, PAROLI_RULE } from "../engine/rules/examples";
import { newCustomInstance, newStrategyInstance } from "../scenario";
import { STATS } from "../engine/stats/registry";
import { CUSTOM_RULE_FALLBACK_LABEL, formatElapsed, formatInterval, instanceLabel, INTERVAL_ROWS, replayAnnouncement, runAnnouncement, TABLE_ROWS } from "./format";

describe("instanceLabel", () => {
  it("built-ins use the registry label; custom rules use their name; shared labels are numbered", () => {
    const list = [newStrategyInstance("flat"), newCustomInstance(MARTINGALE_RULE), newStrategyInstance("flat"), newCustomInstance(MARTINGALE_RULE), newCustomInstance(PAROLI_RULE)];
    expect(list.map((_, i) => instanceLabel(list, i))).toEqual(["Flat #1", `${MARTINGALE_RULE.name} #1`, "Flat #2", `${MARTINGALE_RULE.name} #2`, PAROLI_RULE.name]);
  });

  it("a rule without a usable name falls back to a generic label", () => {
    const list = [newCustomInstance({ kind: "progression", name: "  " }), newCustomInstance(["not", "a", "rule"])];
    expect(list.map((_, i) => instanceLabel(list, i))).toEqual([`${CUSTOM_RULE_FALLBACK_LABEL} #1`, `${CUSTOM_RULE_FALLBACK_LABEL} #2`]);
  });
});

describe("formatElapsed", () => {
  it("under 0.1 s shows <0.1s, never 0.0s; otherwise one decimal", () => {
    expect([0, 1, 49, 99.9].map(formatElapsed)).toEqual(["<0.1s", "<0.1s", "<0.1s", "<0.1s"]);
    expect([100, 149, 1234, 20_400].map(formatElapsed)).toEqual(["0.1s", "0.1s", "1.2s", "20.4s"]);
  });
});

describe("announcements (screen-reader text)", () => {
  it("a finished run reads EV per $ with the theory, and P(profit), per strategy; an undefined EV is said in words", () => {
    const cols = [
      { label: "Flat", stats: { evPerWagered: -0.02758, evTheory: -0.027027, pProfit: 0.5376 } },
      { label: "Kelly", stats: { evPerWagered: NaN, evTheory: -0.027027, pProfit: 0 } },
    ];
    expect(runAnnouncement(cols)).toBe(
      "Results ready. EV per $ wagered: Flat -2.76%, Kelly not defined (no bets placed); theory -2.70%. P(profit > 0): Flat 53.8%, Kelly 0.0%. The full table follows.",
    );
  });

  it("a replay reads the legend lines", () => {
    expect(replayAnnouncement(1234, ["Flat: a", "Martingale: b"])).toBe("Replay of session 1,234: Flat: a; Martingale: b.");
  });
});

describe("formatInterval (the one interval display)", () => {
  it("renders a proportion as point (low–high%), one decimal by default", () => {
    expect(formatInterval(0.1707, 0.16345, 0.1782)).toBe("17.1% (16.3–17.8%)");
    expect(formatInterval(0.1707, 0.16345, 0.1782, 3)).toBe("17.070% (16.345–17.820%)");
  });

  it("0% and 100% bounds print as 0.0% and 100.0%", () => {
    expect(formatInterval(0, 0, 0.27754)).toBe("0.0% (0.0–27.8%)");
    expect(formatInterval(1, 0.72246, 1)).toBe("100.0% (72.2–100.0%)");
    expect(formatInterval(0, 0, 0.000184, 2)).toBe("0.00% (0.00–0.02%)");
  });

  it("a negative bound spells the range out with 'to', so a minus is never read as a dash", () => {
    expect(formatInterval(-0.02758, -0.02841, -0.02675, 2)).toBe("-2.76% (-2.84% to -2.68%)");
    expect(formatInterval(0.001, -0.004, 0.006, 1)).toBe("0.1% (-0.4% to 0.6%)");
  });

  it("a missing point is a dash; missing bounds leave the point alone", () => {
    expect(formatInterval(NaN, 0, 1)).toBe("—");
    expect(formatInterval(undefined, 0, 1)).toBe("—");
    expect(formatInterval(0.5, NaN, NaN)).toBe("50.0%");
    expect(formatInterval(0.5, undefined, 0.6)).toBe("50.0%");
  });
});

describe("results table rows", () => {
  it("fold each interval's low/high rows into its point row, keeping registry order", () => {
    const parts = Object.values(INTERVAL_ROWS).flat();
    expect(TABLE_ROWS.map((r) => r.id)).toEqual(STATS.map((s) => s.id).filter((id) => !parts.includes(id)));
    expect(TABLE_ROWS.find((r) => r.id === "pBust")!.label).toBe("P(bust: ruin or couldn't cover bet), with 95% interval");
    for (const id of parts) expect(STATS.some((s) => s.id === id), id).toBe(true);
  });

  it("table precision matches the report: one decimal inside intervals, two for EV per $; raw keeps every number exactly", () => {
    const row = TABLE_ROWS.find((r) => r.id === "pBust")!;
    const stats = { pBust: 0.1707, pBustLow: 0.16345, pBustHigh: 0.1782 };
    expect(row.cell(stats)).toBe("17.1% (16.3–17.8%)");
    expect(TABLE_ROWS.find((r) => r.id === "pProfit")!.cell({ pProfit: 0.5376, pProfitLow: 0.52782, pProfitHigh: 0.54736 })).toBe("53.8% (52.8–54.7%)");
    expect(row.raw(stats)).toBe("0.1707|0.16345|0.1782");
    const ev = TABLE_ROWS.find((r) => r.id === "evPerWagered")!;
    expect(ev.cell({ evPerWagered: -0.02758 })).toBe("-2.76%");
    expect(TABLE_ROWS.find((r) => r.id === "evTheory")!.cell({ evTheory: -1 / 37 })).toBe("-2.70%");
    expect(ev.cell({ evPerWagered: NaN })).toBe("—");
    // The SE row keeps three decimals, or a typical 0.042% would read as 0.04%.
    expect(TABLE_ROWS.find((r) => r.id === "evSE")!.cell({ evSE: 0.00042 })).toBe("0.042%");
    expect(ev.raw({ evPerWagered: 0.1 + 0.2 })).toBe("0.30000000000000004");
  });

  it("every percent row's decimals: one for every share of sessions, two for EV per $ and theory, three for its SE", () => {
    const v = 0.123456;
    const digits = (id: string) => {
      const row = TABLE_ROWS.find((r) => r.id === id)!;
      const parts = INTERVAL_ROWS[id];
      const text = row.cell(parts ? { [id]: v, [parts[0]]: v, [parts[1]]: v } : { [id]: v });
      return /^\d+\.(\d+)%/.exec(text)![1]!.length;
    };
    const pctRows = TABLE_ROWS.filter((r) => STATS.find((s) => s.id === r.id)!.format === "pct").map((r) => [r.id, digits(r.id)]);
    expect(Object.fromEntries(pctRows)).toEqual({
      evPerWagered: 2,
      evSE: 3,
      evTheory: 2,
      pProfit: 1,
      pBust: 1,
      pHitWin: 1,
      pDrawdownHalf: 1,
      end_ruin: 1,
      end_insufficientFunds: 1,
      end_stopWin: 1,
      end_stopLoss: 1,
      end_maxRounds: 1,
      end_strategyStop: 1,
    });
  });

  it("the rounds-to-bust rows say they count busted sessions only", () => {
    for (const id of ["bustRoundsMedian", "bustRoundsP10"]) expect(TABLE_ROWS.find((r) => r.id === id)!.label).toMatch(/\(busted sessions only\)$/);
  });
});
