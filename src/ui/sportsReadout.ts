// The always-visible sports-odds readout, as plain lines (pure, tested). Educational tone only:
// no bookmaker names and no tipster vocabulary (the banned list lives in sportsReadout.test.ts).
import type { SportsReadout } from "../engine/odds";

const pct = (v: number) => `${(v * 100).toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 })}%`;
const num = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 4 });

export interface ReadoutLine {
  label: string;
  value: string;
  /** Shown as a warning (negative overround, believed edge). */
  warn?: boolean;
}

export function sportsReadoutLines(r: SportsReadout): ReadoutLine[] {
  const lines: ReadoutLine[] = [];
  if (r.mode === "market") {
    lines.push({ label: "Implied probability, side A", value: pct(r.impliedA) });
    lines.push({ label: "Implied probability, side B", value: pct(r.impliedB!) });
    lines.push({ label: "Overround (the vig)", value: pct(r.overround!) });
    lines.push({ label: "Fair probability of your side (proportional de-vig)", value: pct(r.fairP!) });
  } else {
    lines.push({ label: "Implied probability of your price (includes the vig)", value: pct(r.impliedA) });
    lines.push({ label: "Your estimated win probability", value: pct(r.estimate!) });
  }
  lines.push({ label: "Net payout", value: `${num(r.netPayout)} per $1 staked` });
  lines.push(r.edge >= 0 ? { label: "House edge", value: `${pct(r.edge)} of every dollar wagered` } : { label: "Player edge", value: `${pct(-r.edge)} of every dollar wagered`, warn: true });
  if (r.negativeOverround) {
    lines.push({
      label: "Check these prices",
      value: "The two prices add up to less than 100%. That is rare in real markets and is usually a data-entry error: check both prices. As entered, the bettor has the edge.",
      warn: true,
    });
  }
  if (r.mode === "estimate" && r.edge < 0) {
    lines.push({
      label: "About this edge",
      value: "It comes from your estimate. The simulation honors it, but believing you have an edge is not the same as having one.",
      warn: true,
    });
  }
  return lines;
}

export const PUSH_NOTE = "Two-way markets only: pushes (a tie that returns the stake) are not modeled.";
