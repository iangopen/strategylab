// The report's takeaway sentences, generated from a run's numbers. Pure: no React, no DOM, so every
// sentence is unit-tested. This is the "why the house edge wins" explainer: the edge, EV per $ wagered
// with its interval, P(bust) with its interval, and when busts happen.
//
// The sentences never claim more than the numbers support:
// - an interval that includes the comparison value (zero EV) is reported as
//   "not clear at this sample size", never as a winner;
// - two strategies are compared through ONE interval on their DIFFERENCE, and a difference is named
//   only when that interval excludes zero. In a run every strategy plays the same sessions (common
//   random numbers), so the difference is taken session by session (engine/stats/paired.ts): the luck
//   the two strategies shared cancels. Without pairing data the fallback treats the two samples as
//   independent (Welch for EV per $, Newcombe for bust rates). Neither path asks whether two separate
//   intervals overlap: overlapping intervals do not show that a difference is absent;
// - the pair compared is the lowest against the highest of k strategies, picked AFTER seeing the
//   numbers, so with more than two strategies the interval is widened (Bonferroni over all k(k−1)/2
//   pairs) to keep 95% for the whole family. On a house-edge game every strategy has the SAME true EV
//   per $, so an unadjusted "largest gap" would name false differences far more than 5% of the time;
// - an EV difference is also not named when one more worst-case session (a whole-bankroll loss)
//   would bring zero back inside the interval: see evDifference;
// - each comparison says which interval was used, the difference with its interval, and the sessions;
// - rounds-to-bust figures are said to describe busted sessions only.
// Tone: educational, no advice, no "winning" language.
import {
  familyQuantilePoint,
  independentProportionInterval,
  MIN_COMPARE_SESSIONS,
  normalQuantile,
  pairedProportionInterval,
  tInterval,
  tIntervalWithOneMore,
  welchDf,
  Z_95,
  type Bounds,
} from "../engine/stats/interval";
import type { PairedComparison } from "../engine/stats/paired";
import { edge as gameEdge } from "../engine/games";
import type { MonteCarloResult } from "../engine/montecarlo";
import { toCents, type ScenarioConfig } from "../scenario";
import { formatInterval, formatStat, undoneByOneLoss, type EvNote } from "../ui/format";

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
  /**
   * The run's paired comparisons (MonteCarloResult.comparisons), indexed like strategies. When the
   * pair being compared is not here, the two strategies are treated as independent samples.
   */
  comparisons?: readonly PairedComparison[];
  /**
   * The run's starting bankroll in cents (the most one session can lose). With it, a claim about ONE
   * strategy's EV per $ must survive one more whole-bankroll loss (evClaim). Without it the plain
   * interval is used.
   */
  startBankroll?: number;
}

export interface Interval {
  low: number;
  high: number;
}

/** The comparison value lies inside the interval (bounds included). */
export function contains(iv: Interval, x: number): boolean {
  return iv.low <= x && x <= iv.high;
}

/**
 * Two intervals share at least one point. This was the report's comparison rule until session 22; the
 * sentences no longer use it. It stays only so tests can show what it missed (takeaways.test.ts).
 */
export function overlaps(a: Interval, b: Interval): boolean {
  return a.low <= b.high && b.low <= a.high;
}

/** The difference between two strategies (first minus second), with the interval that decides the verdict. */
export interface DifferenceVerdict {
  /** "paired": the same sessions, differenced session by session. "independent": two separate samples. */
  method: "paired" | "independent";
  diff: number;
  low: number;
  high: number;
  /** Sessions per strategy. */
  n: number;
  /** Pairs the interval was widened for (Bonferroni); 1 means a plain 95% interval. */
  family: number;
  /** The interval (low to high) excludes zero. */
  excludesZero: boolean;
  /**
   * The interval excludes zero, but would not after one more session in which the better-looking
   * strategy lost its whole bankroll (EV per $, paired runs only; see evDifference).
   */
  fragile: boolean;
  /** A difference may be named: the interval excludes zero and the verdict is not fragile. */
  clear: boolean;
}

/** Pairs among k strategies. */
export function pairCount(k: number): number {
  return (k * (k - 1)) / 2;
}

/** The run's paired comparison of strategies i and j, with the sign that turns "a minus b" into "i minus j". */
function findPair(input: TakeawayInput, i: number, j: number): { cmp: PairedComparison; sign: 1 | -1 } | null {
  for (const cmp of input.comparisons ?? []) {
    if (cmp.a === i && cmp.b === j) return { cmp, sign: 1 };
    if (cmp.a === j && cmp.b === i) return { cmp, sign: -1 };
  }
  return null;
}

