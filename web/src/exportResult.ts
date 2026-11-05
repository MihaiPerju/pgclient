import type { Cell } from "./gateway";

export type ExportFormat = "csv" | "json";

type Table = { columns: string[]; rows: Cell[][] };

const csvField = (value: Cell) => (value === null ? "" : /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value);

const csvLine = (cells: Cell[]) => cells.map(csvField).join(",");

/** Opens in a spreadsheet as it is: a missing value is an empty field, as pgAdmin writes it. */
export function toCsv({ columns, rows }: Table): string {
  return [csvLine(columns), ...rows.map(csvLine)].join("\r\n") + "\r\n";
}

/** Two columns may share a name, and an object keeps one of them, so later ones are numbered. */
function keys(columns: string[]): string[] {
  const seen = new Map<string, number>();
  return columns.map((name) => {
    const times = (seen.get(name) ?? 0) + 1;
    seen.set(name, times);
    return times === 1 ? name : `${name}_${times}`;
  });
}

/** Every value is text, as the database sent it, and a missing one is `null`. */
export function toJson({ columns, rows }: Table): string {
  const names = keys(columns);
  const objects = rows.map((row) => Object.fromEntries(names.map((name, index) => [name, row[index] ?? null])));
  return JSON.stringify(objects, null, 2) + "\n";
}

export const exportAs = (format: ExportFormat, table: Table) => (format === "csv" ? toCsv(table) : toJson(table));

export const exportFileName = (format: ExportFormat) => `result.${format}`;
