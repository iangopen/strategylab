// Display helpers shared by UI components. Engine money is cents; converted here.
import type { StatDef } from "../engine/stats/types";
import { getStrategy } from "../engine/strategies/registry";
import type { StrategyInstance } from "../scenario";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const pct = new Intl.NumberFormat("en-US", { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

/** Column label for a strategy instance, e.g. "Flat #2". */
export function instanceLabel(instances: readonly StrategyInstance[], index: number): string {
  const inst = instances[index]!;
  const label = getStrategy(inst.strategyId)?.label ?? inst.strategyId;
  const sameBefore = instances.slice(0, index + 1).filter((i) => i.strategyId === inst.strategyId).length;
  const total = instances.filter((i) => i.strategyId === inst.strategyId).length;
  return total > 1 ? `${label} #${sameBefore}` : label;
}
