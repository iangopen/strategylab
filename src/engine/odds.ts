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

// ------------------------------------------------------------------------------------ games

export type OddsMode = "market" | "estimate";
export type OddsSide = "a" | "b";

/** The sports inputs, as stored in the scenario. In estimate mode, side A is "your side's odds". */
export interface SportsInput {
  mode: OddsMode;
  format: OddsFormat;
  sideA: number;
  sideB: number;
  side: OddsSide;
  estimate: number;
}

export interface SportsReadout {
  mode: OddsMode;
  /** Implied probability of side A's price (your side in estimate mode). */
  impliedA: number;
  /** Market mode only. */
  impliedB: number | null;
  /** implied_A + implied_B - 1 (the vig). Market mode only. */
  overround: number | null;
  /** True when the prices add up to less than 100%: rare in real markets, usually a data-entry error. */
  negativeOverround: boolean;
  /** Proportional de-vig of the chosen side. Market mode only. */
  fairP: number | null;
  /** The user's own win probability. Estimate mode only. */
  estimate: number | null;
  /** The Game this compiles to. */
  winProb: number;
  netPayout: number;
  /** House edge = 1 - winProb * (1 + netPayout); negative = player edge. */
  edge: number;
}

export type SportsField = "sideA" | "sideB" | "estimate";
export type SportsResult = { ok: true; winProb: number; netPayout: number; readout: SportsReadout } | { ok: false; errors: Partial<Record<SportsField, string>> };

/**
 * Proportional de-vig of a two-way market. With this method the edge is the same on both sides:
 * 1 - 1 / (implied_A + implied_B) = overround / (1 + overround).
 */
export function marketDevig(netA: number, netB: number, side: OddsSide) {
  const impliedA = impliedProb(netA);
  const impliedB = impliedProb(netB);
  const sum = impliedA + impliedB;
  const fairP = (side === "a" ? impliedA : impliedB) / sum;
  const netPayout = side === "a" ? netA : netB;
  return { impliedA, impliedB, overround: sum - 1, fairP, netPayout, edge: 1 - fairP * (1 + netPayout) };
}

/** Compiles the sports inputs to a Game's winProb and netPayout, or per-field errors. Never throws. */
export function sportsGame(input: SportsInput): SportsResult {
  const errors: Partial<Record<SportsField, string>> = {};
  const a = netPayoutFromOdds(input.format, input.sideA);
  if (!a.ok) errors.sideA = a.error;

  if (input.mode === "estimate") {
    const p = input.estimate;
    if (typeof p !== "number" || Number.isNaN(p)) errors.estimate = "Enter your estimated win probability.";
    else if (!(p >= ODDS_LIMITS.estimateMin && p <= ODDS_LIMITS.estimateMax)) errors.estimate = `Your estimate must be between ${ODDS_LIMITS.estimateMin} and ${ODDS_LIMITS.estimateMax} (got ${fmt(p)}).`;
    if (!a.ok || errors.estimate) return { ok: false, errors };
    const netPayout = a.netPayout;
    const readout: SportsReadout = { mode: "estimate", impliedA: impliedProb(netPayout), impliedB: null, overround: null, negativeOverround: false, fairP: null, estimate: p, winProb: p, netPayout, edge: 1 - p * (1 + netPayout) };
    return { ok: true, winProb: p, netPayout, readout };
  }

  const b = netPayoutFromOdds(input.format, input.sideB);
  if (!b.ok) errors.sideB = b.error;
  if (!a.ok || !b.ok) return { ok: false, errors };
  const m = marketDevig(a.netPayout, b.netPayout, input.side);
  const readout: SportsReadout = {
    mode: "market",
    impliedA: m.impliedA,
    impliedB: m.impliedB,
    overround: m.overround,
    negativeOverround: m.overround < 0,
    fairP: m.fairP,
    estimate: null,
    winProb: m.fairP,
    netPayout: m.netPayout,
    edge: m.edge,
  };
  return { ok: true, winProb: m.fairP, netPayout: m.netPayout, readout };
}
