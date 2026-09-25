// Probability TEXT -> exact rational (BigInt), for the outcome editor. A decimal is a rational too
// (0.25 = 25/100), so sums are checked exactly: 1/6 + 3/6 + 2/6 is exactly 1. Pure; never throws.

export interface Rational {
  num: bigint;
  den: bigint;
}

export type ParsedProb = { ok: true; value: Rational; float: number } | { ok: false; error: string };

/** Longest probability text accepted (bounds BigInt work on untrusted input such as a link). */
export const MAX_PROB_TEXT = 40;

const FRACTION = /^(\d+)\/(\d+)$/;
const DECIMAL = /^(\d*)(?:\.(\d*))?$/;

function gcd(a: bigint, b: bigint): bigint {
  while (b !== 0n) [a, b] = [b, a % b];
  return a < 0n ? -a : a;
}

export function reduce(r: Rational): Rational {
  const g = gcd(r.num, r.den);
  return g === 0n ? r : { num: r.num / g, den: r.den / g };
}

export function addRational(a: Rational, b: Rational): Rational {
  return reduce({ num: a.num * b.den + b.num * a.den, den: a.den * b.den });
}

/** num/den as a double: correctly rounded when both fit in 2^53 (one exact division), else within a few ulps. */
export function rationalToNumber(r: Rational): number {
  const n = Number(r.num);
  const d = Number(r.den);
  if (Number.isSafeInteger(n) && Number.isSafeInteger(d)) return n / d;
  // Large operands: scale down both to keep the ratio within double precision.
  const shift = BigInt(Math.max(0, r.den.toString(2).length - 60));
  return Number(r.num >> shift) / Number(r.den >> shift);
}

/**
 * Parses a probability typed as a decimal ("0.25", ".5", "1") or a fraction of two whole numbers ("1/6").
 * Must be greater than 0 and at most 1. Readable errors for everything else.
 */
export function parseProbability(text: unknown): ParsedProb {
  if (typeof text !== "string") return { ok: false, error: "Enter a probability." };
  const t = text.trim();
  if (t === "") return { ok: false, error: "Enter a probability, as a decimal (0.25) or a fraction (1/6)." };
  if (t.length > MAX_PROB_TEXT) return { ok: false, error: `Too long (at most ${MAX_PROB_TEXT} characters).` };
  if (t.startsWith("-")) return { ok: false, error: `A probability cannot be negative (got "${t}").` };
  let r: Rational;
  const f = FRACTION.exec(t);
  if (f) {
    const den = BigInt(f[2]!);
    if (den === 0n) return { ok: false, error: `Cannot divide by zero (got "${t}").` };
    r = { num: BigInt(f[1]!), den };
  } else {
    const d = DECIMAL.exec(t);
    if (!d || (d[1] === "" && (d[2] ?? "") === "")) return { ok: false, error: `Not a probability: "${t}". Use a decimal (0.25) or a fraction (1/6).` };
    const frac = d[2] ?? "";
    r = { num: BigInt((d[1] || "0") + frac), den: 10n ** BigInt(frac.length) };
  }
  r = reduce(r);
  if (r.num === 0n) return { ok: false, error: `A probability must be greater than 0 (got "${t}").` };
  if (r.num > r.den) return { ok: false, error: `A probability cannot be more than 1 (got "${t}").` };
  return { ok: true, value: r, float: rationalToNumber(r) };
}
