import type { Cell, Change, ResultSource } from "./gateway";
import type { ResultSet } from "./results";

type Editable = Extract<ResultSource, { state: "editable" }>;

/** What was marked for deletion and what was edited since the rows were read, none of it written yet. */
export interface Pending {
  deleted: ReadonlySet<number>;
  /** The new value of each edited cell, by row and then column. */
  edited: ReadonlyMap<number, ReadonlyMap<number, Cell>>;
  /** Rows to add, each with a value for every column of the result, in the order the result has them. They are shown below the rows that were read. */
  added: readonly Cell[][];
}

export const nothingPending: Pending = { deleted: new Set(), edited: new Map(), added: [] };

export const editedCount = (pending: Pending) => [...pending.edited].reduce((sum, [row, cells]) => sum + (pending.deleted.has(row) ? 0 : cells.size), 0);
export const isPending = (pending: Pending) => pending.deleted.size > 0 || editedCount(pending) > 0 || pending.added.length > 0;

export const editableSource = (result: ResultSet): Editable | null => (result.source?.state === "editable" ? result.source : null);

/** Marks the rows for deletion, or lets them go again if every one of them was marked already. */
export function toggleDeleted(pending: Pending, rows: number[]): Pending {
  const deleted = new Set(pending.deleted);
  if (rows.every((row) => deleted.has(row))) rows.forEach((row) => deleted.delete(row));
  else rows.forEach((row) => deleted.add(row));
  return { ...pending, deleted };
}

/** Sets a cell to a new value, or forgets the edit if it is the value it had. */
export function edit(pending: Pending, row: number, column: number, value: Cell, original: Cell): Pending {
  const edited = new Map(pending.edited);
  const cells = new Map(edited.get(row));
  if (value === original) cells.delete(column);
  else cells.set(column, value);
  if (cells.size === 0) edited.delete(row);
  else edited.set(row, cells);
  return { ...pending, edited };
}

export const shown = (result: ResultSet, pending: Pending, row: number, column: number): Cell => {
  // A row past the ones that were read is one that is waiting to be added.
  if (row >= result.rows.length) return pending.added[row - result.rows.length]?.[column] ?? null;
  const cells = pending.edited.get(row);
  return cells?.has(column) ? cells.get(column)! : result.rows[row][column];
};

/** The value a cell had before anything was changed: what was read for a row that was read, and for a new one, what it was pasted as, which is what it is until it is changed. */
export const originalOf = (result: ResultSet, row: number, column: number): Cell => (row < result.rows.length ? result.rows[row][column] : null);

/** Sets a cell of any row: an edit of a row that was read, which can be undone by setting it back, or a change to a row that is to be added. */
export function setCell(pending: Pending, result: ResultSet, row: number, column: number, value: Cell): Pending {
  return row >= result.rows.length ? editAdded(pending, row - result.rows.length, column, value) : edit(pending, row, column, value, result.rows[row][column]);
}

function keyOf(source: Editable, result: ResultSet, row: number): Record<string, Cell> {
  const key: Record<string, Cell> = {};
  source.columns.forEach((column, index) => {
    if (column !== null && source.key.includes(column.name)) key[column.name] = result.rows[row][index];
  });
  return key;
}

/** What to tell the database: a row marked for deletion is deleted, and one that is only edited has its edited columns set. Each is found by the key it was read with. */
export function buildChanges(result: ResultSet, source: Editable, pending: Pending): Change[] {
  const changes: Change[] = [];
  for (let row = 0; row < result.rows.length; row++) {
    if (pending.deleted.has(row)) {
      changes.push({ kind: "delete", key: keyOf(source, result, row) });
      continue;
    }
    const cells = pending.edited.get(row);
    if (!cells) continue;
    const set: Record<string, Cell> = {};
    for (const [column, value] of cells) {
      const name = source.columns[column]?.name;
      if (name !== undefined) set[name] = value;
    }
    if (Object.keys(set).length > 0) changes.push({ kind: "update", key: keyOf(source, result, row), set });
  }
  for (const cells of pending.added) {
    const values: Record<string, Cell> = {};
    source.columns.forEach((column, index) => {
      if (column === null) return;
      // A column the database fills in is left out when it was left empty, so it gets its default and not an explicit NULL.
      if (column.has_default && cells[index] === null) return;
      values[column.name] = cells[index];
    });
    changes.push({ kind: "insert", values });
  }
  return changes;
}

/** The rows as they are once the changes are written: the deleted ones gone and the edited cells holding their new values. */
export function applied(result: ResultSet, pending: Pending): ResultSet {
  const rows = result.rows.flatMap((row, index) => {
    if (pending.deleted.has(index)) return [];
    const cells = pending.edited.get(index);
    return [cells ? row.map((value, column) => (cells.has(column) ? cells.get(column)! : value)) : row];
  });
  return { ...result, rows };
}

/** What a pasted cell is for each column of the result: the cells of a pasted row go to the columns in order, however many there are. A row with fewer cells than the result has columns leaves the rest empty, and one with more has the extra cells left off. */
function fitRow(cells: Cell[], width: number): Cell[] {
  return Array.from({ length: width }, (_, column) => cells[column] ?? null);
}

/** Rows to add, from rows pasted. A column the database fills in by itself, such as a serial id, is left empty, so the new row gets its own and does not collide with the row it was copied from. */
export function addRows(pending: Pending, source: Editable, pasted: Cell[][]): Pending {
  const width = source.columns.length;
  const fresh = pasted.map((cells) => fitRow(cells, width).map((value, column) => (source.columns[column]?.has_default && source.key.includes(source.columns[column]!.name) ? null : value)));
  return { ...pending, added: [...pending.added, ...fresh] };
}

/** Sets a cell of a row that is to be added, which may be done as many times as wanted before it is saved. */
export function editAdded(pending: Pending, row: number, column: number, value: Cell): Pending {
  return { ...pending, added: pending.added.map((cells, index) => (index === row ? cells.map((was, at) => (at === column ? value : was)) : cells)) };
}

/** Takes rows that were to be added off the list, by their place in it. */
export function dropAdded(pending: Pending, rows: number[]): Pending {
  return { ...pending, added: pending.added.filter((_, index) => !rows.includes(index)) };
}