function verdict(method: DifferenceVerdict["method"], diff: number, iv: Bounds, n: number, family: number, stress?: Bounds): DifferenceVerdict | null {
  if (![diff, iv.low, iv.high].every(Number.isFinite)) return null;
  const excludesZero = !contains(iv, 0);
  // Fragile: zero lies inside the span of the interval and its stressed version.
  const fragile = excludesZero && stress !== undefined && !(Math.min(iv.low, stress.low) > 0 || Math.max(iv.high, stress.high) < 0);
  return { method, diff, low: iv.low, high: iv.high, n, family, excludesZero, fragile, clear: excludesZero && !fragile };
}

/**
 * EV per $ wagered of strategy i minus strategy j. Paired t-interval on the per-session differences
 * when the run supplied them; otherwise a Welch interval from the two standard errors. `family` is the
 * number of pairs the caller chose this one from. Null when there is nothing sound to say (too few
 * sessions, or a strategy that placed no bets).
 *
 * The worst-case-session check (session 23). A t-interval trusts the sample's own spread. A strategy
 * like Martingale wins a little in most sessions and rarely loses its whole bankroll; a sample with
 * few or no busts shows a small spread and a too-good mean, and cannot tell "cannot go bust" from "has
 * not gone bust yet". Measured on the real engine (Flat against Martingale, true difference zero), the
 * plain interval excluded zero in about 40% of 30-session runs when busts were rare, and still in 8%
 * of 1,000-session runs at a 0.25% bust rate, so no minimum session count fixes it. The one thing
 * known without sampling is the bound: a session cannot lose more than the starting bankroll. So a
 * difference is named only if the interval STILL excludes zero after one more session in which the
 * better-looking strategy lost its whole bankroll (and the other did nothing unusual). One such
 * session is the smallest stress that brought every measured case to 3% or less; where a bankroll
 * loss is small next to the sample (many sessions, or busts already common) it changes nothing.
 * The measurements are in src/report/comparison.stats.test.ts.
 */
export function evDifference(input: TakeawayInput, i: number, j: number, family = 1): DifferenceVerdict | null {
  const p = familyQuantilePoint(family);
  const pair = findPair(input, i, j);
  if (pair && Number.isFinite(pair.cmp.evDiffSE)) {
    const { cmp, sign } = pair;
    if (cmp.n < MIN_COMPARE_SESSIONS) return null;
    const diff = sign * cmp.evDiff;
    // i looks better when diff > 0: its bankroll loss is one more difference of −(its worst-case term).
    const extra = diff > 0 ? -(sign === 1 ? cmp.worstA : cmp.worstB) : sign === 1 ? cmp.worstB : cmp.worstA;
    return verdict("paired", diff, tInterval(diff, cmp.evDiffSE, cmp.n - 1, p), cmp.n, family, tIntervalWithOneMore(diff, cmp.evDiffSE, cmp.n, extra, p));
  }
  const a = input.strategies[i]?.stats;
  const b = input.strategies[j]?.stats;
  const n = input.nSessions;
  if (!a || !b || n < MIN_COMPARE_SESSIONS) return null;
  const diff = a.evPerWagered! - b.evPerWagered!;
  const se = Math.hypot(a.evSE!, b.evSE!);
  return verdict("independent", diff, tInterval(diff, se, welchDf(a.evSE!, b.evSE!, n, n), p), n, family);
}

/**
 * Bust rate of strategy i minus strategy j. Paired-proportion interval (Bonett-Price) on the sessions
 * where exactly one of the two went bust when the run supplied them; otherwise Newcombe's interval
 * for two independent proportions. `bustsI` / `bustsJ` are the bust counts.
 */
export function bustDifference(input: TakeawayInput, i: number, j: number, bustsI: number, bustsJ: number, family = 1): DifferenceVerdict | null {
  const z = normalQuantile(familyQuantilePoint(family));
  const pair = findPair(input, i, j);
  if (pair) {
    const { cmp, sign } = pair;
    if (cmp.n < MIN_COMPARE_SESSIONS) return null;
    const r = sign === 1 ? pairedProportionInterval(cmp.bustOnlyA, cmp.bustOnlyB, cmp.n, z) : pairedProportionInterval(cmp.bustOnlyB, cmp.bustOnlyA, cmp.n, z);
    return verdict("paired", r.diff, r, cmp.n, family);
  }
  const n = input.nSessions;
  if (n < MIN_COMPARE_SESSIONS) return null;
  const r = independentProportionInterval(bustsI, n, bustsJ, n, z);
  return verdict("independent", r.diff, r, n, family);
}

/** A difference of two percentages, in percentage points ("-0.15"); never "-0.00". */
function points(v: number, digits: number): string {
  const s = (v * 100).toFixed(digits);
  return Number(s) === 0 ? (0).toFixed(digits) : s;
}

/**
 * The comparison in words: which interval was used and on how many sessions, the difference with its
 * interval, and whether that interval includes zero. `what` names the difference ("A's EV per $ minus B's").
 */
