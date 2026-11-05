import type { Cell, Change } from "./gateway";
import type { ResultSet } from "./results";

/** The row of a card marked for deletion, with the columns it was read in. */
export interface RowToDelete {
  schema: string;
  table: string;
  columns: string[];
  row: Cell[];
}

/** Deletes for rows of one table, each found by its primary key. A table without one, or a row read without all of it, cannot be deleted from, since the row could not be told from another. */
export function deleteChanges(rows: RowToDelete[], primaryKey: string[]): Change[] {
  if (rows.length === 0) return [];
  const { schema, table } = rows[0];
  if (primaryKey.length === 0) throw new Error(`${schema}.${table} has no primary key, so its rows cannot be deleted`);
  return rows.map(({ columns, row }) => {
    if (primaryKey.some((name) => !columns.includes(name))) throw new Error(`${schema}.${table} was read without its primary key (${primaryKey.join(", ")}), so its rows cannot be deleted`);
    return { kind: "delete", key: Object.fromEntries(primaryKey.map((name) => [name, row[columns.indexOf(name)]])) };
  });
}

/** The result without the rows that were deleted, told apart by their values. The rows left are the same ones, so what holds them still knows them. */
export function withoutRows(result: ResultSet, gone: Cell[][]): ResultSet {
  const away = new Set(gone.map((row) => JSON.stringify(row)));
  const rows = result.rows.filter((row) => !away.has(JSON.stringify(row)));
  return rows.length === result.rows.length ? result : { ...result, rows };
}
