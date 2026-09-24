import { formatElapsed } from "./format";

/** Outcome of the last "Copy link" click. View state, not scenario state. */
export type CopyStatus =
  | { kind: "copied"; urlLength: number; leftOut: string[] }
  | { kind: "manual"; url: string; leftOut: string[] }
  | { kind: "error"; message: string };

interface Props {
  running: boolean;
  canRun: boolean;
  progress: number;
  /** null before the first run. */
  elapsedMs: number | null;
  status: string | null;
  onRun: () => void;
  onCancel: () => void;
  /** Why Copy link is unavailable right now, or null. */
  copyBlocker: string | null;
  copyStatus: CopyStatus | null;
  onCopyLink: () => void;
}

export function RunControls({ running, canRun, progress, elapsedMs, status, onRun, onCancel, copyBlocker, copyStatus, onCopyLink }: Props) {
  return (
    <section className="panel run-controls">
      <div className="run-row">
        <button type="button" className="primary" disabled={running || !canRun} onClick={onRun}>
          Run
        </button>
        <button type="button" disabled={!running} onClick={onCancel}>
          Cancel
        </button>
        <progress max={1} value={progress} aria-label="Simulation progress" />
        <span className="mono">{Math.round(progress * 100)}%</span>
        <span className="mono" data-testid="elapsed">{elapsedMs === null ? "—" : formatElapsed(elapsedMs)}</span>
        {/* Disabled buttons don't show tooltips in every browser, so the wrapper carries it too. */}
        <span className="copy-link" title={copyBlocker ?? "Copy a link to this scenario. Opening it restores these settings and strategies."}>
          <button type="button" disabled={copyBlocker !== null} onClick={onCopyLink} aria-describedby={copyBlocker ? "copy-link-why" : undefined}>
            Copy link
          </button>
        </span>
      </div>
      {status && (
        <div className="status" data-testid="run-status">
          {status}
        </div>
      )}
      {!canRun && !running && <div className="error">Fix the highlighted fields to run.</div>}
      {copyBlocker && (
        <div id="copy-link-why" className="help">
          Copy link: {copyBlocker}
        </div>
      )}
      {copyStatus && <CopyMessage status={copyStatus} />}
    </section>
  );
}

function CopyMessage({ status }: { status: CopyStatus }) {
  if (status.kind === "error") {
    return (
      <div className="error" role="alert">
        {status.message}
      </div>
    );
  }
  const leftOut = status.leftOut.length > 0 && (
    <div className="error">
      Left out of the link because {status.leftOut.length === 1 ? "it has" : "they have"} errors: {status.leftOut.join(", ")}.
    </div>
  );
  if (status.kind === "manual") {
    return (
      <div className="status" role="status">
        Couldn’t copy automatically. Select the link and copy it:
        <input type="text" readOnly value={status.url} onFocus={(e) => e.currentTarget.select()} aria-label="Scenario link" />
        {leftOut}
      </div>
    );
  }
  return (
    <div className="status" role="status">
      Link copied ({status.urlLength.toLocaleString("en-US")} characters). The address bar now shows it too, so reloading keeps this scenario.
      {leftOut}
    </div>
  );
}
