import { memo, useEffect, useMemo, useRef } from "react";
import type { MonteCarloResult } from "../../engine/montecarlo";
import { useThemeVersion } from "../theme";
import { countTick, fanScales, fanSeries, moneyTick, nearestPath, niceTicks, referenceLines, seriesColorVar, type ChartRefs, type FanSeries, type Range } from "./adapters";
import { clipToPlot, cssColor, drawAxes, fillBand, plotMapping, prepareFrame, refLineH, strokeLine, useContainerWidth } from "./canvas";

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

const FanPanel = memo(function FanPanel({ index, label, series, x, y, refs, onPickSession, selectedSession }: PanelProps) {
  const [box, width] = useContainerWidth<HTMLDivElement>();
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const theme = useThemeVersion();
  const colorVar = seriesColorVar(index);

  useEffect(() => {
    const c = canvas.current;
    if (!c || width === 0) return;
    const f = prepareFrame(c, width, PANEL_HEIGHT, x, y);
    const color = cssColor(colorVar);
    drawAxes(f, niceTicks(x.min, x.max, 4), niceTicks(y.min, y.max, 4), countTick, moneyTick);
    const unclip = clipToPlot(f);
    fillBand(f, series.outer, color, 0.16);
    fillBand(f, series.inner, color, 0.32);
    for (const r of referenceLines(refs)) refLineH(f, r.value, r.label, cssColor("--chart-ref"), r.kind === "start" ? "left" : "right");
    series.paths.forEach((p, i) => {
      if (i !== selectedSession) strokeLine(f, p, color, 1, 0.22);
    });
    strokeLine(f, series.median, color, 2.5);
    const sel = selectedSession === null ? undefined : series.paths[selectedSession];
    if (sel) strokeLine(f, sel, cssColor("--text"), 1.5, 0.9);
    unclip();
  }, [width, theme, series, x, y, refs, colorVar, selectedSession]);

  function onClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const m = plotMapping(width, PANEL_HEIGHT, x, y);
    const hit = nearestPath(series.paths, e.clientX - rect.left, e.clientY - rect.top, (a, b) => [m.x(a), m.y(b)]);
    if (hit !== null) onPickSession(hit);
  }

  return (
    <figure className="chart-panel">
      <figcaption>
        <span className="swatch" style={{ background: `var(${colorVar})` }} aria-hidden="true" />
        {label}
      </figcaption>
      <div ref={box} className="canvas-box">
        <canvas ref={canvas} onClick={onClick} role="img" aria-label={`${label}: bankroll over time, percentile bands and 50 sample sessions`} />
      </div>
    </figure>
  );
});
