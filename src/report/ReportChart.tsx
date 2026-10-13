// The report's chart: the "Bankroll over time" fan as static small multiples, sized to fit one printed
// page. Same adapters and drawing layer as FanChart, so the chart rules hold: ONE shared x and y range
// for every panel (fanScales), one color per strategy, and every panel carries its text label. No
// interaction: it is made to be printed.
import { useEffect, useMemo, useRef } from "react";
import type { MonteCarloResult } from "../engine/montecarlo";
import { countTick, fanScales, fanSeries, moneyTick, niceTicks, referenceLines, seriesColorVar, type ChartRefs, type FanSeries, type Range } from "../ui/charts/adapters";
import { chartState, clipToPlot, countDraw, cssColor, drawAxes, drawRefLines, fillBand, prepareFrame, strokeLine, useContainerWidth } from "../ui/charts/canvas";
import { useThemeVersion } from "../ui/theme";
import { reportChartLayout } from "./layout";

interface Props {
  result: MonteCarloResult;
  labels: readonly string[];
  refs: ChartRefs;
}

export function ReportChart({ result, labels, refs }: Props) {
  const scales = useMemo(() => fanScales(result, refs), [result, refs]);
  const series = useMemo(() => result.perStrategy.map((o) => fanSeries(o, result.bands.rounds)), [result]);
  const { columns, height } = reportChartLayout(series.length);
  return (
    <div className="report-chart" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {series.map((s, k) => (
        <ReportPanel key={k} index={k} label={labels[k] ?? result.perStrategy[k]!.strategyId} series={s} x={scales.x} y={scales.y} refs={refs} height={height} />
      ))}
    </div>
  );
}

function ReportPanel({ index, label, series, x, y, refs, height }: { index: number; label: string; series: FanSeries; x: Range; y: Range; refs: ChartRefs; height: number }) {
  const [box, width] = useContainerWidth<HTMLDivElement>();
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const theme = useThemeVersion();
  const colorVar = seriesColorVar(index);
  useEffect(() => {
    const c = canvas.current;
    if (!c || width === 0) return;
    const f = prepareFrame(c, width, height, x, y);
    const color = cssColor(colorVar);
    drawAxes(f, niceTicks(x.min, x.max, 3), niceTicks(y.min, y.max, 3), countTick, moneyTick);
    const unclip = clipToPlot(f);
    fillBand(f, series.outer, color, 0.16);
    fillBand(f, series.inner, color, 0.32);
    for (const p of series.paths) strokeLine(f, p, color, 1, 0.18);
    strokeLine(f, series.median, color, 2.5);
    drawRefLines(f, referenceLines(refs).map((r) => ({ value: r.value, label: r.label, align: r.kind === "start" ? "left" : "right" })), cssColor("--chart-ref"));
    unclip();
    chartState(c, { xRange: `${x.min}-${x.max}`, yMin: y.min, yMax: y.max });
    countDraw(c);
  }, [width, height, theme, series, x, y, refs, colorVar]);
  return (
    <figure className="chart-panel">
      <figcaption>
        <span className="swatch" style={{ background: `var(${colorVar})` }} aria-hidden="true" />
        {label}
      </figcaption>
      <div ref={box} className="canvas-box">
        <canvas ref={canvas} data-testid="report-canvas" data-label={label} role="img" aria-label={`${label}: bankroll over time, percentile bands and 50 sample sessions, on the same axes as every other panel.`} />
      </div>
    </figure>
  );
}
