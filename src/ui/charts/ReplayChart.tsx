import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { Replay } from "../../engine/replay";
import { formatStat } from "../format";
import { useThemeVersion } from "../theme";
import {
  countTick,
  endText,
  firstEndingRound,
  moneyTick,
  nearestIndex,
  niceTicks,
  referenceLines,
  replayLayout,
  seriesColorVar,
  stripCells,
  zoomFromDrag,
  type ChartRefs,
  type Line,
  type Range,
} from "./adapters";
import { clipToPlot, crosshairV, cssColor, drawAxes, MARGIN, overlayCtx, prepareFrame, refLineH, strokeLine, useContainerWidth, type Frame } from "./canvas";

interface Props {
  nSessions: number;
  labels: readonly string[];
  refs: ChartRefs;
  replay: Replay | null;
  status: string | null;
  disabled: boolean;
  onReplay: (session: number) => void;
}

/**
 * Same-luck replay: one session re-simulated for every strategy, stacked on ONE shared x axis:
 * bankroll lines, bet sizes, and a single win/loss strip (identical for all strategies by CRN).
 */
export const ReplayChart = memo(function ReplayChart({ nSessions, labels, refs, replay, status, disabled, onReplay }: Props) {
  // Editing draft for the session number (view state, not scenario state).
  const [draft, setDraft] = useState("");
  const parsed = Number(draft);
  const valid = draft.trim() !== "" && Number.isInteger(parsed) && parsed >= 0 && parsed < nSessions;
  const layout = useMemo(() => (replay ? replayLayout(replay, refs) : null), [replay, refs]);

  return (
    <section className="panel chart-section">
      <h2>Replay one session</h2>
      <form
        className="chart-tools"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onReplay(parsed);
        }}
      >
        <p className="help">Every strategy faced exactly the same wins and losses in each session. Replay one to watch that luck play out differently.</p>
        <label className="theme-control">
          Session
          <input type="text" inputMode="numeric" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={`0–${nSessions - 1}`} style={{ width: "8ch" }} aria-invalid={draft !== "" && !valid} />
        </label>
        <button type="submit" disabled={disabled || !valid}>
          Replay
        </button>
      </form>
      {draft !== "" && !valid && <div className="error">Enter a whole number from 0 to {nSessions - 1}.</div>}
      {status && <div className="status">{status}</div>}
      {!replay && !status && <p className="help">Pick a session number, or click a thin line in the bankroll chart above.</p>}
      {replay && layout && (
        <>
          <ul className="replay-legend">
            {replay.strategies.map((s, k) => (
              <li key={k}>
                <span className="swatch" style={{ background: `var(${seriesColorVar(k)})` }} aria-hidden="true" />
                <strong>{labels[k] ?? s.strategyId}</strong>: {endText(s.endReason, s.rounds)}, final bankroll {formatStat("money", s.finalBankroll)}
              </li>
            ))}
          </ul>
          <ReplayCanvases key={replay.session} replay={replay} layout={layout} refs={refs} labels={labels} />
          <p className="help">
            Session {replay.session.toLocaleString("en-US")}
            {replay.downsampled ? ": long session, lines are min/max downsampled and the strip shows the win rate per block of rounds." : "."}
          </p>
        </>
      )}
    </section>
  );
});

interface CanvasProps {
  replay: Replay;
  layout: ReturnType<typeof replayLayout>;
  refs: ChartRefs;
  labels: readonly string[];
}

const BANK_H = 220;
const BET_H = 150;
const STRIP_H = 64;

interface ReplayHover {
  round: number;
  rows: { bankroll: number; bet: number | null }[];
}

