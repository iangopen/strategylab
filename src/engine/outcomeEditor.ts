// The outcome editor's inputs -> a game's outcomes (see "Multi-outcome games" in CLAUDE.md). Pure; never
// throws. Probabilities are TEXT parsed exactly (probText.ts), so their sum is checked exactly.
import { edge, MAX_OUTCOMES, PROB_SUM_TOLERANCE, type Outcome } from "./games";
import { snapShortDecimal } from "./odds";
import { addRational, parseProbability, type Rational } from "./probText";

export type EditorMode = "ticket" | "multiplier";

export interface EditorRow {
  /** Probability as typed: a decimal ("0.25") or a fraction ("1/6"). */
  prob: string;
  /** Ticket mode: the prize in dollars. Multiplier mode: the gross return per $1 staked (0 = stake lost, 1 = push). */
  value: number;
  label?: string;
}

export interface OutcomeEditor {
  mode: EditorMode;
  /** Ticket price in dollars (ticket mode); null in multiplier mode. */
  price: number | null;
  rows: EditorRow[];
}

export const EDITOR_LIMITS = {
  priceMax: 1_000_000,
  prizeMax: 1_000_000_000,
  returnMax: 1_000_000,
  labelMax: 24,
} as const;

/** What the readout shows. */
export interface EditorReadout {
  /** Exact sum of the probabilities, e.g. "1" or "5/6". */
  probSum: string;
  probSumIsOne: boolean;
  /** Mean gross return per $1 staked: sum(prob x (1 + net)). */
  meanReturn: number;
  /** Ticket mode: the mean prize in dollars. */
  meanPrize: number | null;
  /** House edge (negative = player edge). */
  edge: number;
  /** True when every outcome returns at least the stake: the game cannot lose money. */
  cannotLose: boolean;
  /** Per row: "loss", "push" or "win" (by the sign of its net). */
  kinds: ("loss" | "push" | "win")[];
}

export type EditorResult = { ok: true; outcomes: Outcome[]; readout: EditorReadout } | { ok: false; errors: Record<string, string>; readout: Partial<EditorReadout> };

function money(v: number): string {
  return `$${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function rationalText(r: Rational): string {
  return r.den === 1n ? r.num.toString() : `${r.num}/${r.den}`;
}

/** The default label of a row (shown in the replay strip): "$20", or "1.5x" in multiplier mode. */
export function defaultLabel(mode: EditorMode, value: number): string {
  return mode === "ticket" ? money(value) : `${Number(value.toPrecision(6))}x`;
}

/**
 * Compiles the editor's inputs. Errors are keyed "price", "rows", "sum", or "row<i>.prob" /
 * "row<i>.value" / "row<i>.label" (i from 1). The probability sum is exact (BigInt rationals) and must
 * be 1 within the engine's 1e-9. Ticket mode: net = (prize - price) / price. Multiplier mode: net = r - 1,
 * with the decimal float artifact snapped (1.91 -> 0.91 exactly).
 */
export function editorGame(e: OutcomeEditor): EditorResult {
  const errors: Record<string, string> = {};
  const readout: Partial<EditorReadout> = {};
  if (e.mode !== "ticket" && e.mode !== "multiplier") errors.mode = "Choose ticket or multiplier mode.";
  const ticket = e.mode === "ticket";
  const price = e.price;
  if (ticket && (typeof price !== "number" || !Number.isFinite(price) || !(price > 0) || price > EDITOR_LIMITS.priceMax)) {
    errors.price = `The ticket price must be more than $0 and at most ${money(EDITOR_LIMITS.priceMax)}.`;
  }
  const rows = Array.isArray(e.rows) ? e.rows : [];
  if (rows.length < 1 || rows.length > MAX_OUTCOMES) {
    errors.rows = `A game needs 1 to ${MAX_OUTCOMES} outcomes (got ${rows.length}).`;
    return { ok: false, errors, readout };
  }
  let sum: Rational = { num: 0n, den: 1n };
  let sumOk = true;
  const outcomes: Outcome[] = [];
  rows.forEach((row, i) => {
    const at = `row${i + 1}`;
    const p = parseProbability(row.prob);
    if (!p.ok) {
      errors[`${at}.prob`] = p.error;
      sumOk = false;
    } else sum = addRational(sum, p.value);
    const v = row.value;
    const max = ticket ? EDITOR_LIMITS.prizeMax : EDITOR_LIMITS.returnMax;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > max) {
      errors[`${at}.value`] = ticket ? `The prize must be from $0 to ${money(max)}.` : `The return per $1 must be from 0 to ${max.toLocaleString("en-US")} (0 = stake lost, 1 = push).`;
    }
    if (row.label !== undefined && (typeof row.label !== "string" || row.label.length > EDITOR_LIMITS.labelMax || [...row.label].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127))) {
      errors[`${at}.label`] = `A label is at most ${EDITOR_LIMITS.labelMax} characters, with no control characters.`;
    }
    if (p.ok && errors[`${at}.value`] === undefined && errors.price === undefined) {
      const net = ticket ? (v - price!) / price! : v === 1 ? 0 : snapShortDecimal(v - 1, v);
      const label = row.label !== undefined && row.label !== "" ? row.label : defaultLabel(e.mode, v);
      outcomes.push({ prob: p.float, net, label });
    }
  });
  if (sumOk) {
    readout.probSum = rationalText(sum);
    // |sum - 1| <= 1e-9, exactly: |num - den| x 10^9 <= den.
    const diff = sum.num - sum.den;
    readout.probSumIsOne = (diff < 0n ? -diff : diff) * BigInt(Math.round(1 / PROB_SUM_TOLERANCE)) <= sum.den;
    if (!readout.probSumIsOne) errors.sum = `The probabilities must add up to 1 (they add up to ${readout.probSum}).`;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors, readout };
  const meanReturn = outcomes.reduce((s, o) => s + o.prob * (1 + o.net), 0);
  const full: EditorReadout = {
    probSum: readout.probSum!,
    probSumIsOne: true,
    meanReturn,
    meanPrize: ticket ? rows.reduce((s, r, i) => s + outcomes[i]!.prob * r.value, 0) : null,
    edge: edge({ outcomes }),
    cannotLose: outcomes.every((o) => o.net >= 0),
    kinds: outcomes.map((o) => (o.net > 0 ? "win" : o.net < 0 ? "loss" : "push")),
  };
  return { ok: true, outcomes, readout: full };
}

/** The shipped ticket example: price $70; prizes $20 (1/6), $50 (3/6), $100 (2/6). House edge 5/42. */
export function ticketExample(): OutcomeEditor {
  return {
    mode: "ticket",
    price: 70,
    rows: [
      { prob: "1/6", value: 20 },
      { prob: "3/6", value: 50 },
      { prob: "2/6", value: 100 },
    ],
  };
}
