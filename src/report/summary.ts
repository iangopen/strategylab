// What the report prints about a run, as plain data (pure, no React): the configuration in words and
// the key-statistics rows. The share link carries the exact scenario; these lines make it readable.
import { edge, findPreset } from "../engine/games";
import { displayOdds } from "../engine/odds";
import { getStrategy } from "../engine/strategies/registry";
import { OUTCOMES_GAME_ID, SPORTS_GAME_ID, type ScenarioConfig, type StrategyInstance } from "../scenario";
import { formatInterval, formatStat } from "../ui/format";
import { evInterval } from "./takeaways";

export interface SummaryLine {
  label: string;
  value: string;
}

const dollars = (v: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(v);
const count = (v: number) => v.toLocaleString("en-US");
const pct3 = (v: number) => formatInterval(v, undefined, undefined, 3);

/** The game in words: its name and inputs. */
export function gameText(g: ScenarioConfig["game"]): string {
  if (g.presetId === SPORTS_GAME_ID && g.sports) {
    const s = g.sports;
    const fmt = s.format === "american" ? "American" : "decimal";
    if (s.mode === "estimate") return `Sports odds (${fmt}): ${displayOdds(s.format, s.sideA)}, with your estimated win probability ${s.estimate}`;
    return `Sports odds (${fmt}): ${displayOdds(s.format, s.sideA)} / ${displayOdds(s.format, s.sideB)}, betting side ${s.side.toUpperCase()}`;
  }
  if (g.presetId === OUTCOMES_GAME_ID) {
    const ticket = g.editor?.mode === "ticket" && g.editor.price !== null ? `, ticket price ${dollars(g.editor.price)}` : "";
    return `Custom outcomes: ${g.outcomes.length} outcomes${ticket}`;
  }
  const preset = findPreset(g.presetId);
  if (preset) return preset.name;
  const [win] = g.outcomes;
  return win ? `Custom win/lose game: win probability ${win.prob}, pays ${win.net} to 1` : "Custom game";
}

/** "house edge 2.703%", "player edge 5.000%" or "fair game". */
export function edgeText(g: ScenarioConfig["game"]): string {
  const e = edge({ outcomes: g.outcomes });
  if (Math.abs(e) < 1e-12) return "fair game (no edge)";
  return e > 0 ? `house edge ${pct3(e)}` : `player edge ${pct3(-e)}`;
}

/** One strategy instance in words: its label plus every config setting, by its form label. */
export function strategyText(inst: StrategyInstance, label: string): string {
  if (inst.kind === "custom") return `${label} (custom rule; the full rule is in the link)`;
  const strategy = getStrategy(inst.strategyId);
  if (!strategy) return label;
  const parts = strategy.configSchema.flatMap((f) => {
    const v = inst.config[f.key];
    if (v === undefined) return f.kind === "optionalNumber" ? [`${f.label}: blank (the game's own)`] : [];
    return [`${f.label}: ${typeof v === "number" ? count(v) : String(v)}`];
  });
  return parts.length > 0 ? `${label} (${parts.join("; ")})` : label;
}

/** Every setting a rerun needs, in words. The link carries the same values exactly. */
export function scenarioSummary(s: ScenarioConfig, labels: readonly string[]): SummaryLine[] {
  return [
    { label: "Game", value: `${gameText(s.game)}; ${edgeText(s.game)}` },
    { label: "Bankroll", value: `${dollars(s.startBankroll)} to start; base bet ${dollars(s.baseBet)}` },
    { label: "Table limits", value: `minimum ${dollars(s.tableMin)}; ${s.tableMax === null ? "no maximum" : `maximum ${dollars(s.tableMax)}`}` },
    { label: "Stops", value: `${s.stopWin === null ? "no win target" : `win target ${dollars(s.stopWin)}`}; ${s.stopLoss === null ? "no loss floor" : `loss floor ${dollars(s.stopLoss)}`}` },
    { label: "Rounds", value: `at most ${count(s.maxRounds)} per session; if a bet can't be covered, ${s.insufficientFunds === "stop" ? "the session stops" : "bet everything left"}` },
    { label: "Sessions and seed", value: `${count(s.sessions)} sessions per strategy; master seed ${s.seed}` },
    { label: "Strategies", value: s.strategies.map((inst, i) => strategyText(inst, labels[i] ?? `Strategy ${i + 1}`)).join("; ") },
  ];
}

/** One row of the report's key-statistics table. */
export interface ReportRow {
  label: string;
  cell: (stats: Readonly<Record<string, number>>) => string;
}

/** The key statistics, in reading order. Intervals use the shared formatter. */
export const REPORT_ROWS: readonly ReportRow[] = [
  {
    label: "EV per $ wagered (95% interval)",
    cell: (v) => {
      const iv = evInterval(v);
      return formatInterval(v.evPerWagered, iv?.low, iv?.high, 2);
    },
  },
  { label: "Theoretical EV per $ (−edge)", cell: (v) => formatInterval(v.evTheory, undefined, undefined, 2) },
  { label: "P(profit > 0) (95% interval)", cell: (v) => formatInterval(v.pProfit, v.pProfitLow, v.pProfitHigh) },
  { label: "P(bust) (95% interval)", cell: (v) => formatInterval(v.pBust, v.pBustLow, v.pBustHigh) },
  { label: "Median rounds to bust (busted sessions only)", cell: (v) => formatStat("ratio", v.bustRoundsMedian) },
  { label: "p10 rounds to bust (busted sessions only)", cell: (v) => formatStat("ratio", v.bustRoundsP10) },
  { label: "P(max drawdown ≥ 50% of start)", cell: (v) => formatInterval(v.pDrawdownHalf, undefined, undefined) },
  { label: "Final bankroll: p5 / median", cell: (v) => `${formatStat("money", v.finalP5)} / ${formatStat("money", v.medianFinal)}` },
  { label: "Final bankroll: mean", cell: (v) => formatStat("money", v.meanFinal) },
  { label: "Mean total wagered", cell: (v) => formatStat("money", v.meanWagered) },
];