const ReplayCanvases = memo(function ReplayCanvases({ replay, layout, refs, labels }: CanvasProps) {
  const [box, width] = useContainerWidth<HTMLDivElement>();
  const bank = useRef<HTMLCanvasElement | null>(null);
  const bets = useRef<HTMLCanvasElement | null>(null);
  const strip = useRef<HTMLCanvasElement | null>(null);
  const overlay = useRef<HTMLCanvasElement | null>(null);
  const theme = useThemeVersion();
  // Zoom is a view-only x-window over the shared range; null = full. The parent keys this component
  // by session, so a new replay remounts it with zoom reset.
  const [zoom, setZoom] = useState<Range | null>(null);
  const x: Range = zoom ?? layout.x;
  const drag = useRef<number | null>(null); // drag start, in data-x
  const [hover, setHover] = useState<ReplayHover | null>(null);

  useEffect(() => {
    if (width === 0 || !bank.current || !bets.current || !strip.current) return;
    const xTicks = niceTicks(x.min, x.max, 6);

    const drawLines = (f: Frame, lines: Line[]) => {
      const unclip = clipToPlot(f);
      lines.forEach((l, k) => strokeLine(f, l, cssColor(seriesColorVar(k)), 2, 0.9));
      unclip();
    };

    // 1. Bankroll, one line per strategy, with end markers.
    const fb = prepareFrame(bank.current, width, BANK_H, x, layout.bankrollY);
    drawAxes(fb, xTicks, niceTicks(0, layout.bankrollY.max, 4), countTick, moneyTick);
    for (const r of referenceLines(refs)) refLineH(fb, r.value, r.label, cssColor("--chart-ref"), r.kind === "start" ? "left" : "right");
    drawLines(fb, layout.bankroll);
    layout.bankroll.forEach((l, k) => {
      const n = l.x.length;
      if (n === 0) return;
      fb.ctx.fillStyle = cssColor(seriesColorVar(k));
      fb.ctx.beginPath();
      fb.ctx.arc(fb.x(l.x[n - 1]!), fb.y(l.y[n - 1]!), 3.5, 0, Math.PI * 2);
      fb.ctx.fill();
    });

    // 2. Bet size per strategy (same x).
    const fbet = prepareFrame(bets.current, width, BET_H, x, layout.betY);
    drawAxes(fbet, xTicks, niceTicks(0, layout.betY.max, 3), countTick, moneyTick);
    drawLines(fbet, layout.bets);

    // 3. ONE win/loss strip (identical for every strategy), spanning the longest strategy.
    const fs = prepareFrame(strip.current, width, STRIP_H, x, { min: 0, max: 1 });
    drawAxes(fs, xTicks, [], countTick, () => "");
    const unclipStrip = clipToPlot(fs);
    const win = cssColor("--chart-win");
    const loss = cssColor("--chart-loss");
    const bottom = fs.top + fs.height;
    for (const c of stripCells(replay)) {
      const x0 = fs.x(c.x0);
      const w = Math.max(0.5, fs.x(c.x1) - x0);
      if (replay.strip.kind === "rounds") {
        const h = c.winRate === 1 ? fs.height : fs.height * 0.35;
        fs.ctx.fillStyle = c.winRate === 1 ? win : loss;
        fs.ctx.fillRect(x0, bottom - h, w, h);
      } else {
        fs.ctx.fillStyle = loss;
        fs.ctx.fillRect(x0, fs.top, w, fs.height);
        fs.ctx.fillStyle = win;
        fs.ctx.fillRect(x0, bottom - fs.height * c.winRate, w, fs.height * c.winRate);
      }
    }
    unclipStrip();
  }, [width, theme, replay, layout, refs, x]);

  // --- Drag-select to zoom the x axis (bankroll canvas). Selection is drawn on an overlay canvas,
  //     so the charts are not re-rendered while dragging. Double-click resets.
  const plotWidth = Math.max(10, width - MARGIN.left - MARGIN.right);
  const dataXFromEvent = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const t = (e.clientX - rect.left - MARGIN.left) / plotWidth;
    return x.min + t * (x.max - x.min);
  };
  const toPx = (d: number) => MARGIN.left + ((d - x.min) / (x.max - x.min || 1)) * plotWidth;
  const clearOverlay = () => {
    if (overlay.current) overlayCtx(overlay.current, width, BANK_H);
  };
  const drawSelection = (a: number, b: number) => {
    if (!overlay.current) return;
    const ctx = overlayCtx(overlay.current, width, BANK_H);
    ctx.fillStyle = "rgba(120,140,170,0.28)";
    ctx.fillRect(Math.min(toPx(a), toPx(b)), MARGIN.top, Math.abs(toPx(b) - toPx(a)), BANK_H - MARGIN.top - MARGIN.bottom);
  };
  // Hover: snap to the nearest recorded round, read each strategy's bankroll and bet there, and draw
  // a crosshair on the overlay. The stacked charts are never redrawn on hover — only the overlay and
  // the text readout below update.
  const onHover = (round: number) => {
    const rows = replay.strategies.map((s) => ({
      bankroll: s.bankroll.bankroll[nearestIndex(s.bankroll.rounds, round)] ?? s.finalBankroll,
      bet: s.bets.rounds.length ? s.bets.bankroll[nearestIndex(s.bets.rounds, round)] ?? null : null,
    }));
    setHover({ round: Math.round(round), rows });
    if (overlay.current) crosshairV(overlayCtx(overlay.current, width, BANK_H), toPx(round), MARGIN.top, BANK_H - MARGIN.bottom, cssColor("--chart-axis"));
  };
  const clearHover = () => {
    setHover(null);
    if (drag.current === null) clearOverlay();
  };

  return (
    <div ref={box} className="canvas-box replay-stack">
      <div className="replay-row-label">Bankroll — drag across to zoom, double-click to reset</div>
      <div style={{ position: "relative" }}>
        <canvas
          ref={bank}
          role="img"
          aria-label="Bankroll of each strategy in the replayed session"
          style={{ cursor: "ew-resize", touchAction: "none" }}
          onPointerDown={(e) => {
            drag.current = dataXFromEvent(e);
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const d = dataXFromEvent(e);
            if (drag.current !== null) drawSelection(drag.current, d);
            else onHover(Math.max(x.min, Math.min(x.max, d)));
          }}
          onPointerUp={(e) => {
            if (drag.current === null) return;
            const z = zoomFromDrag(drag.current, dataXFromEvent(e), layout.x);
            drag.current = null;
            clearOverlay();
            if (z) setZoom(z);
          }}
          onPointerCancel={() => {
            drag.current = null;
            clearOverlay();
          }}
          onPointerLeave={clearHover}
          onDoubleClick={() => setZoom(null)}
        />
        <canvas ref={overlay} aria-hidden="true" style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none" }} />
      </div>
      <div className="chart-readout">
        {hover ? (
          <>
            Round {hover.round.toLocaleString("en-US")}:
            {hover.rows.map((r, k) => (
              <span key={k}>
                <span className="swatch" style={{ background: `var(${seriesColorVar(k)})` }} aria-hidden="true" />
                {labels[k] ?? replay.strategies[k]!.strategyId} {formatStat("money", r.bankroll)}
                {r.bet !== null && ` (bet ${formatStat("money", r.bet)})`}
              </span>
            ))}
          </>
        ) : (
          "Hover the bankroll chart for each strategy's bankroll and bet at a round."
        )}
      </div>
      <div className="chart-tools" style={{ marginTop: 4 }}>
        <button type="button" onClick={() => setZoom({ min: 0, max: firstEndingRound(replay) })}>
          Fit to first ending
        </button>
        <button type="button" onClick={() => setZoom(null)} disabled={zoom === null}>
          Reset zoom
        </button>
        {zoom && (
          <span className="help">
            Showing rounds {Math.round(zoom.min).toLocaleString("en-US")}–{Math.round(zoom.max).toLocaleString("en-US")}.
          </span>
        )}
      </div>
      <div className="replay-row-label">Bet size</div>
      <canvas ref={bets} role="img" aria-label="Bet placed by each strategy in each round" style={{ cursor: "default" }} />
      <div className="replay-row-label">
        {replay.strip.kind === "rounds"
          ? "Each round: tall bar = won, short bar = lost. The same for every strategy."
          : "Each block of rounds: bar height = share of rounds won. The same for every strategy."}
      </div>
      <canvas ref={strip} role="img" aria-label="Win or loss of each round, shared by every strategy" style={{ cursor: "default" }} />
    </div>
  );
});
