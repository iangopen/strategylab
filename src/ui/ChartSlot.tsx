interface Props {
  title: string;
  description: string;
}

/** Reserved, empty panel. The charts session fills these in. */
export function ChartSlot({ title, description }: Props) {
  return (
    <section className="panel chart-slot">
      <h2>{title}</h2>
      <div className="chart-placeholder">
        <p>{description}</p>
        <p className="help">Chart coming in a later version.</p>
      </div>
    </section>
  );
}
