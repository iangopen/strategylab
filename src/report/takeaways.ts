// The report's takeaway sentences, generated from a run's numbers. Pure: no React, no DOM, so every
// sentence is unit-tested. This is the "why the house edge wins" explainer: the edge, EV per $ wagered
// with its interval, P(bust) with its interval, and when busts happen.
//
// The sentences never claim more than the numbers support:
// - an interval that includes the comparison value (zero EV, the other strategy) is reported as
//   "not clear at this sample size", never as a winner;
// - a comparison is named only when the two 95% intervals do not overlap (a conservative test);
// - rounds-to-bust figures are said to describe busted sessions only.
// Tone: educational, no advice, no "winning" language.
import { Z_95 } from "../engine/stats/interval";
import { formatInterval, formatStat } from "../ui/format";

export interface TakeawayStrategy {
  label: string;
  /** The run's stat values for this strategy, keyed by StatDef.id. */
  stats: Readonly<Record<string, number>>;
}

export interface TakeawayInput {
  /** edge(game): expected loss per unit staked (negative = player edge). */
  edge: number;
  nSessions: number;
  strategies: readonly TakeawayStrategy[];
}

export interface Interval {
  low: number;
  high: number;
}

/** The comparison value lies inside the interval (bounds included). */
export function contains(iv: Interval, x: number): boolean {
  return iv.low <= x && x <= iv.high;
}

/** Two intervals share at least one point: the difference between them is not clear. */
export function overlaps(a: Interval, b: Interval): boolean {
  return a.low <= b.high && b.low <= a.high;
}

/** 95% interval for EV per $ wagered: the estimate ± 1.96 SE (normal approximation for the ratio). */
export function evInterval(stats: Readonly<Record<string, number>>): Interval | null {
  const ev = stats.evPerWagered;
  const se = stats.evSE;
  if (ev === undefined || se === undefined || !Number.isFinite(ev) || !Number.isFinite(se)) return null;
  return { low: ev - Z_95 * se, high: ev + Z_95 * se };
}

const pct2 = (v: number) => formatInterval(v, undefined, undefined, 2);

/** Up to this many strategies, sentences list each one; above it they give the range (lowest and highest). */
export const LIST_LIMIT = 3;

/** Names, or a count when there are more than LIST_LIMIT of them. */
function names(items: readonly string[]): string {
  return items.length > LIST_LIMIT ? `${items.length} strategies` : list(items);
}
const UNCLEAR = "isn't clear at this sample size";

