// Pure result-to-chart transforms. No DOM, no canvas: every function here is unit-tested.
// Money stays in engine cents; components convert only when printing labels.
import type { MonteCarloResult, StrategyOutcome } from "../../engine/montecarlo";
import type { Replay } from "../../engine/replay";
import type { Bands } from "../../engine/stats/bands";
import type { EndReason } from "../../engine/types";

export interface Range {
  min: number;
  max: number;
}

/** A polyline in data units. x and y have the same length. */
export interface Line {
  x: ArrayLike<number>;
  y: ArrayLike<number>;
}

/** Filled area between lo and hi over x, in data units. */
export interface Band {
  x: ArrayLike<number>;
  lo: ArrayLike<number>;
  hi: ArrayLike<number>;
}

export interface RefLine {
  kind: "start" | "winTarget" | "floor";
  label: string;
  value: number;
}

/** Scenario facts the charts need (cents). */
export interface ChartRefs {
  start: number;
  stopWin: number | null;
  stopLoss: number | null;
}

// ---------------------------------------------------------------- colors

/** Number of palette slots (--series-0 .. --series-7 in index.css). */
export const SERIES_COLOR_COUNT = 8;

/** ONE color per strategy instance, by its index in the run: the same everywhere. */
export function seriesColorVar(instanceIndex: number): string {
  return `--series-${((instanceIndex % SERIES_COLOR_COUNT) + SERIES_COLOR_COUNT) % SERIES_COLOR_COUNT}`;
}

// ---------------------------------------------------------------- ticks and nice numbers

/** Smallest "nice" number (1, 2, 2.5, 5 × 10^k) that is >= v. 0 stays 0. */
export function niceCeil(v: number): number {
  if (!(v > 0)) return 0;
  const mag = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) {
    const c = m * mag;
    if (c >= v * (1 - 1e-12)) return c;
  }
  return 10 * mag;
}

/** Evenly spaced round tick values covering [min, max], about `target` of them. */
export function niceTicks(min: number, max: number, target = 5): number[] {
  if (!(max > min)) return [min];
  const step = niceCeil((max - min) / target);
  const out: number[] = [];
  const first = Math.ceil(min / step - 1e-9) * step;
  for (let v = first; v <= max + step * 1e-9; v += step) out.push(Number(v.toPrecision(12)));
  return out;
}

/** Powers of ten covering a positive [min, max] (log axes). */
export function logTicks(min: number, max: number): number[] {
  const out: number[] = [];
  for (let e = Math.floor(Math.log10(min)); e <= Math.ceil(Math.log10(max)); e++) {
    const v = 10 ** e;
    if (v >= min * (1 - 1e-12) && v <= max * (1 + 1e-12)) out.push(v);
  }
  return out;
}

// ---------------------------------------------------------------- fan + spaghetti

/**
 * SHARED scales for every fan panel in a run: x = 0..maxRounds (last band checkpoint),
 * y = 0..niceCeil(max over ALL strategies of p95 bands, every sample-path point, the start,
 * and the win target). Never per panel: per-panel scales make Martingale's tail look like Flat's.
 */
export function fanScales(result: MonteCarloResult, refs: ChartRefs): { x: Range; y: Range } {
  const rounds = result.bands.rounds;
  let top = Math.max(refs.start, refs.stopWin ?? 0);
  for (const s of result.perStrategy) {
    for (let i = 0; i < s.bands.p95.length; i++) top = Math.max(top, s.bands.p95[i]!);
    for (const p of s.samplePaths) for (const v of p.bankroll) if (v > top) top = v;
  }
  return { x: { min: 0, max: rounds[rounds.length - 1] ?? 0 }, y: { min: 0, max: niceCeil(top * 1.02) } };
}

export interface FanSeries {
  /** p5-p95 (light). */
  outer: Band;
  /** p25-p75 (darker). */
  inner: Band;
  median: Line;
  /** The 50 sample paths, session index = array index. */
  paths: Line[];
}

/** One strategy's fan: bands start at round 0 at one point (all percentiles equal the start). */
export function fanSeries(outcome: StrategyOutcome, rounds: Float64Array): FanSeries {
  const b = outcome.bands;
  return {
    outer: { x: rounds, lo: b.p5, hi: b.p95 },
    inner: { x: rounds, lo: b.p25, hi: b.p75 },
    median: { x: rounds, y: b.p50 },
    paths: outcome.samplePaths.map((p) => ({ x: p.rounds, y: p.bankroll })),
  };
}

