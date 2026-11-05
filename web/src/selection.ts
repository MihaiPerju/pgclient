import type { Cell } from "./gateway";
import type { Hidden } from "./hiding";

// What is hidden is never part of a selection: not counted, copied, deleted nor followed. Nothing is hidden unless said.
const NONE_HIDDEN: Hidden = { rows: new Set(), columns: new Set() };

export interface Position {
  row: number;
  column: number;
}

/** Rows, columns or a block of cells, never more than one kind at once, as in pgAdmin. `all` stands for every row without
 * listing a million of them. A block runs from where a drag began to where it is now, and one cell is a block of one. */
export type Selection =
  | { kind: "none" }
  | { kind: "cells"; anchor: Position; head: Position }
  | { kind: "rows"; rows: ReadonlySet<number>; all: boolean; anchor: number | null }
  | { kind: "columns"; columns: ReadonlySet<number>; anchor: number | null };

export const none: Selection = { kind: "none" };

export interface Modifiers {
  /** Command or control: add to what is selected, or take away from it. */
  toggle: boolean;
  /** Shift: everything from the last click to this one. */
  range: boolean;
}

const between = (a: number, b: number) => {
  const [low, high] = a < b ? [a, b] : [b, a];
  return new Set(Array.from({ length: high - low + 1 }, (_, i) => low + i));
};

function toggled(set: Set<number>, value: number): Set<number> {
  const next = new Set(set);
  if (!next.delete(value)) next.add(value);
  return next;
}

const rowsSelection = (rows: Set<number>, anchor: number): Selection => (rows.size === 0 ? none : { kind: "rows", rows, all: false, anchor });
const columnsSelection = (columns: Set<number>, anchor: number): Selection => (columns.size === 0 ? none : { kind: "columns", columns, anchor });

/** A click adds the row to the rows picked, or takes it off if it was picked. Only shift-click replaces them, with the range from the last click. */
export function clickRow(selection: Selection, row: number, modifiers: Modifiers, rowCount: number): Selection {
  const anchor = selection.kind === "rows" && selection.anchor !== null ? selection.anchor : row;
  if (modifiers.range) return rowsSelection(between(anchor, row), anchor);
  const current = selection.kind !== "rows" ? new Set<number>() : selection.all ? between(0, rowCount - 1) : new Set(selection.rows);
  return rowsSelection(toggled(current, row), row);
}

export function clickColumn(selection: Selection, column: number, modifiers: Modifiers): Selection {
  const anchor = selection.kind === "columns" && selection.anchor !== null ? selection.anchor : column;
  if (modifiers.range) return columnsSelection(between(anchor, column), anchor);
  if (modifiers.toggle) {
    const current = selection.kind === "columns" ? new Set(selection.columns) : new Set<number>();
    return columnsSelection(toggled(current, column), column);
  }
  if (selection.kind === "columns" && selection.columns.size === 1 && selection.columns.has(column)) return none;
  return columnsSelection(new Set([column]), column);
}

export const cellsFrom = (row: number, column: number): Selection => ({ kind: "cells", anchor: { row, column }, head: { row, column } });

/** The block now runs from where it began to this cell. A drag that begins with nothing selected begins at this cell. */
export function dragTo(selection: Selection, row: number, column: number): Selection {
  return selection.kind === "cells" ? { ...selection, head: { row, column } } : cellsFrom(row, column);
}

const isOneCell = (selection: Selection) => selection.kind === "cells" && selection.anchor.row === selection.head.row && selection.anchor.column === selection.head.column;

/** What a press on a cell comes to once the button is up. A click that went nowhere on the one cell that was selected lets it go,
 * which is how a second click cancels, and a drag that began on it does not. */
export function released(before: Selection, now: Selection): Selection {
  const same = before.kind === "cells" && now.kind === "cells" && isOneCell(before) && isOneCell(now) && before.anchor.row === now.anchor.row && before.anchor.column === now.anchor.column;
  return same ? none : now;
}

export const clickCell = (selection: Selection, row: number, column: number): Selection => released(selection, cellsFrom(row, column));

const block = (selection: Selection) =>
  selection.kind === "cells"
    ? { top: Math.min(selection.anchor.row, selection.head.row), bottom: Math.max(selection.anchor.row, selection.head.row), left: Math.min(selection.anchor.column, selection.head.column), right: Math.max(selection.anchor.column, selection.head.column) }
    : null;

/** The cell at the top of the row numbers stands for every row: one click selects them all, and the next lets go. */
export function clickCorner(selection: Selection): Selection {
  if (selection.kind === "rows" && selection.all) return none;
  return { kind: "rows", rows: new Set(), all: true, anchor: null };
}

export const isRowSelected = (selection: Selection, row: number) => selection.kind === "rows" && (selection.all || selection.rows.has(row));
export function isCellSelected(selection: Selection, row: number, column: number): boolean {
  const area = block(selection);
  return area !== null && row >= area.top && row <= area.bottom && column >= area.left && column <= area.right;
}

export function cellCount(selection: Selection, hidden: Hidden = NONE_HIDDEN): number {
  return selectedCells(selection, hidden).length;
}

