// Thin Canvas 2D drawing layer. Components call these; all data shaping happens in adapters.ts.
import { useEffect, useRef, useState } from "react";
import type { Band, Line, Range } from "./adapters";

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

/** Dashed horizontal reference line with a small label above it, at the left or right end. */
export function refLineH(f: Frame, value: number, label: string, color: string, align: "left" | "right" = "right"): void {
  const { ctx } = f;
  const py = Math.round(f.y(value)) + 0.5;
  if (py < f.top || py > f.top + f.height) return;
  ctx.save();
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(f.left, py);
  ctx.lineTo(f.left + f.width, py);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = "10px system-ui, sans-serif";
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "bottom";
  ctx.fillText(label, align === "right" ? f.left + f.width - 2 : f.left + 4, py - 2);
  ctx.restore();
}

/** Dashed vertical marker line with a label at the top. */
export function refLineV(f: Frame, value: number, label: string, color: string): void {
  const { ctx } = f;
  const px = Math.round(f.x(value)) + 0.5;
  if (px < f.left || px > f.left + f.width) return;
  ctx.save();
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.moveTo(px, f.top);
  ctx.lineTo(px, f.top + f.height);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = "10px system-ui, sans-serif";
  ctx.fillStyle = color;
  ctx.textAlign = px > f.left + f.width - 60 ? "right" : "left";
  ctx.textBaseline = "top";
  ctx.fillText(label, px + (ctx.textAlign === "left" ? 3 : -3), f.top + 2);
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
