// Display helpers shared by UI components. Engine money is cents; converted here.
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
