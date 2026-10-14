import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { SweepCellResult } from "../../sweep/run";
import { formatAxisValue, SWEEP_FIELD_LABELS, type SweepConfig, type SweepGrid } from "../../sweep/sweep";
import { chartState, countDraw, cssColor, useContainerWidth } from "../charts/canvas";
import { effectiveTheme, useThemeVersion } from "../theme";
import { axisTitle, bustColor, cellAt, cellText, labelStride, legendGradient, markedCells, rgb, textOn, type GridBox } from "./heatmap";

interface Props {
  /** Shown between the legend and the table (the readout sentences). */
  children?: React.ReactNode;
  sweep: SweepConfig;
  grid: SweepGrid;
  /** Cell order (row * columns + column); null = not run yet. */
  cells: readonly (SweepCellResult | null)[];
  /** Every cell has finished: the readout markers can be drawn. */
  complete: boolean;
}

const MARGIN = { left: 64, right: 8, top: 6, bottom: 44 };
const FONT = "11px system-ui, sans-serif";

/** P(bust) per cell on a fixed 0-100% colour scale, with hover / tap values, a legend and a table view. */
export const SweepHeatmap = memo(function SweepHeatmap({ children, sweep, grid, cells, complete }: Props) {
  const [box, width] = useContainerWidth<HTMLDivElement>();
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const theme = useThemeVersion();
  const [hover, setHover] = useState<number | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const cols = grid.xValues.length;
  const rows = grid.yValues.length;
  const marked = useMemo(() => (complete ? markedCells(sweep, grid, cells) : new Set<number>()), [complete, sweep, grid, cells]);

  const layout = useMemo((): GridBox & { height: number } => {
    const plotW = Math.max(40, width - MARGIN.left - MARGIN.right);
    const cellW = plotW / cols;
    const cellH = Math.min(32, Math.max(14, Math.min(cellW, 360 / rows)));
    return { left: MARGIN.left, top: MARGIN.top, cellW, cellH, cols, rows, height: MARGIN.top + rows * cellH + MARGIN.bottom };
  }, [width, cols, rows]);

  useEffect(() => {
    const c = canvas.current;
    if (!c || width === 0) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(width * dpr);
    c.height = Math.round(layout.height * dpr);
    c.style.width = `${width}px`;
    c.style.height = `${layout.height}px`;
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, layout.height);
    const { left, top, cellW, cellH } = layout;
    const pending = cssColor("--chart-grid");
    const showText = cellW >= 44 && cellH >= 18;
    ctx.font = FONT;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    let filled = 0;
    for (let r = 0; r < rows; r++) {
      for (let col = 0; col < cols; col++) {
        const k = r * cols + col;
        const cell = cells[k] ?? null;
        const x = left + col * cellW;
        const y = top + (rows - 1 - r) * cellH;
        const color = cell ? bustColor(cell.stats.pBust!) : null;
        ctx.fillStyle = color ? rgb(color) : pending;
        ctx.fillRect(x, y, cellW - 1, cellH - 1);
        if (!cell || !color) continue;
        filled++;
        if (showText) {
          ctx.fillStyle = textOn(color);
          ctx.fillText(`${(cell.stats.pBust! * 100).toFixed(cell.stats.pBust! < 0.1 ? 1 : 0)}%`, x + cellW / 2, y + cellH / 2);
        }
        if (marked.has(k)) {
          // A dot in the top-right corner, clear of the cell's number.
          const rad = Math.max(2.5, Math.min(4, Math.min(cellW, cellH) / 5));
          ctx.fillStyle = textOn(color);
          ctx.beginPath();
          ctx.arc(x + cellW - 1 - rad - 2, y + rad + 2, rad, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    const active = hover ?? picked;
    if (active !== null) {
      const r = Math.floor(active / cols);
      const col = active % cols;
      ctx.strokeStyle = cssColor("--text", "#000");
      ctx.lineWidth = 2;
      ctx.strokeRect(left + col * cellW + 1, top + (rows - 1 - r) * cellH + 1, cellW - 3, cellH - 3);
    }

    // Axis labels in the settings' units, thinned so they never overlap.
    ctx.fillStyle = cssColor("--chart-axis");
    const xLabels = grid.xValues.map((v) => formatAxisValue(sweep.x.field, v));
    const stride = labelStride(cellW, Math.max(...xLabels.map((l) => ctx.measureText(l).width)));
    ctx.textBaseline = "top";
    xLabels.forEach((l, col) => {
      if (col % stride === 0) ctx.fillText(l, left + col * cellW + cellW / 2, top + rows * cellH + 4);
    });
    ctx.fillText(axisTitle(sweep.x), left + (cols * cellW) / 2, top + rows * cellH + 22);
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    const yStride = Math.max(1, Math.ceil(13 / cellH));
    grid.yValues.forEach((v, r) => {
      if (r % yStride === 0) ctx.fillText(formatAxisValue(sweep.y.field, v), left - 6, top + (rows - 1 - r) * cellH + cellH / 2);
    });
    ctx.save();
    ctx.translate(10, top + (rows * cellH) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.fillText(axisTitle(sweep.y), 0, 0);
    ctx.restore();

    chartState(c, { cols, rows, filled, marked: [...marked].join(","), active, theme: effectiveTheme() });
    countDraw(c);
  }, [width, layout, theme, cells, marked, hover, picked, cols, rows, grid, sweep]);

  const pick = (e: { currentTarget: HTMLCanvasElement; clientX: number; clientY: number }) => {
    const r = e.currentTarget.getBoundingClientRect();
    return cellAt(layout, e.clientX - r.left, e.clientY - r.top);
  };
  const active = hover ?? picked;
  const activeText =
    active === null
      ? "Point at or tap a cell to see its P(bust) and 95% interval."
      : `${SWEEP_FIELD_LABELS[sweep.x.field]} ${formatAxisValue(sweep.x.field, grid.xValues[active % cols]!)}, ${SWEEP_FIELD_LABELS[sweep.y.field].toLowerCase()} ${formatAxisValue(sweep.y.field, grid.yValues[Math.floor(active / cols)]!)}: P(bust) ${cellText(cells[active] ?? null)}${cells[active] ? `, ${cells[active]!.nSessions.toLocaleString("en-US")} sessions` : ""}.`;

  return (
    <div className="sweep-heatmap">
      <div ref={box} className="canvas-box">
        <canvas
          ref={canvas}
          data-testid="sweep-canvas"
          role="img"
          aria-label={`Heatmap of P(bust): ${axisTitle(sweep.x)} across, ${axisTitle(sweep.y)} up. The same numbers are in the table below.`}
          onPointerMove={(e) => setHover(pick(e))}
          onPointerLeave={() => setHover(null)}
          onClick={(e) => setPicked(pick(e))}
        />
      </div>
      <p className="sweep-active mono" data-testid="sweep-active">
        {activeText}
      </p>
      <div className="sweep-legend" aria-hidden="true">
        <span>P(bust), the same scale for every sweep:</span>
        <span className="legend-bar-wrap">
          <span className="legend-bar" style={{ background: legendGradient() }} />
          <span className="legend-ticks">
            <span>0%</span>
            <span>25%</span>
            <span>50%</span>
            <span>75%</span>
            <span>100%</span>
          </span>
        </span>
        <span>
          <span className="legend-pending" /> not run yet
        </span>
        {(sweep.x.field === "startBankroll" || sweep.y.field === "startBankroll") && <span>● the readout's answer: from here up, every bankroll on its line meets the target</span>}
      </div>
      {children}
      <details className="sweep-table-details">
        <summary>Show the same numbers as a table</summary>
        <p className="help">
          P(bust) with its 95% interval: {axisTitle(sweep.y)} by row, {axisTitle(sweep.x)} by column.
        </p>
        <div className="table-wrap">
          <table className="results sweep-table" data-testid="sweep-table">
            <caption className="sr-only">
              P(bust) with its 95% interval: {axisTitle(sweep.y)} by row, {axisTitle(sweep.x)} by column.
            </caption>
            <thead>
              <tr>
                <th scope="col">{SWEEP_FIELD_LABELS[sweep.y.field]}</th>
                {grid.xValues.map((v, c) => (
                  <th scope="col" key={c}>
                    {formatAxisValue(sweep.x.field, v, true)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.yValues.map((v, r) => (
                <tr key={r}>
                  <th scope="row">{formatAxisValue(sweep.y.field, v, true)}</th>
                  {grid.xValues.map((_, c) => {
                    const cell = cells[r * cols + c] ?? null;
                    return (
                      <td key={c} data-cell={r * cols + c} data-raw={cell ? [cell.stats.pBust, cell.stats.pBustLow, cell.stats.pBustHigh].map(String).join("|") : ""}>
                        {cellText(cell)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
});
