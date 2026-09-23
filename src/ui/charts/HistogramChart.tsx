import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { MonteCarloResult } from "../../engine/montecarlo";
import { useThemeVersion } from "../theme";
import { histogramPercents, histogramScales, logSafe, logTicks, moneyTick, niceTicks, pctTick, seriesColorVar, type Range, type YMode } from "./adapters";
import { cssColor, drawAxes, prepareFrame, refLineV, useContainerWidth } from "./canvas";

const PANEL_HEIGHT = 200;

interface Props {
  result: MonteCarloResult;
  labels: readonly string[];
  start: number;
}

/** Final-bankroll histograms: the run's SHARED bins, one shared y range, y as % of sessions. */
export const HistogramChart = memo(function HistogramChart({ result, labels, start }: Props) {
  // View option, not scenario state. One toggle applies to every panel, so they stay comparable.
  const [mode, setMode] = useState<YMode>("linear");
  const percents = useMemo(() => histogramPercents(result), [result]);
  const scales = useMemo(() => histogramScales(result, percents, mode), [result, percents, mode]);
  return (
    <section className="panel chart-section">
      <h2>Final bankroll distribution</h2>
      <div className="chart-tools">
        <p className="help">
          % of {result.nSessions.toLocaleString("en-US")} sessions ending in each range. Every panel uses the same bins and the same y axis.
        </p>
        <label className="theme-control">
          y axis
          <select value={mode} onChange={(e) => setMode(e.target.value === "log" ? "log" : "linear")}>
            <option value="linear">Linear</option>
            <option value="log">Log</option>
          </select>
        </label>
      </div>
      <div className="small-multiples">
        {percents.map((p, k) => (
          <HistogramPanel key={k} index={k} label={labels[k] ?? result.perStrategy[k]!.strategyId} edges={result.histogram.edges} percents={p} x={scales.x} y={scales.y} mode={mode} start={start} />
        ))}
      </div>
    </section>
  );
});

interface PanelProps {
  index: number;
  label: string;
  edges: Float64Array;
  percents: Float64Array;
  x: Range;
  y: Range;
  mode: YMode;
  start: number;
}

const HistogramPanel = memo(function HistogramPanel({ index, label, edges, percents, x, y, mode, start }: PanelProps) {
  const [box, width] = useContainerWidth<HTMLDivElement>();
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const theme = useThemeVersion();
  const colorVar = seriesColorVar(index);

  useEffect(() => {
    const c = canvas.current;
    if (!c || width === 0) return;
    const log = mode === "log";
    const f = prepareFrame(c, width, PANEL_HEIGHT, x, y, log);
    drawAxes(f, niceTicks(x.min, x.max, 4), log ? logTicks(y.min, y.max) : niceTicks(y.min, y.max, 4), moneyTick, pctTick);
    const heights = log ? logSafe(percents) : Array.from(percents);
    const base = f.y(y.min);
    f.ctx.fillStyle = cssColor(colorVar);
    heights.forEach((h, i) => {
      if (h === null || h <= 0) return; // empty bin: no bar (and never log 0)
      const x0 = f.x(edges[i]!);
      const x1 = f.x(edges[i + 1]!);
      const top = f.y(h);
      f.ctx.fillRect(x0 + 0.5, top, Math.max(1, x1 - x0 - 1), base - top);
    });
    refLineV(f, start, "Start", cssColor("--chart-ref"));
  }, [width, theme, edges, percents, x, y, mode, start, colorVar]);

  return (
    <figure className="chart-panel">
      <figcaption>
        <span className="swatch" style={{ background: `var(${colorVar})` }} aria-hidden="true" />
        {label}
      </figcaption>
      <div ref={box} className="canvas-box">
        <canvas ref={canvas} role="img" aria-label={`${label}: histogram of final bankrolls, ${mode} y axis`} style={{ cursor: "default" }} />
      </div>
    </figure>
  );
});
