// Display helpers shared by UI components. Engine money is cents; converted here.
import { STATS } from "../engine/stats/registry";
import type { StatDef } from "../engine/stats/types";
import { getStrategy } from "../engine/strategies/registry";
import type { StrategyInstance } from "../scenario";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const pct = new Intl.NumberFormat("en-US", { style: "percent", minimumFractionDigits: 3, maximumFractionDigits: 3 });
const ratio = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const int = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function formatStat(format: StatDef["format"], v: number | undefined): string {
  if (v === undefined || !Number.isFinite(v)) return "—";
  switch (format) {
    case "money":
      return money.format(v / 100); // engine money is cents
    case "pct":
      return pct.format(v);
    case "ratio":
      return ratio.format(v);
    case "int":
      return int.format(v);
  }
}

const pctFormats = new Map<number, Intl.NumberFormat>();
function pctWith(digits: number): Intl.NumberFormat {
  let f = pctFormats.get(digits);
  if (!f) {
    f = new Intl.NumberFormat("en-US", { style: "percent", minimumFractionDigits: digits, maximumFractionDigits: digits });
    pctFormats.set(digits, f);
  }
  return f;
}

/**
 * THE interval display, shared by the results table and the report: "17.1% (16.4–17.8%)" for a
 * proportion (fractions in, percent out). When a bound is negative the range is spelled out with "to"
 * ("-2.76% (-2.84% to -2.67%)"), so a minus sign is never read as a dash. A missing point is "—";
 * missing bounds leave the point alone.
 */
export function formatInterval(value: number | undefined, low: number | undefined, high: number | undefined, digits = 1): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  const f = pctWith(digits);
  const point = f.format(value);
  if (low === undefined || high === undefined || !Number.isFinite(low) || !Number.isFinite(high)) return point;
  if (low < 0 || high < 0) return `${point} (${f.format(low)} to ${f.format(high)})`;
  // "16.4–17.8%": the percent sign once, after the upper bound.
  const lo = f.format(low).replace(/%$/, "");
  return `${point} (${lo}–${f.format(high)})`;
}

/** Stats shown as one row with their 95% interval: point id -> [low id, high id]. */
export const INTERVAL_ROWS: Readonly<Record<string, readonly [string, string]>> = {
  pProfit: ["pProfitLow", "pProfitHigh"],
  pBust: ["pBustLow", "pBustHigh"],
};
const INTERVAL_PARTS = new Set(Object.values(INTERVAL_ROWS).flat());

/**
 * Percent digits in the results table, matching the report: one inside intervals (a 95% interval from
 * 10,000 sessions is about ±0.7 points wide, so a third decimal claims precision the run doesn't have),
 * two for EV per $ wagered and its theoretical value. Other percent rows keep formatStat's three (the SE
 * row needs them to be readable).
 */
export const TABLE_INTERVAL_DIGITS = 1;
export const TABLE_PCT_DIGITS: Readonly<Record<string, number>> = { evPerWagered: 2, evTheory: 2 };

/** One row of the results table: a registered stat, with its interval folded in where it has one. */
export interface TableRow {
  /** The point stat's id (the row's data-stat). */
  id: string;
  label: string;
  emphasis: boolean;
  /** The cell text for one strategy's stats. */
  cell: (stats: Readonly<Record<string, number>>) => string;
  /** The exact numbers behind the cell, as String(double) (a bit-exact round trip), "|"-separated. */
  raw: (stats: Readonly<Record<string, number>>) => string;
}

/** The results table's rows: registry order, each interval's low/high rows folded into its point row. */
export const TABLE_ROWS: readonly TableRow[] = STATS.filter((s) => !INTERVAL_PARTS.has(s.id)).map((s): TableRow => {
  const parts = INTERVAL_ROWS[s.id];
  const digits = TABLE_PCT_DIGITS[s.id];
  if (!parts) {
    const cell = digits === undefined ? (v: Readonly<Record<string, number>>) => formatStat(s.format, v[s.id]) : (v: Readonly<Record<string, number>>) => formatInterval(v[s.id], undefined, undefined, digits);
    return { id: s.id, label: s.label, emphasis: s.emphasis === true, cell, raw: (v) => String(v[s.id]) };
  }
  const [lo, hi] = parts;
  return {
    id: s.id,
    label: `${s.label}, with 95% interval`,
    emphasis: s.emphasis === true,
    cell: (v) => formatInterval(v[s.id], v[lo], v[hi], TABLE_INTERVAL_DIGITS),
    raw: (v) => [v[s.id], v[lo], v[hi]].map(String).join("|"),
  };
});

export const CUSTOM_RULE_FALLBACK_LABEL = "Custom rule";

/** A custom rule's name if it has a usable one (the validator enforces the real limits). */
function ruleName(rule: unknown): string | undefined {
  if (rule === null || typeof rule !== "object" || Array.isArray(rule)) return undefined;
  const name = (rule as Record<string, unknown>).name;
  return typeof name === "string" && name.trim() !== "" ? name.trim().slice(0, 40) : undefined;
}

/** Base label of one instance: the registry label, or a custom rule's name. */
export function baseLabel(inst: StrategyInstance): string {
  if (inst.kind === "custom") return ruleName(inst.rule) ?? CUSTOM_RULE_FALLBACK_LABEL;
  return getStrategy(inst.strategyId)?.label ?? inst.strategyId;
}

/** Column label for a strategy instance, e.g. "Flat #2". Instances sharing a label are numbered. */
export function instanceLabel(instances: readonly StrategyInstance[], index: number): string {
  const labels = instances.map(baseLabel);
  const label = labels[index]!;
  const sameBefore = labels.slice(0, index + 1).filter((l) => l === label).length;
  const total = labels.filter((l) => l === label).length;
  return total > 1 ? `${label} #${sameBefore}` : label;
}

/** Elapsed run time for display: "<0.1s" under 100 ms (never a misleading "0.0s"), else one decimal. */
export function formatElapsed(ms: number): string {
  return ms < 100 ? "<0.1s" : `${(ms / 1000).toFixed(1)}s`;
}

/** Shown under a binaryOnly strategy field (e.g. Kelly's assumed win probability) on a multi-outcome game. */
export const BINARY_ONLY_NOTE = "Applies only to win/lose games; ignored here.";

/**
 * The sentence a screen reader hears when a run finishes (the table itself is not a live region):
 * the headline EV per $ wagered next to the theory, and P(profit > 0), per strategy.
 */
export function runAnnouncement(columns: readonly { label: string; stats: Record<string, number> }[]): string {
  // The table's precision: two decimals for EV per $, one for P(profit).
  const said = (v: number | undefined, digits: number) => {
    const s = formatInterval(v, undefined, undefined, digits);
    return s === "—" ? "not defined (no bets placed)" : s;
  };
  const per = (id: string, digits: number) => columns.map((c) => `${c.label} ${said(c.stats[id], digits)}`).join(", ");
  const theory = columns[0]?.stats["evTheory"];
  return (
    `Results ready. EV per $ wagered: ${per("evPerWagered", 2)}` +
    (theory === undefined ? "." : `; theory ${said(theory, 2)}.`) +
    ` P(profit > 0): ${per("pProfit", TABLE_INTERVAL_DIGITS)}. The full table follows.`
  );
}

/** What a screen reader hears when a replay is drawn: the same per-strategy lines as the replay legend. */
export function replayAnnouncement(session: number, lines: readonly string[]): string {
  return `Replay of session ${int.format(session)}: ${lines.join("; ")}.`;
}
