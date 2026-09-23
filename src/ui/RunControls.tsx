interface Props {
  running: boolean;
  canRun: boolean;
  progress: number;
  elapsedMs: number;
  status: string | null;
  onRun: () => void;
  onCancel: () => void;
}

export function RunControls({ running, canRun, progress, elapsedMs, status, onRun, onCancel }: Props) {
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
        <span className="mono">{(elapsedMs / 1000).toFixed(1)}s</span>
      </div>
      {status && <div className="status">{status}</div>}
      {!canRun && !running && <div className="error">Fix the highlighted fields to run.</div>}
    </section>
  );
}