function differenceClause(v: DifferenceVerdict, what: string, digits: number, pairedName: string, independentName: string): string {
  const sessions = v.n.toLocaleString("en-US");
  const how = v.method === "paired" ? `over the same ${sessions} sessions (${pairedName})` : `as independent samples of ${sessions} sessions each (${independentName})`;
  const range = `${points(v.low, digits)} to ${points(v.high, digits)}`;
  const interval = v.family === 1 ? `95% interval ${range}` : `${range}, widened to keep 95% across all ${v.family} pairs`;
  return `${how}, ${what} is ${points(v.diff, digits)} percentage points (${interval}), which ${v.excludesZero ? "excludes" : "includes"} zero`;
}

const TOO_FEW = `with fewer than ${MIN_COMPARE_SESSIONS} sessions the strategies are not compared`;

/** 95% interval for EV per $ wagered: the estimate ± 1.96 SE (normal approximation for the ratio). */
export function evInterval(stats: Readonly<Record<string, number>>): Interval | null {
  const ev = stats.evPerWagered;
  const se = stats.evSE;
  if (ev === undefined || se === undefined || !Number.isFinite(ev) || !Number.isFinite(se)) return null;
  return { low: ev - Z_95 * se, high: ev + Z_95 * se };
}

/** What the run supports saying about ONE strategy's EV per $ wagered. */
export interface EvClaim {
  /** The plain 95% interval (what the sentence and the table print). */
  iv: Interval;
  /** The interval lies wholly above the theoretical value, but would not after one more whole-bankroll loss. */
  fragile: boolean;
  /** The interval misses the theoretical value and the miss is not fragile. */
  missesTheory: boolean;
  /** Zero is inside the interval, or would be after one more whole-bankroll loss. */
  nearZero: boolean;
  /** The interval lies wholly above zero (it reads as a gain). */
  looksLikeGain: boolean;
  /**
   * The interval lies wholly below zero, and still would after one more whole-bankroll loss (that
   * session moves the mean down but widens the interval, so its upper end can rise above zero).
   */
  clearlyLoses: boolean;
}

/**
 * Claims about one strategy's EV per $ wagered, with the same worst-case-session check as evDifference
 * (session 24). The plain interval has the same weakness as the paired one: a strategy that wins a
 * little in most sessions and rarely loses its whole bankroll shows, in a sample with few or no busts,
 * a too-good mean and a too-small spread. Measured on the real engine with rare busts and 30 sessions,
 * the plain interval sat wholly ABOVE the true value in 44% of Martingale runs and 47% of Fibonacci
 * runs, and wholly above zero (reading as a profitable strategy) in 34% and 26%, on a game where
 * every strategy loses 2.70% of what it wagers. The loss a sample can hide
 * is bounded by the starting bankroll, so "above the theoretical value" and "above zero" are claimed
 * only if they survive one more session that lost the whole bankroll. Only the upper side is checked:
 * a hidden loss can only make a strategy look better than it is, and misses below the theoretical
 * value were measured at or under 5%. Rates: src/report/comparison.stats.test.ts.
 */
export function evClaim(input: TakeawayInput, index: number): EvClaim | null {
  const stats = input.strategies[index]?.stats;
  const iv = stats && evInterval(stats);
  if (!stats || !iv) return null;
  const theory = -input.edge;
  // The lowest the interval's lower end goes once one more whole-bankroll loss is added.
  let low = iv.low;
  // And the highest its upper end goes (for the "lost money per dollar" claim).
  let high = iv.high;
  const worst = input.startBankroll !== undefined && stats.meanWagered! > 0 ? input.startBankroll / stats.meanWagered! : NaN;
  if (Number.isFinite(worst)) {
    const stressed = tIntervalWithOneMore(stats.evPerWagered!, stats.evSE!, input.nSessions, stats.evPerWagered! - worst);
    if (Number.isFinite(stressed.low)) low = Math.min(low, stressed.low);
    if (Number.isFinite(stressed.high)) high = Math.max(high, stressed.high);
  }
  const fragile = iv.low > theory && low <= theory;
  return {
    iv,
    fragile,
    missesTheory: iv.high < theory || (iv.low > theory && !fragile),
    nearZero: contains(iv, 0) || (iv.low > 0 && low <= 0),
    looksLikeGain: iv.low > 0,
    clearlyLoses: high < 0,
  };
}

/**
 * The qualifier each strategy's EV per $ carries, straight from evClaim's `fragile` flag: null when
 * there is none. The results table, the report table and the screen-reader announcement all read
 * these, so they mark exactly the strategies the report sentence names.
 */
export function evNotes(input: TakeawayInput): (EvNote | null)[] {
  return input.strategies.map((_, i) => {
    const claim = evClaim(input, i);
    return claim?.fragile ? { gain: claim.looksLikeGain } : null;
  });
}

