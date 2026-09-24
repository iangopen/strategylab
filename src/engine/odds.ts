// Sports odds -> Game { winProb, netPayout }. Pure math, no React, no DOM, no RNG. See "Sports odds"
// in CLAUDE.md. Nothing downstream knows about odds: the runner only ever sees a Game.

export type OddsFormat = "american" | "decimal";

export const ODDS_LIMITS = {
  /** |American| must be at least this (±100 = even money)... */
  americanMin: 100,
  /** ...and at most this (payout 1,000 or 0.001). */
  americanMax: 100_000,
  /** Decimal odds range: the same payouts, 0.001 to 1,000. */
  decimalMin: 1.001,
  decimalMax: 1001,
  /** "My estimate" win probability. */
  estimateMin: 0.01,
  estimateMax: 0.99,
} as const;

export type Converted = { ok: true; netPayout: number } | { ok: false; error: string };

function fmt(v: number): string {
  if (Number.isNaN(v)) return "NaN";
  if (!Number.isFinite(v)) return v > 0 ? "Infinity" : "-Infinity";
  return v.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

/**
 * If x is within a few ulps of a decimal with at most 12 significant digits, return that decimal.
 * Removes the float artifact of `d - 1` for typed decimal odds (1.91 - 1 = 0.9099999999999999 -> 0.91)
 * while leaving genuinely long values (a converted 1.9090909090909092) exactly as they are.
 */
export function snapShortDecimal(x: number, scale = 1): number {
  const c = Number(x.toPrecision(12));
  return Math.abs(c - x) <= 4 * Number.EPSILON * Math.max(1, Math.abs(scale)) ? c : x;
}

/** Net payout (profit per 1 staked on a win) of a price, or a readable error. Never throws. */
export function netPayoutFromOdds(format: OddsFormat, value: number): Converted {
  if (typeof value !== "number" || Number.isNaN(value)) return { ok: false, error: "Enter a number for the odds." };
  if (format === "american") {
    if (!Number.isFinite(value) || Math.abs(value) > ODDS_LIMITS.americanMax) {
      return { ok: false, error: `American odds must be between -${fmt(ODDS_LIMITS.americanMax)} and +${fmt(ODDS_LIMITS.americanMax)} (got ${fmt(value)}).` };
    }
    if (value > -ODDS_LIMITS.americanMin && value < ODDS_LIMITS.americanMin) {
      return { ok: false, error: `American odds must be +100 or higher, or -100 or lower (got ${fmt(value)}).` };
    }
    return { ok: true, netPayout: value > 0 ? value / 100 : 100 / -value };
  }
  if (!Number.isFinite(value) || value <= 1) return { ok: false, error: `Decimal odds must be greater than 1 (got ${fmt(value)}).` };
  if (value < ODDS_LIMITS.decimalMin || value > ODDS_LIMITS.decimalMax) {
    return { ok: false, error: `Decimal odds must be between ${fmt(ODDS_LIMITS.decimalMin)} and ${fmt(ODDS_LIMITS.decimalMax)} (got ${fmt(value)}).` };
  }
  return { ok: true, netPayout: snapShortDecimal(value - 1, value) };
}

/** The win probability at which a price is fair: 1 / (1 + netPayout). */
export function impliedProb(netPayout: number): number {
  return 1 / (1 + netPayout);
}

/**
 * Converts a VALID price between formats, exactly in floating point, for the format toggle:
 * American -> decimal is d = 1 + net (kept at full precision, snapped only if it is a short decimal);
 * decimal -> American is +100·net (net >= 1) or -100/net, snapped to 15 significant digits so that
 * American -> decimal -> American returns the original exactly. Even money converts to +100.
 * Returns the input unchanged when it is invalid or the formats match.
 */
export function convertOdds(value: number, from: OddsFormat, to: OddsFormat): number {
  if (from === to) return value;
  const c = netPayoutFromOdds(from, value);
  if (!c.ok) return value;
  const net = c.netPayout;
  if (to === "decimal") return snapShortDecimal(1 + net, 1 + net);
  const american = net >= 1 ? 100 * net : -100 / net;
  return Number(american.toPrecision(15));
}

/** How a price is DISPLAYED in its field: whole American numbers, 2-decimal decimals. Storage stays exact. */
export function displayOdds(format: OddsFormat, value: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (format === "american") {
    const r = Math.round(value);
    return r > 0 ? `+${r}` : String(r);
  }
  return value.toFixed(2);
}
