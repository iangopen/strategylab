import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { MonteCarloResult } from "../../engine/montecarlo";
import { formatStat } from "../format";
import { effectiveTheme, useThemeVersion } from "../theme";
import { countTick, fanScales, fanSeries, moneyTick, nearestIndex, nearestPath, niceTicks, referenceLines, seriesColorVar, type ChartRefs, type FanSeries, type Range } from "./adapters";
import { chartState, clipToPlot, countDraw, crosshairV, cssColor, drawAxes, drawRefLines, fillBand, overlayCtx, plotMapping, prepareFrame, strokeLine, useContainerWidth } from "./canvas";

const PANEL_HEIGHT = 220;

interface Props {
  result: MonteCarloResult;
  labels: readonly string[];
  refs: ChartRefs;
  /** Called with a session index when a sample path is clicked. */
  onPickSession: (session: number) => void;
  selectedSession: number | null;
}

/** Fan + spaghetti small multiples: one panel per strategy instance, ALL on the same x and y ranges. */
export const FanChart = memo(function FanChart({ result, labels, refs, onPickSession, selectedSession }: Props) {
  const scales = useMemo(() => fanScales(result, refs), [result, refs]);
  const series = useMemo(() => result.perStrategy.map((o) => fanSeries(o, result.bands.rounds)), [result]);
  return (
    <section className="panel chart-section">
      <h2>Bankroll over time</h2>
      <p className="help">
        Shaded: middle 90% (light) and middle 50% (dark) of {result.bands.sessions.toLocaleString("en-US")} sessions; thick line: median; thin
        lines: the first 50 sessions. Every panel uses the same axes. Click a thin line to replay that session.
      </p>
      <div className="small-multiples">
        {series.map((s, k) => (
          <FanPanel
            key={k}
            index={k}
            label={labels[k] ?? result.perStrategy[k]!.strategyId}
            series={s}
            x={scales.x}
            y={scales.y}
            refs={refs}
            onPickSession={onPickSession}
            selectedSession={selectedSession}
          />
        ))}
      </div>
    </section>
  );
});

interface PanelProps {
  index: number;
  label: string;
  series: FanSeries;
  x: Range;
  y: Range;
  refs: ChartRefs;
  onPickSession: (session: number) => void;
  selectedSession: number | null;
}

interface FanHover {
  round: number;
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
  path: { idx: number; val: number } | null;
}

const FanPanel = memo(function FanPanel({ index, label, series, x, y, refs, onPickSession, selectedSession }: PanelProps) {
  const [box, width] = useContainerWidth<HTMLDivElement>();
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const overlay = useRef<HTMLCanvasElement | null>(null);
  const theme = useThemeVersion();
  const colorVar = seriesColorVar(index);
  // Hover readout is view-only; it never re-runs the main draw effect (not in its deps), so the
  // fan itself is not redrawn on hover — only the overlay crosshair and this small text update.
  const [hover, setHover] = useState<FanHover | null>(null);

  useEffect(() => {
    const c = canvas.current;
    if (!c || width === 0) return;
    const f = prepareFrame(c, width, PANEL_HEIGHT, x, y);
    const color = cssColor(colorVar);
    drawAxes(f, niceTicks(x.min, x.max, 4), niceTicks(y.min, y.max, 4), countTick, moneyTick);
    const unclip = clipToPlot(f);
    fillBand(f, series.outer, color, 0.16);
    fillBand(f, series.inner, color, 0.32);
    series.paths.forEach((p, i) => {
      if (i !== selectedSession) strokeLine(f, p, color, 1, 0.22);
    });
    strokeLine(f, series.median, color, 2.5);
    const sel = selectedSession === null ? undefined : series.paths[selectedSession];
    if (sel) strokeLine(f, sel, cssColor("--text"), 1.5, 0.9);
    // Reference lines and their knocked-out labels go on top of the data, so text never sits on paths.
    const labels = drawRefLines(f, referenceLines(refs).map((r) => ({ value: r.value, label: r.label, align: r.kind === "start" ? "left" : "right" })), cssColor("--chart-ref"));
    unclip();
    chartState(c, { xMin: x.min, xMax: x.max, yMin: y.min, yMax: y.max, paths: series.paths.length, color, theme: effectiveTheme(), refLabels: JSON.stringify(labels), selected: selectedSession });
    countDraw(c);
  }, [width, theme, series, x, y, refs, colorVar, selectedSession]);

  function onClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const m = plotMapping(width, PANEL_HEIGHT, x, y);
    const hit = nearestPath(series.paths, e.clientX - rect.left, e.clientY - rect.top, (a, b) => [m.x(a), m.y(b)]);
    if (hit !== null) onPickSession(hit);
  }

  function clearHover() {
    setHover(null);
    chartState(canvas.current, { hoverRound: null });
    if (overlay.current && width > 0) overlayCtx(overlay.current, width, PANEL_HEIGHT);
  }

  function onMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (width === 0 || !canvas.current) return;
    const rect = canvas.current.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const m = plotMapping(width, PANEL_HEIGHT, x, y);
    if (px < m.left || px > m.left + m.width) return clearHover();
    const dataX = x.min + ((px - m.left) / (m.width || 1)) * (x.max - x.min);
    const idx = nearestIndex(series.outer.x, dataX);
    if (idx < 0) return;
    const round = series.outer.x[idx]!;
    const pi = nearestPath(series.paths, px, py, (a, b) => [m.x(a), m.y(b)], 8);
    let path: FanHover["path"] = null;
    if (pi !== null) {
      const p = series.paths[pi]!;
      path = { idx: pi, val: p.y[nearestIndex(p.x, round)]! };
    }
    chartState(canvas.current, { hoverRound: round });
    setHover({ round, p5: series.outer.lo[idx]!, p25: series.inner.lo[idx]!, p50: series.median.y[idx]!, p75: series.inner.hi[idx]!, p95: series.outer.hi[idx]!, path });
    if (overlay.current) crosshairV(overlayCtx(overlay.current, width, PANEL_HEIGHT), m.x(round), m.top, m.top + m.height, cssColor("--chart-axis"));
  }

  return (
    <figure className="chart-panel">
      <figcaption>
        <span className="swatch" style={{ background: `var(${colorVar})` }} aria-hidden="true" />
        {label}
      </figcaption>
      <div ref={box} className="canvas-box" style={{ position: "relative" }}>
        <canvas ref={canvas} data-testid="fan-canvas" data-label={label} onClick={onClick} onMouseMove={onMove} onMouseLeave={clearHover} role="img" aria-label={`${label}: bankroll over time, percentile bands and 50 sample sessions`} />
        <canvas ref={overlay} aria-hidden="true" style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none" }} />
      </div>
      <div className="chart-readout">
        {hover ? (
          <>
            Round {countTick(hover.round)}: p5 {formatStat("money", hover.p5)} · p25 {formatStat("money", hover.p25)} · median {formatStat("money", hover.p50)} · p75 {formatStat("money", hover.p75)} · p95 {formatStat("money", hover.p95)}
            {hover.path && ` · nearest: session ${hover.path.idx}, ${formatStat("money", hover.path.val)}`}
          </>
        ) : (
          "Hover for percentile and sample-path values."
        )}
      </div>
    </figure>
  );
});
