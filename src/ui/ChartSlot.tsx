interface Props {
  title: string;
  /** What this chart will show once there are results. */
  description: string;
}

/** The empty chart area before the first run: what will appear here, and how to get it. */
export function ChartSlot({ title, description }: Props) {
  return (
    <section className="panel chart-slot">
      <h2>{title}</h2>
      <div className="chart-placeholder">
        <p>{description}</p>
        <p className="help">
          Press <strong>Run</strong> above to simulate: this chart appears here.
        </p>
      </div>
    </section>
  );
}
