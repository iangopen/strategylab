// Thin Canvas 2D drawing layer. Components call these; all data shaping happens in adapters.ts.
import { useEffect, useRef, useState } from "react";
import { placeLabels, type Band, type Line, type Range } from "./adapters";

/** Reads a CSS custom property at draw time, so charts follow the current theme. */
export function cssColor(name: string, fallback = "#888"): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** Data-to-pixel mapping of a plot area in CSS pixels. Shared by drawing and click hit-testing. */
export interface Mapping {
  left: number;
  top: number;
  width: number;
  height: number;
  x: (v: number) => number;
  y: (v: number) => number;
}

export interface Frame extends Mapping {
  ctx: CanvasRenderingContext2D;
}

export const MARGIN = { left: 58, right: 22, top: 10, bottom: 24 };

export function plotMapping(cssWidth: number, cssHeight: number, xr: Range, yr: Range, yLog = false): Mapping {
  const left = MARGIN.left;
  const top = MARGIN.top;
  const width = Math.max(10, cssWidth - MARGIN.left - MARGIN.right);
  const height = Math.max(10, cssHeight - MARGIN.top - MARGIN.bottom);
  const xSpan = xr.max - xr.min || 1;
  const x = (v: number) => left + ((v - xr.min) / xSpan) * width;
  const y = yLog
    ? (v: number) => top + height - ((Math.log10(v) - Math.log10(yr.min)) / (Math.log10(yr.max) - Math.log10(yr.min) || 1)) * height
    : (v: number) => top + height - ((v - yr.min) / (yr.max - yr.min || 1)) * height;
  return { left, top, width, height, x, y };
}

/** Sizes the canvas for the device pixel ratio and returns a frame mapping data to pixels. */
export function prepareFrame(canvas: HTMLCanvasElement, cssWidth: number, cssHeight: number, xr: Range, yr: Range, yLog = false): Frame {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(cssWidth * dpr));
  canvas.height = Math.max(1, Math.round(cssHeight * dpr));
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);
  return { ctx, ...plotMapping(cssWidth, cssHeight, xr, yr, yLog) };
}