/**
 * End of a strategy's "active" x range: the round of the checkpoint AFTER the last one where any of
 * p5..p95 still changes (sessions that ended carry their final bankroll forward, so the bands go flat
 * once the strategy's sessions have played out). Never changes at all -> the first checkpoint;
 * still changing at the last checkpoint -> the full range. From the existing band arrays only.
 */
export function activeRangeEnd(bands: Bands, rounds: ArrayLike<number>): number {
  const n = rounds.length;
  if (n === 0) return 0;
  const series = [bands.p5, bands.p25, bands.p50, bands.p75, bands.p95];
  let lastChange = 0;
  for (let j = n - 1; j >= 1; j--) {
    if (series.some((b) => b[j] !== b[j - 1])) {
      lastChange = j;
      break;
    }
  }
  return rounds[Math.min(lastChange + 1, n - 1)]!;
}

/**
 * The ONE x/y pair every fan panel uses, given the shared zoom window (or null = full). x is the
 * window clamped to the full range; y is ALWAYS the global shared y: zooming never rescales y.
 */
export function zoomedFanScales(scales: { x: Range; y: Range }, zoom: Range | null): { x: Range; y: Range } {
  if (zoom === null) return scales;
  const min = Math.max(scales.x.min, Math.min(zoom.min, scales.x.max));
  const max = Math.min(scales.x.max, Math.max(zoom.max, min));
  return { x: { min, max }, y: scales.y };
}

/** Reference lines: starting bankroll always; win target and loss floor only when set. */
export function referenceLines(refs: ChartRefs): RefLine[] {
  const out: RefLine[] = [{ kind: "start", label: "Start", value: refs.start }];
  if (refs.stopWin !== null) out.push({ kind: "winTarget", label: "Win target", value: refs.stopWin });
  if (refs.stopLoss !== null) out.push({ kind: "floor", label: "Loss floor", value: refs.stopLoss });
  return out;
}

// ---------------------------------------------------------------- histogram

export type YMode = "linear" | "log";

/** Counts on the run's SHARED bins as % of that strategy's sessions (each sums to 100). */
export function histogramPercents(result: MonteCarloResult): Float64Array[] {
  return result.perStrategy.map((s) => {
    let n = 0;
    for (const c of s.histogramCounts) n += c;
    const out = new Float64Array(s.histogramCounts.length);
    if (n > 0) s.histogramCounts.forEach((c, i) => (out[i] = (c / n) * 100));
    return out;
  });
}

/** Log-safe bar heights: empty bins become null (no bar), never log(0). */
export function logSafe(values: ArrayLike<number>): (number | null)[] {
  return Array.from(values, (v) => (v > 0 ? v : null));
}

/**
 * SHARED histogram scales: x = the run's shared bin edges; y shared by every panel.
 * Linear: 0..niceCeil(max bin %). Log: powers of ten around the smallest NONZERO and the largest
 * bin % across all strategies (log axes cannot start at 0; empty bins are simply not drawn).
 */
export function histogramScales(result: MonteCarloResult, percents: Float64Array[], mode: YMode): { x: Range; y: Range } {
  const edges = result.histogram.edges;
  let maxPct = 0;
  let minPositive = Infinity;
  for (const p of percents) {
    for (const v of p) {
      if (v > maxPct) maxPct = v;
      if (v > 0 && v < minPositive) minPositive = v;
    }
  }
  const x = { min: edges[0]!, max: edges[edges.length - 1]! };
  if (mode === "log") {
    if (!Number.isFinite(minPositive)) return { x, y: { min: 0.01, max: 100 } };
    return { x, y: { min: 10 ** Math.floor(Math.log10(minPositive)), max: 10 ** Math.ceil(Math.log10(maxPct)) } };
  }
  return { x, y: { min: 0, max: niceCeil(maxPct) || 1 } };
}

// ---------------------------------------------------------------- hit testing

/** Distance in pixels from point (px, py) to segment (ax, ay)-(bx, by). */
function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * Index of the path closest to a click, in PIXEL space (toPx maps data to pixels), or null if
 * none is within maxDistPx. Path index = session index, so clicking picks a session to replay.
 */
export function nearestPath(paths: readonly Line[], px: number, py: number, toPx: (x: number, y: number) => [number, number], maxDistPx = 6): number | null {
  let best: number | null = null;
  let bestD = maxDistPx;
  paths.forEach((p, idx) => {
    let prev: [number, number] | null = null;
    for (let i = 0; i < p.x.length; i++) {
      const cur = toPx(p.x[i]!, p.y[i]!);
      const d = prev ? segmentDistance(px, py, prev[0], prev[1], cur[0], cur[1]) : Math.hypot(px - cur[0], py - cur[1]);
      if (d <= bestD) {
        bestD = d;
        best = idx;
      }
      prev = cur;
    }
  });
  return best;
}

