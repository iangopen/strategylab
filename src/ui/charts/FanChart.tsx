import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { MonteCarloResult } from "../../engine/montecarlo";
import { formatStat } from "../format";
import { effectiveTheme, useThemeVersion } from "../theme";
import { activeRangeEnd, countTick, fanScales, fanSeries, moneyTick, nearestIndex, nearestPath, niceTicks, referenceLines, seriesColorVar, zoomedFanScales, zoomFromDrag, type ChartRefs, type FanSeries, type Range } from "./adapters";
import { chartState, clipToPlot, countDraw, crosshairV, cssColor, drawAxes, drawRefLines, fillBand, overlayCtx, plotMapping, prepareFrame, strokeLine, useContainerWidth } from "./canvas";

/** Pointer travel (px) below which a press is a click (pick a path), not a zoom drag. */
const CLICK_SLOP_PX = 4;

const PANEL_HEIGHT = 220;

interface Props {
  result: MonteCarloResult;
  labels: readonly string[];
  refs: ChartRefs;
  /** Called with a session index when a sample path is clicked. */
  onPickSession: (session: number) => void;
  selectedSession: number | null;
}

/**
 * Fan + spaghetti small multiples: one panel per strategy instance, ALL on the same x and y ranges.
 * Zoom is ONE shared x window applied to every panel (drag on any panel, "Fit to this strategy",
 * double-click or Reset to undo); y never rescales. The window is view state, reset by a new run.
 */
