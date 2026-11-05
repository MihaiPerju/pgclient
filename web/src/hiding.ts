import { selectedRows, type Selection } from "./selection";

/** The rows and columns of a result kept out of view, by their place in the result. They are still there: only not drawn, nor picked, nor copied. */
export interface Hidden {
  rows: ReadonlySet<number>;
  columns: ReadonlySet<number>;
}

export const nothingHidden: Hidden = { rows: new Set(), columns: new Set() };

/** Rows and columns can be hidden; a block of cells is neither. */
export const canHide = (selection: Selection) => selection.kind === "rows" || selection.kind === "columns";

/** Takes the picked rows, or the picked columns, out of view, as well as what already was. */
export function hideSelected(hidden: Hidden, selection: Selection, rowCount: number): Hidden {
  if (selection.kind === "rows") return { ...hidden, rows: new Set([...hidden.rows, ...selectedRows(selection, rowCount, hidden)]) };
  if (selection.kind === "columns") return { ...hidden, columns: new Set([...hidden.columns, ...selection.columns]) };
  return hidden;
}

/** The lines still in view, in order. */
export const inView = (count: number, away: ReadonlySet<number>) => Array.from({ length: count }, (_, at) => at).filter((at) => !away.has(at));

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** What is hidden, in a few words, such as "2 rows · 1 column hidden", or null when nothing is. */
export function hiddenSummary(hidden: Hidden): string | null {
  const parts = [hidden.rows.size > 0 && plural(hidden.rows.size, "row"), hidden.columns.size > 0 && plural(hidden.columns.size, "column")].filter(Boolean);
  return parts.length === 0 ? null : `${parts.join(" · ")} hidden`;
}