/**
 * Index of the value in an ASCENDING array closest to `target` (ties go to the lower index).
 * Empty array -> -1. Used by hover readouts to snap a cursor round to the nearest recorded point.
 */
export function nearestIndex(xs: ArrayLike<number>, target: number): number {
  const n = xs.length;
  if (n === 0) return -1;
  if (target <= xs[0]!) return 0;
  if (target >= xs[n - 1]!) return n - 1;
  let lo = 0;
  let hi = n - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = xs[mid]!;
    if (v === target) return mid;
    if (v < target) lo = mid + 1;
    else hi = mid - 1;
  }
  // lo is the first index above target, hi = lo - 1 is the last below it.
  return target - xs[hi]! <= xs[lo]! - target ? hi : lo;
}

// ---------------------------------------------------------------- tick labels

/** Short money label for axis ticks, from cents: $0, $950, $1,100, $12k, $1.5M. */
export function moneyTick(cents: number): string {
  const d = cents / 100;
  const a = Math.abs(d);
  const trim = (x: number) => Number(x.toPrecision(3)).toString();
  if (a >= 1e6) return `$${trim(d / 1e6)}M`;
  if (a >= 1e4) return `$${trim(d / 1e3)}k`;
  return `$${Math.round(d).toLocaleString("en-US")}`;
}

/** Short count label for axis ticks: 950, 1,000, 25k, 1M. */
export function countTick(v: number): string {
  const a = Math.abs(v);
  const trim = (x: number) => Number(x.toPrecision(3)).toString();
  if (a >= 1e6) return `${trim(v / 1e6)}M`;
  if (a >= 1e4) return `${trim(v / 1e3)}k`;
  return Math.round(v).toLocaleString("en-US");
}

/** Percent tick for histogram y axes (values already in %). */
export function pctTick(v: number): string {
  return v >= 1 ? `${Number(v.toPrecision(3))}%` : `${Number(v.toPrecision(2))}%`;
}

// ---------------------------------------------------------------- replay

export interface ReplayLayout {
  /** ONE x range shared by the bankroll, bet and win/loss strips: 0..longest strategy's rounds. */
  x: Range;
  bankrollY: Range;
  betY: Range;
  bankroll: Line[];
  bets: Line[];
}

/** Stacked replay layout: shared x; bankroll and bet y ranges shared by every strategy, from 0. */
export function replayLayout(rep: Replay, refs: ChartRefs): ReplayLayout {
  let longest = 1;
  let topBank = Math.max(refs.start, refs.stopWin ?? 0);
  let topBet = 0;
  for (const s of rep.strategies) {
    longest = Math.max(longest, s.rounds);
    for (const v of s.bankroll.bankroll) if (v > topBank) topBank = v;
    for (const v of s.bets.bankroll) if (v > topBet) topBet = v;
  }
  return {
    x: { min: 0, max: longest },
    bankrollY: { min: 0, max: niceCeil(topBank * 1.02) },
    betY: { min: 0, max: niceCeil(topBet * 1.05) || 1 },
    bankroll: rep.strategies.map((s) => ({ x: s.bankroll.rounds, y: s.bankroll.bankroll })),
    // A bet decided after r rounds is placed on round r + 1: drawn as a step over [r, r + 1].
    bets: rep.strategies.map((s) => stepLine(s.bets.rounds, s.bets.bankroll)),
  };
}

/** The earliest round at which any strategy in the replay ended (>= 1). "Fit to first ending" zooms here. */
export function firstEndingRound(rep: Replay): number {
  let m = Infinity;
  for (const s of rep.strategies) m = Math.min(m, s.rounds);
  return Number.isFinite(m) ? Math.max(1, m) : 1;
}

/**
 * Zoom x-range from a drag between two data-x values, ordered and clamped to `full`. Returns null
 * when the span is below `minSpan` rounds (a click, not a drag), so the caller keeps the current view.
 */
export function zoomFromDrag(a: number, b: number, full: Range, minSpan = 2): Range | null {
  const lo = Math.max(full.min, Math.min(a, b));
  const hi = Math.min(full.max, Math.max(a, b));
  if (!(hi - lo >= minSpan)) return null;
  return { min: Math.floor(lo), max: Math.ceil(hi) };
}