/** Which sides of a cell are on the outer edge of the block, so only that edge is outlined and the block reads as one. */
export function cellEdges(selection: Selection, row: number, column: number): { top: boolean; bottom: boolean; left: boolean; right: boolean } | null {
  const area = block(selection);
  if (area === null || !isCellSelected(selection, row, column)) return null;
  return { top: row === area.top, bottom: row === area.bottom, left: column === area.left, right: column === area.right };
}
export const isColumnSelected = (selection: Selection, column: number) => selection.kind === "columns" && selection.columns.has(column);

export function status(selection: Selection, rowCount: number, hidden: Hidden = NONE_HIDDEN): string {
  if (selection.kind === "cells") {
    const count = cellCount(selection, hidden);
    return count === 1 ? "Cell selected" : `Cells selected: ${count}`;
  }
  if (selection.kind === "rows") return `Rows selected: ${selectedRows(selection, rowCount, hidden).length}`;
  if (selection.kind === "columns") return `Columns selected: ${[...selection.columns].filter((column) => !hidden.columns.has(column)).length}`;
  return "";
}

/** A value with a tab, a line break or a quote in it is quoted, so a spreadsheet pastes it into one cell and not several. */
function field(cell: Cell): string {
  if (cell === null) return "";
  return /[\t\n\r"]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell;
}

const sorted = (set: ReadonlySet<number>) => [...set].sort((a, b) => a - b);
const span = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, at) => from + at);

/** What the selection looks like as text, tab-separated, ready to paste into a spreadsheet or an editor. */
export function toTsv(result: { columns: string[]; rows: Cell[][] }, selection: Selection, withHeaders: boolean, hidden: Hidden = NONE_HIDDEN): string {
  if (selection.kind === "none") return "";
  if (selection.kind === "cells") {
    if (isOneCell(selection)) {
      const { row, column } = selection.anchor;
      const value = result.rows[row]?.[column] ?? null;
      // Alone, a value is copied as it is, so pasting it into an editor gives what was seen. With a header it has to be a table again.
      return withHeaders ? `${field(result.columns[column])}\n${field(value)}` : (value ?? "");
    }
    const area = block(selection)!;
    const columns = span(area.left, area.right).filter((column) => !hidden.columns.has(column));
    const lines = span(area.top, area.bottom)
      .filter((row) => !hidden.rows.has(row))
      .map((row) => columns.map((column) => field(result.rows[row]?.[column] ?? null)).join("\t"));
    if (withHeaders) lines.unshift(columns.map((column) => field(result.columns[column])).join("\t"));
    return lines.join("\n");
  }
  const everyRow = result.rows.map((_, index) => index);
  const everyColumn = result.columns.map((_, index) => index);
  const rows = (selection.kind === "rows" ? (selection.all ? everyRow : sorted(selection.rows)) : everyRow).filter((row) => !hidden.rows.has(row));
  const columns = (selection.kind === "columns" ? sorted(selection.columns) : everyColumn).filter((column) => !hidden.columns.has(column));
  const lines = rows.map((row) => columns.map((column) => field(result.rows[row][column] ?? null)).join("\t"));
  if (withHeaders) lines.unshift(columns.map((column) => field(result.columns[column])).join("\t"));
  return lines.join("\n");
}

/** The rows picked by their numbers, in order. Cells and columns are not rows. */
export function selectedRows(selection: Selection, rowCount: number, hidden: Hidden = NONE_HIDDEN): number[] {
  if (selection.kind !== "rows") return [];
  return (selection.all ? Array.from({ length: rowCount }, (_, row) => row) : sorted(selection.rows)).filter((row) => !hidden.rows.has(row));
}

/** The rows and the columns a selection picks, each null when it picks none in particular: a block picks both, rows only rows, columns only columns. */
export function projection(selection: Selection, rowCount: number, hidden: Hidden = NONE_HIDDEN): { rows: number[] | null; columns: number[] | null } {
  const area = block(selection);
  const shownRows = (rows: number[]) => rows.filter((row) => !hidden.rows.has(row));
  const shownColumns = (columns: number[]) => columns.filter((column) => !hidden.columns.has(column));
  if (area) return { rows: shownRows(span(area.top, area.bottom)), columns: shownColumns(span(area.left, area.right)) };
  if (selection.kind === "rows") return { rows: selectedRows(selection, rowCount, hidden), columns: null };
  if (selection.kind === "columns") return { rows: null, columns: shownColumns(sorted(selection.columns)) };
  return { rows: null, columns: null };
}

/** Every cell of the block, row by row. Rows and columns are not cells. */
export function selectedCells(selection: Selection, hidden: Hidden = NONE_HIDDEN): { row: number; column: number }[] {
  const area = block(selection);
  if (area === null) return [];
  const cells = [];
  for (let row = area.top; row <= area.bottom; row++) {
    if (hidden.rows.has(row)) continue;
    for (let column = area.left; column <= area.right; column++) if (!hidden.columns.has(column)) cells.push({ row, column });
  }
  return cells;
}
