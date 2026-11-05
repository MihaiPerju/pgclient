import type { CatalogTable } from "./gateway";

/** How many fields a table's cards show before any are chosen. */
export const FIELDS_SHOWN = 4;

const NAMES = /^(name|title|label|display_name|full_name|username|email|slug|subject|code)$|_(name|title)$/;
const KINDS = /^(status|state|type|kind|role)$/;

/** The fields a table's cards show unless chosen: what names a row first, then what sorts it, its id, the rest, and last the keys the edges already show and timestamps. */
export function defaultFields(columns: string[], table: CatalogTable | undefined): string[] {
  const keys = new Set(table?.foreign_keys.flatMap((key) => key.columns) ?? []);
  const types = new Map(table?.columns.map((column) => [column.name, column.data_type]) ?? []);
  const rank = (name: string) => {
    if (NAMES.test(name)) return 0;
    if (KINDS.test(name)) return 1;
    if (name === "id") return 2;
    if (keys.has(name)) return 4;
    if (/timestamp|date|time/.test(types.get(name) ?? "") || /_at$/.test(name)) return 5;
    return 3;
  };
  return columns
    .map((name, at) => ({ name, at, rank: rank(name) }))
    .sort((a, b) => a.rank - b.rank || a.at - b.at)
    .slice(0, FIELDS_SHOWN)
    .map(({ name }) => name);
}

const keyOf = (schema: string, table: string) => `pgclient.graphFields.${schema}.${table}`;

/** The fields chosen for a table's cards, if any were. */
export function loadFields(schema: string, table: string): string[] | null {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(keyOf(schema, table)) ?? "null");
    return Array.isArray(stored) && stored.every((name) => typeof name === "string") ? stored : null;
  } catch {
    return null;
  }
}

/** Remembers the fields chosen for a table's cards; null goes back to the defaults. */
export function saveFields(schema: string, table: string, fields: string[] | null) {
  try {
    if (fields === null) localStorage.removeItem(keyOf(schema, table));
    else localStorage.setItem(keyOf(schema, table), JSON.stringify(fields));
  } catch {
    // Not remembered, but still shown until the graph closes.
  }
}

/** Pins a field to the end of the list, or unpins it. */
export function togglePinned(fields: string[], name: string): string[] {
  return fields.includes(name) ? fields.filter((field) => field !== name) : [...fields, name];
}