/** Step line: value v_i holds over [x_i, x_i + 1]. */
function stepLine(x: readonly number[], y: readonly number[]): Line {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < x.length; i++) {
    xs.push(x[i]!, x[i]! + 1);
    ys.push(y[i]!, y[i]!);
  }
  return { x: xs, y: ys };
}

export interface StripCell {
  x0: number;
  x1: number;
  /** 1 = every round won, 0 = every round lost; in between for bucketed strips. */
  winRate: number;
}

/** The ONE win/loss strip as cells over rounds: one per round, or one per bucket (shaded by win rate). */
export function stripCells(rep: Replay): StripCell[] {
  const s = rep.strip;
  if (s.kind === "rounds") return Array.from(s.wins, (w, r) => ({ x0: r, x1: r + 1, winRate: w }));
  const out: StripCell[] = [];
  s.counts.forEach((c, b) => {
    if (c === 0) return;
    out.push({ x0: b * s.bucketRounds, x1: b * s.bucketRounds + c, winRate: s.wins[b]! / c });
  });
  return out;
}

const END_TEXT: Record<EndReason, string> = {
  ruin: "ruined (below table min)",
  insufficientFunds: "couldn't cover the next bet",
  stopWin: "reached the win target",
  stopLoss: "hit the loss floor",
  maxRounds: "played every round",
  strategyStop: "stopped by the strategy",
};

/** Plain-language end of a replayed session, e.g. "couldn't cover the next bet after 37 rounds". */
export function endText(reason: EndReason, rounds: number): string {
  return `${END_TEXT[reason]} after ${rounds.toLocaleString("en-US")} round${rounds === 1 ? "" : "s"}`;
}

// ---------------------------------------------------------------- reference-label placement

/** A reference label to place: its line's pixel y, which end it sits at, and its text size. */
export interface LabelRequest {
  label: string;
  /** Pixel y of the reference line. */
  lineY: number;
  align: "left" | "right";
  /** Measured text width and height, px. */
  width: number;
  height: number;
}

/** Where a label goes: its knockout box (text + padding), in canvas CSS px. */
export interface PlacedLabel {
  label: string;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** Text anchor inside the box. */
  textX: number;
  textY: number;
  /** True when it was moved off its default spot (above the line) to avoid another label or the edge. */
  moved: boolean;
}

export const LABEL_PAD = 2;
const LABEL_GAP = 2;

const overlaps = (a: PlacedLabel, b: PlacedLabel) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/**
 * Places reference labels so that no two boxes overlap and none leaves the plot vertically. Each
 * label prefers the spot just above its line, then just below it, then the nearest spot above or
 * below the labels it collides with. Pure: the canvas layer draws what this returns.
 */
export function placeLabels(requests: readonly LabelRequest[], plot: { left: number; width: number; top: number; height: number }): PlacedLabel[] {
  const placed: PlacedLabel[] = [];
  const bottom = plot.top + plot.height;
  for (const r of requests) {
    const w = r.width + 2 * LABEL_PAD;
    const h = r.height + 2 * LABEL_PAD;
    const x0 = r.align === "right" ? plot.left + plot.width - 2 - w : plot.left + 2;
    const at = (y0: number, moved: boolean): PlacedLabel => ({
      label: r.label,
      x0,
      x1: x0 + w,
      y0,
      y1: y0 + h,
      textX: r.align === "right" ? x0 + w - LABEL_PAD : x0 + LABEL_PAD,
      textY: y0 + h - LABEL_PAD,
      moved,
    });
    const fits = (c: PlacedLabel) => c.y0 >= plot.top && c.y1 <= bottom && placed.every((p) => !overlaps(c, p));
    const candidates = [at(r.lineY - LABEL_GAP - h, false), at(r.lineY + LABEL_GAP, true)];
    // Then just above / below every label it could collide with, nearest to the line first.
    for (const p of placed) candidates.push(at(p.y0 - LABEL_GAP - h, true), at(p.y1 + LABEL_GAP, true));
    const rest = candidates.slice(2).sort((a, b) => Math.abs(a.y0 - r.lineY) - Math.abs(b.y0 - r.lineY));
    const choice = [...candidates.slice(0, 2), ...rest].find(fits);
    // Nothing fits (more labels than the plot can hold): keep it above its line, clamped inside the plot.
    placed.push(choice ?? at(Math.max(plot.top, Math.min(bottom - h, r.lineY - LABEL_GAP - h)), true));
  }
  return placed;
}