export const FanChart = memo(function FanChart({ result, labels, refs, onPickSession, selectedSession }: Props) {
  const scales = useMemo(() => fanScales(result, refs), [result, refs]);
  const series = useMemo(() => result.perStrategy.map((o) => fanSeries(o, result.bands.rounds)), [result]);
  const activeEnds = useMemo(() => result.perStrategy.map((o) => activeRangeEnd(o.bands, result.bands.rounds)), [result]);
  // Tied to the result it was made for, so a new run starts unzoomed (no effect needed).
  const [zoomState, setZoomState] = useState<{ result: MonteCarloResult; range: Range } | null>(null);
  const zoom = zoomState?.result === result ? zoomState.range : null;
  const setZoom = (range: Range | null) => setZoomState(range ? { result, range } : null);
  const view = useMemo(() => zoomedFanScales(scales, zoom), [scales, zoom]);
  return (
    <section className="panel chart-section">
      <h2>Bankroll over time</h2>
      <p className="help">
        Shaded: middle 90% (light) and middle 50% (dark) of {result.bands.sessions.toLocaleString("en-US")} sessions; thick line: median; thin
        lines: the first 50 sessions. Every panel uses the same axes. Click a thin line to replay that session. Drag across any panel to zoom
        every panel to those rounds; double-click (or Show every round) to reset.
      </p>
      <div className="chart-tools">
        {/* Not "Reset zoom": the replay chart has that button, and two same-named buttons are ambiguous. */}
        <button type="button" onClick={() => setZoom(null)} disabled={zoom === null}>
          Show every round
        </button>
        <span className="help" data-testid="fan-zoom-status">
          {zoom ? `Showing rounds ${Math.round(view.x.min).toLocaleString("en-US")}–${Math.round(view.x.max).toLocaleString("en-US")} in every panel.` : "Showing every round."}
        </span>
      </div>
      <div className="small-multiples">
        {series.map((s, k) => (
          <FanPanel
            key={k}
            index={k}
            label={labels[k] ?? result.perStrategy[k]!.strategyId}
            series={s}
            x={view.x}
            y={view.y}
            fullX={scales.x}
            zoomed={zoom !== null}
            activeEnd={activeEnds[k]!}
            onZoom={setZoom}
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
  /** The shared (possibly zoomed) x window, identical for every panel. */
  x: Range;
  /** The global shared y range: never changes with zoom. */
  y: Range;
  /** The full x range (drags are clamped to it). */
  fullX: Range;
  zoomed: boolean;
  /** Where this strategy's bands stop changing (see activeRangeEnd). */
  activeEnd: number;
  onZoom: (range: Range | null) => void;
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

const FanPanel = memo(function FanPanel({ index, label, series, x, y, fullX, zoomed, activeEnd, onZoom, refs, onPickSession, selectedSession }: PanelProps) {
  const [box, width] = useContainerWidth<HTMLDivElement>();
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const overlay = useRef<HTMLCanvasElement | null>(null);
  const theme = useThemeVersion();
  const colorVar = seriesColorVar(index);
  // Hover readout is view-only; it never re-runs the main draw effect (not in its deps), so the
  // fan itself is not redrawn on hover — only the overlay crosshair and this small text update.
  const [hover, setHover] = useState<FanHover | null>(null);
  // An in-progress drag (data-x and pixel x where it started), and whether the click that follows
  // a completed drag must be ignored (it was a zoom, not a path pick).
  const drag = useRef<{ dataX: number; px: number } | null>(null);
  const suppressClick = useRef(false);

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
    // The selected (replayed) session: drawn after every other path and the median, thicker, on a
    // halo in the panel color, so it stays visible even inside a dense cluster. Theme-aware.
    const sel = selectedSession === null ? undefined : series.paths[selectedSession];
    const halo = cssColor("--panel", "#fff");
    if (sel) {
      strokeLine(f, sel, halo, 5, 1);
      strokeLine(f, sel, cssColor("--text"), 2.5, 1);
    }
    // Reference lines and their knocked-out labels go on top of the data, so text never sits on paths.
    const labels = drawRefLines(f, referenceLines(refs).map((r) => ({ value: r.value, label: r.label, align: r.kind === "start" ? "left" : "right" })), cssColor("--chart-ref"));
    unclip();
    chartState(c, { xMin: x.min, xMax: x.max, xRange: `${x.min}-${x.max}`, zoom: zoomed ? `${x.min}-${x.max}` : "full", activeEnd, yMin: y.min, yMax: y.max, paths: series.paths.length, color, theme: effectiveTheme(), refLabels: JSON.stringify(labels), selected: selectedSession, highlighted: sel ? selectedSession : null, halo: sel ? halo : null });
    countDraw(c);
  }, [width, theme, series, x, y, refs, colorVar, selectedSession, zoomed, activeEnd]);

  function onClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (suppressClick.current) {
      suppressClick.current = false; // this click ended a zoom drag
      return;
    }
    if (e.detail > 1) return; // the second click of a double-click (which resets the zoom)
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

  /** Data-x under a pointer position, in the current (shared) window. */
  function dataXAt(clientX: number): number {
    const rect = canvas.current!.getBoundingClientRect();
    const m = plotMapping(width, PANEL_HEIGHT, x, y);
    return x.min + ((clientX - rect.left - m.left) / (m.width || 1)) * (x.max - x.min);
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (width === 0 || !canvas.current || e.button !== 0) return;
    drag.current = { dataX: dataXAt(e.clientX), px: e.clientX };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    const d = drag.current;
    drag.current = null;
    if (!d || Math.abs(e.clientX - d.px) <= CLICK_SLOP_PX) return; // a click: onClick picks a path
    if (overlay.current) overlayCtx(overlay.current, width, PANEL_HEIGHT);
    const z = zoomFromDrag(d.dataX, dataXAt(e.clientX), fullX);
    suppressClick.current = true;
    if (z) onZoom(z);
  }

  function onMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (width === 0 || !canvas.current) return;
    const rect = canvas.current.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const m = plotMapping(width, PANEL_HEIGHT, x, y);
    const d = drag.current;
    if (d && Math.abs(e.clientX - d.px) > CLICK_SLOP_PX && overlay.current) {
      // Drag selection on the overlay only; the charts are not redrawn while dragging.
      const ctx = overlayCtx(overlay.current, width, PANEL_HEIGHT);
      const a = m.x(d.dataX);
      ctx.fillStyle = "rgba(120,140,170,0.28)";
      ctx.fillRect(Math.min(a, px), m.top, Math.abs(px - a), m.height);
      return;
    }
    if (px < m.left || px > m.left + m.width) return clearHover();
    const dataX = x.min + ((px - m.left) / (m.width || 1)) * (x.max - x.min);
    // Snap to the nearest band checkpoint INSIDE the shared window (the readout follows the zoom).
    let idx = nearestIndex(series.outer.x, dataX);
    if (idx < 0) return;
    const inWindow = (i: number) => series.outer.x[i]! >= x.min && series.outer.x[i]! <= x.max;
    if (!inWindow(idx)) {
      const alt = [idx - 1, idx + 1].find((i) => i >= 0 && i < series.outer.x.length && inWindow(i));
      if (alt === undefined) return clearHover();
      idx = alt;
    }
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
        <button
          type="button"
          className="link fit-strategy"
          title={`Zoom every panel to rounds 0–${activeEnd.toLocaleString("en-US")}, where ${label}'s sessions have played out`}
          onClick={() => onZoom({ min: 0, max: activeEnd })}
        >
          Fit to this strategy
        </button>
      </figcaption>
      <div ref={box} className="canvas-box" style={{ position: "relative" }}>
        <canvas
          ref={canvas}
          data-testid="fan-canvas"
          data-label={label}
          style={{ touchAction: "none" }}
          onClick={onClick}
          onPointerDown={onPointerDown}
          onPointerMove={onMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => (drag.current = null)}
          onPointerLeave={clearHover}
          onDoubleClick={() => onZoom(null)}
          role="img" aria-label={`${label}: bankroll over time, percentile bands and 50 sample sessions`} />
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
