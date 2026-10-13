// Report chart layout (pure): how the fan panels share one printed page.

/** Columns and panel height so that up to 8 panels take at most two rows of a printed page. */
export function reportChartLayout(panels: number): { columns: number; height: number } {
  const columns = panels <= 3 ? Math.max(1, panels) : panels === 4 ? 2 : panels <= 6 ? 3 : 4;
  const rows = Math.ceil(panels / columns);
  return { columns, height: rows <= 1 ? 165 : 92 };
}