/** THE TakeawayInput for a finished run, from the run's own snapshot (the app and the report both use it). */
export function runTakeawayInput(result: MonteCarloResult, labels: readonly string[], scenario: ScenarioConfig): TakeawayInput {
  return {
    edge: gameEdge({ outcomes: scenario.game.outcomes }),
    nSessions: result.nSessions,
    strategies: result.perStrategy.map((o, i) => ({ label: labels[i] ?? o.strategyId, stats: o.stats })),
    comparisons: result.comparisons,
    startBankroll: toCents(scenario.startBankroll),
  };
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
  const measured = input.strategies.flatMap((s, index) => {
    const claim = evClaim(input, index);
    return claim ? [{ index, label: s.label, ev: s.stats.evPerWagered!, iv: claim.iv, claim }] : [];
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
  const misses = measured.filter((m) => m.claim.missesTheory).map((m) => m.label);
  // Above the theoretical value only until one more whole-bankroll loss: said so, and never left to read as a gain.
  const fragile = measured.filter((m) => m.claim.fragile);
  if (misses.length === 0 && fragile.length === 0) clauses.push(`${measured.length === 1 ? "the interval includes" : "every interval includes"} the theoretical ${pct2(theory)}`);
  if (misses.length > 0) clauses.push(`for ${names(misses)} the interval misses the theoretical ${pct2(theory)}, which a 95% interval does by chance about one time in twenty`);
  if (fragile.length > 0) {
    const gain = fragile.some((m) => m.claim.looksLikeGain);
    clauses.push(`for ${names(fragile.map((m) => m.label))} the interval is above the theoretical ${pct2(theory)}, but ${undoneByOneLoss(gain)}`);
  }
  if (Math.abs(input.edge) >= 1e-12) {
    // A fragile interval above zero is already covered by the clause above.
    const nearZero = measured.filter((m) => m.claim.nearZero && !(m.claim.fragile && m.claim.looksLikeGain)).map((m) => m.label);
    if (nearZero.length > 0) clauses.push(`for ${names(nearZero)} the result is not clearly different from zero at this sample size`);
  }
  if (measured.length >= 2) {
    const lo = byEv[0]!;
    const hi = byEv[byEv.length - 1]!;
    const v = evDifference(input, lo.index, hi.index, pairCount(measured.length));
    if (!v) clauses.push(TOO_FEW);
    else {
      const clause = differenceClause(v, `${lo.label}'s EV per $ minus ${hi.label}'s`, 2, "paired t-interval", "Welch interval");
      if (v.fragile) clauses.push(`${clause}, but one more whole-bankroll loss would undo that: the difference ${UNCLEAR}`);
      else clauses.push(`${clause}: ${v.clear ? `${lo.label} measured a lower EV per $ than ${hi.label}` : `the difference between the strategies ${UNCLEAR}`}`);
    }
  }
  sentence += `; ${clauses.join("; ")}.`;
  return sentence;
}

interface Bust {
  index: number;
  label: string;
  p: number;
  iv: Interval;
  busts: number;
}

/** Bust rates of the strategies that placed bets (one that never bet cannot go bust, so it is not compared). */
function busts(input: TakeawayInput): Bust[] {
  return input.strategies.flatMap((s, index) => {
    if (!evInterval(s.stats)) return [];
    const { pBust: p, pBustLow: low, pBustHigh: high } = s.stats;
    if (p === undefined || low === undefined || high === undefined || ![p, low, high].every(Number.isFinite)) return [];
    return [{ index, label: s.label, p, iv: { low, high }, busts: Math.round(p * input.nSessions) }];
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
    const v = bustDifference(input, hi.index, lo.index, hi.busts, lo.busts, pairCount(b.length));
    if (!v) sentence += `; ${TOO_FEW}`;
    else {
      const clause = differenceClause(v, `${hi.label}'s bust rate minus ${lo.label}'s`, 1, "paired-proportion interval", "Newcombe interval");
      sentence += `; ${clause}: ${v.clear ? `${hi.label} went bust more often than ${lo.label}` : `the difference in bust rates ${UNCLEAR}`}`;
    }
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

/**
 * A strategy that clearly wins most sessions yet clearly loses per dollar: the core lesson, when the
 * numbers show it. "Loses per dollar" must survive one more whole-bankroll loss too (evClaim's
 * clearlyLoses; session 25), not only the plain interval.
 */
function contrastSentence(input: TakeawayInput): string | null {
  const candidates = input.strategies.flatMap((s, index) => {
    const claim = evClaim(input, index);
    const { pProfit, pProfitLow, pProfitHigh } = s.stats;
    if (!claim || pProfit === undefined || pProfitLow === undefined || !(pProfitLow > 0.5) || !claim.clearlyLoses) return [];
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