export function drawAxes(f: Frame, xTicks: number[], yTicks: number[], fmtX: (v: number) => string, fmtY: (v: number) => string): void {
  const { ctx } = f;
  ctx.save();
  ctx.font = "11px system-ui, sans-serif";
  ctx.lineWidth = 1;
  ctx.strokeStyle = cssColor("--chart-grid");
  ctx.fillStyle = cssColor("--chart-axis");
  ctx.textBaseline = "middle";
  ctx.textAlign = "right";
  for (const v of yTicks) {
    const py = Math.round(f.y(v)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(f.left, py);
    ctx.lineTo(f.left + f.width, py);
    ctx.stroke();
    ctx.fillText(fmtY(v), f.left - 6, py);
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (const v of xTicks) ctx.fillText(fmtX(v), f.x(v), f.top + f.height + 6);
  ctx.strokeStyle = cssColor("--chart-axis");
  ctx.beginPath();
  ctx.moveTo(f.left + 0.5, f.top);
  ctx.lineTo(f.left + 0.5, f.top + f.height);
  ctx.lineTo(f.left + f.width, f.top + f.height + 0.5);
  ctx.stroke();
  ctx.restore();
}

/** Clips subsequent drawing to the plot area; call the returned function to undo. */
export function clipToPlot(f: Frame): () => void {
  f.ctx.save();
  f.ctx.beginPath();
  f.ctx.rect(f.left, f.top, f.width, f.height);
  f.ctx.clip();
  return () => f.ctx.restore();
}

export function fillBand(f: Frame, b: Band, color: string, alpha: number): void {
  const { ctx } = f;
  const n = b.x.length;
  if (n === 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < n; i++) ctx.lineTo(f.x(b.x[i]!), f.y(b.hi[i]!));
  for (let i = n - 1; i >= 0; i--) ctx.lineTo(f.x(b.x[i]!), f.y(b.lo[i]!));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export function strokeLine(f: Frame, l: Line, color: string, width: number, alpha = 1): void {
  const { ctx } = f;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = "round";
  ctx.beginPath();
  for (let i = 0; i < l.x.length; i++) ctx.lineTo(f.x(l.x[i]!), f.y(l.y[i]!));
  ctx.stroke();
  ctx.restore();
}

/** Where a reference label was drawn (its knockout box), in CSS pixels. Exposed to tests via chartState. */
export interface LabelBox {
  label: string;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** A background knockout was painted behind the text, so it never sits directly on data. */
  knockout: boolean;
  /** Moved off its default spot to avoid another label or the plot edge. */
  moved: boolean;
}

const LABEL_FONT = "10px system-ui, sans-serif";
const LABEL_HEIGHT = 10;

/** Paints a knockout (the panel background, theme-aware) and then the label text on top of it. */
function knockoutText(ctx: CanvasRenderingContext2D, text: string, box: { x0: number; x1: number; y0: number; y1: number }, textX: number, textY: number, align: CanvasTextAlign, color: string): void {
  ctx.save();
  ctx.fillStyle = cssColor("--panel", "#fff");
  ctx.globalAlpha = 0.92;
  ctx.fillRect(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0);
  ctx.globalAlpha = 1;
  ctx.font = LABEL_FONT;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "bottom";
  ctx.fillText(text, textX, textY);
  ctx.restore();
}

export interface RefLine {
  value: number;
  label: string;
  align: "left" | "right";
}

/**
 * Horizontal reference lines (dashed) with their labels placed by placeLabels (never overlapping,
 * never leaving the plot) and drawn on a knockout, AFTER the data, so text never sits on paths.
 * Returns the drawn label boxes.
 */
export function drawRefLines(f: Frame, lines: readonly RefLine[], color: string): LabelBox[] {
  const { ctx } = f;
  const visible = lines.map((l) => ({ ...l, py: Math.round(f.y(l.value)) + 0.5 })).filter((l) => l.py >= f.top && l.py <= f.top + f.height);
  ctx.save();
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  for (const l of visible) {
    ctx.beginPath();
    ctx.moveTo(f.left, l.py);
    ctx.lineTo(f.left + f.width, l.py);
    ctx.stroke();
  }
  ctx.font = LABEL_FONT;
  const requests = visible.map((l) => ({ label: l.label, lineY: l.py, align: l.align, width: ctx.measureText(l.label).width, height: LABEL_HEIGHT }));
  ctx.restore();
  return placeLabels(requests, f).map((p, i) => {
    knockoutText(ctx, p.label, p, p.textX, p.textY, visible[i]!.align, color);
    return { label: p.label, x0: p.x0, x1: p.x1, y0: p.y0, y1: p.y1, knockout: true, moved: p.moved };
  });
}

/**
 * Test hook: charts write their state onto the canvas element as data-* attributes (ranges, counts,
 * zoom, hover, theme, draw count). Specs assert this state, never pixels. Plain DOM writes, so no
 * React re-render is involved.
 */
export function chartState(el: HTMLElement | null, state: Record<string, string | number | null | undefined>): void {
  if (!el) return;
  for (const [k, v] of Object.entries(state)) {
    if (v === null || v === undefined) delete el.dataset[k];
    else el.dataset[k] = String(v);
  }
}

/** Increments the canvas's data-draws counter (a redraw happened). */
export function countDraw(el: HTMLElement): void {
  el.dataset.draws = String(Number(el.dataset.draws ?? "0") + 1);
}

/** Dashed vertical marker line with a label (on a knockout) at the top. Returns the label box. */
export function refLineV(f: Frame, value: number, label: string, color: string): LabelBox | null {
  const { ctx } = f;
  const px = Math.round(f.x(value)) + 0.5;
  if (px < f.left || px > f.left + f.width) return null;
  ctx.save();
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.moveTo(px, f.top);
  ctx.lineTo(px, f.top + f.height);
  ctx.stroke();
  ctx.font = LABEL_FONT;
  const w = ctx.measureText(label).width;
  ctx.restore();
  const right = px > f.left + f.width - 60;
  const x0 = right ? px - 3 - w - 2 : px + 3 - 2;
  const box = { x0, x1: x0 + w + 4, y0: f.top + 1, y1: f.top + 1 + LABEL_HEIGHT + 4 };
  knockoutText(ctx, label, box, right ? box.x1 - 2 : box.x0 + 2, box.y1 - 2, right ? "right" : "left", color);
  return { label, ...box, knockout: true, moved: false };
}

/** Sizes an overlay canvas for the device pixel ratio, clears it, and returns its 2D context. */
export function overlayCtx(canvas: HTMLCanvasElement, cssWidth: number, cssHeight: number): CanvasRenderingContext2D {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(cssWidth * dpr));
  canvas.height = Math.max(1, Math.round(cssHeight * dpr));
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);
  return ctx;
}

/** Dashed vertical crosshair on an overlay at pixel x, from top to bottom. */
export function crosshairV(ctx: CanvasRenderingContext2D, px: number, top: number, bottom: number, color: string): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(Math.round(px) + 0.5, top);
  ctx.lineTo(Math.round(px) + 0.5, bottom);
  ctx.stroke();
  ctx.restore();
}

/** Width of the container element, tracked with a ResizeObserver (redraw on resize only). */
export function useContainerWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = Math.floor(entries[0]?.contentRect.width ?? 0);
      setWidth((prev) => (prev === w ? prev : w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}