/** "A, B and C" */
function list(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function edgeSentence(edge: number): string {
  const tail = "a strategy can change only how much is wagered and how the results are spread out.";
  if (Math.abs(edge) < 1e-12) return `This game is fair: every bet breaks even on average, so no strategy should gain or lose per dollar wagered; ${tail}`;
  if (edge > 0) return `Every bet in this game loses ${pct2(edge)} of its stake on average (the house edge), so every strategy should lose about ${pct2(edge)} of everything it wagers; ${tail}`;
  return `Every bet in this game gains ${pct2(-edge)} of its stake on average (a player edge), so every strategy should gain about ${pct2(-edge)} of everything it wagers; ${tail}`;
}

function evSentence(input: TakeawayInput): string {
  const theory = -input.edge;
  const measured = input.strategies.flatMap((s) => {
    const iv = evInterval(s.stats);
    return iv ? [{ label: s.label, ev: s.stats.evPerWagered!, iv }] : [];
  });
  const noBets = input.strategies.filter((s) => !evInterval(s.stats)).map((s) => `${s.label} placed no bets`);
  const one = (m: (typeof measured)[number]) => `${m.label} ${formatInterval(m.ev, m.iv.low, m.iv.high, 2)}`;
  const byEv = [...measured].sort((a, b) => a.ev - b.ev);
  let sentence: string;
  if (input.strategies.length <= LIST_LIMIT || measured.length < 2) {
    sentence = `Measured EV per $ wagered, with 95% intervals: ${list([...measured.map(one), ...noBets])}`;
  } else {
    const none = noBets.length === 0 ? "" : ` (${names(input.strategies.filter((s) => !evInterval(s.stats)).map((s) => s.label))} placed no bets)`;
    sentence = `Measured EV per $ wagered, with 95% intervals, ranged from ${one(byEv[0]!)} to ${one(byEv[byEv.length - 1]!)}${none}`;
  }
  if (measured.length === 0) return `${sentence}, so there is no EV per $ to compare.`;

  const clauses: string[] = [];
  const misses = measured.filter((m) => !contains(m.iv, theory)).map((m) => m.label);
  if (misses.length === 0) clauses.push(`${measured.length === 1 ? "the interval includes" : "every interval includes"} the theoretical ${pct2(theory)}`);
  else clauses.push(`for ${names(misses)} the interval misses the theoretical ${pct2(theory)}, which a 95% interval does by chance about one time in twenty`);
  if (Math.abs(input.edge) >= 1e-12) {
    const nearZero = measured.filter((m) => contains(m.iv, 0)).map((m) => m.label);
    if (nearZero.length > 0) clauses.push(`for ${names(nearZero)} the result is not clearly different from zero at this sample size`);
  }
  if (measured.length >= 2) {
    const lo = byEv[0]!;
    const hi = byEv[byEv.length - 1]!;
    if (overlaps(lo.iv, hi.iv)) clauses.push(`the difference between the strategies ${UNCLEAR}`);
    else clauses.push(`${lo.label} measured a lower EV per $ than ${hi.label}, and their intervals do not overlap`);
  }
  sentence += `; ${clauses.join("; ")}.`;
  return sentence;
}

interface Bust {
  label: string;
  p: number;
  iv: Interval;
  busts: number;
}

/** Bust rates of the strategies that placed bets (one that never bet cannot go bust, so it is not compared). */
function busts(input: TakeawayInput): Bust[] {
  return input.strategies.flatMap((s) => {
    if (!evInterval(s.stats)) return [];
    const { pBust: p, pBustLow: low, pBustHigh: high } = s.stats;
    if (p === undefined || low === undefined || high === undefined || ![p, low, high].every(Number.isFinite)) return [];
    return [{ label: s.label, p, iv: { low, high }, busts: Math.round(p * input.nSessions) }];
  });
}

function bustSentence(input: TakeawayInput): string {
  const b = busts(input);
  const what = "Share of sessions that went bust (fell below the table minimum or could not cover the next bet), with 95% intervals";
  if (b.length === 0) return `${what}: not available for this run.`;
  if (b.every((x) => x.busts === 0)) {
    const upper = Math.max(...b.map((x) => x.iv.high));
    return `No session went bust for ${b.length === 1 ? b[0]!.label : "any strategy"} in ${input.nSessions.toLocaleString("en-US")} sessions; the 95% interval still allows a bust rate of up to ${pct2(upper)}.`;
  }
  const one = (x: Bust) => (x.busts === 0 ? `${x.label} never (interval up to ${pct2(x.iv.high)})` : `${x.label} ${formatInterval(x.p, x.iv.low, x.iv.high)}`);
  const sorted = [...b].sort((x, y) => x.p - y.p);
  let sentence = b.length <= LIST_LIMIT ? `${what}: ${list(b.map(one))}` : `${what}, ranged from ${one(sorted[0]!)} to ${one(sorted[sorted.length - 1]!)}`;
  if (b.length >= 2) {
    const lo = sorted[0]!;
    const hi = sorted[sorted.length - 1]!;
    sentence += overlaps(lo.iv, hi.iv) ? `; the difference in bust rates ${UNCLEAR}` : `; ${hi.label} went bust more often than ${lo.label}, and their intervals do not overlap`;
  }
  return `${sentence}.`;
}

function timingSentence(input: TakeawayInput): string | null {
  const timed = input.strategies.flatMap((s) => {
    const med = s.stats.bustRoundsMedian;
    const p10 = s.stats.bustRoundsP10;
    if (med === undefined || p10 === undefined || !Number.isFinite(med) || !Number.isFinite(p10)) return [];
    return [{ label: s.label, med, p10 }];
  });
  if (timed.length === 0) return null;
  const r = (v: number) => formatStat("ratio", v);
  if (timed.length > LIST_LIMIT) {
    const byMed = [...timed].sort((a, b) => a.med - b.med);
    const first = byMed[0]!;
    const last = byMed[byMed.length - 1]!;
    return `Counting busted sessions only, the median bust came as early as round ${r(first.med)} (${first.label}) and as late as round ${r(last.med)} (${last.label}).`;
  }
  return `Counting busted sessions only, ${timed.map((t) => `half of ${t.label}'s busts came by round ${r(t.med)} and the earliest tenth by round ${r(t.p10)}`).join("; ")}.`;
}

/** A strategy that clearly wins most sessions yet clearly loses per dollar: the core lesson, when the numbers show it. */
function contrastSentence(input: TakeawayInput): string | null {
  const candidates = input.strategies.flatMap((s) => {
    const iv = evInterval(s.stats);
    const { pProfit, pProfitLow, pProfitHigh } = s.stats;
    if (!iv || pProfit === undefined || pProfitLow === undefined || !(pProfitLow > 0.5) || !(iv.high < 0)) return [];
    return [{ label: s.label, pProfit, low: pProfitLow, high: pProfitHigh }];
  });
  if (candidates.length === 0) return null;
  const c = candidates.reduce((a, b) => (b.pProfit > a.pProfit ? b : a));
  return `${c.label} ended ahead in ${formatInterval(c.pProfit, c.low, c.high)} of sessions yet lost money per dollar wagered on average: ending ahead in most sessions is not the same as gaining on average.`;
}

/** Three to five takeaway sentences for a run, in reading order. */
export function takeaways(input: TakeawayInput): string[] {
  const out = [edgeSentence(input.edge), evSentence(input), bustSentence(input)];
  const timing = timingSentence(input);
  if (timing) out.push(timing);
  const contrast = contrastSentence(input);
  if (contrast) out.push(contrast);
  return out;
}
