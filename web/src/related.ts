import type { CatalogTable, Cell, ResultSource } from "./gateway";
import { qualifiedName, quoteIdent } from "./sql";

/** The most distinct values one query is made with, so a big result does not become a statement too long to read or send. */
export const MAX_RELATED = 1000;

/** Rows of another table that go with rows of a result, by a foreign key either way round. */
export interface Relation {
  /** `references`: the rows this result's key points at, one for each. `referenced_by`: the rows that point at this result, any number. */
  direction: "references" | "referenced_by";
  schema: string;
  table: string;
  /** The result's columns, by position, whose values are looked for. */
  from: number[];
  /** The other table's columns they are looked for in, in the same order. */
  to: string[];
}

/** Every foreign key of a table, and every one pointing at it, whose columns are all among `columns`: the columns of rows read from it, by position. */
export function tableRelations(catalog: CatalogTable[], schema: string, name: string, columns: (string | null)[]): Relation[] {
  const positions = (names: string[]) => {
    const found = names.map((wanted) => columns.indexOf(wanted));
    return found.includes(-1) ? null : found;
  };
  const relations: Relation[] = [];
  const own = catalog.find((table) => table.schema === schema && table.name === name);
  for (const key of own?.foreign_keys ?? []) {
    const from = positions(key.columns);
    if (from) relations.push({ direction: "references", schema: key.references_schema, table: key.references_table, from, to: key.references_columns });
  }
  for (const table of catalog) {
    for (const key of table.foreign_keys) {
      if (key.references_schema !== schema || key.references_table !== name) continue;
      const from = positions(key.references_columns);
      if (from) relations.push({ direction: "referenced_by", schema: table.schema, table: table.name, from, to: key.columns });
    }
  }
  return relations;
}

/** What can be opened from a column of a result read from one table: the relations of that table the column is part of. */
export function relationsOf(catalog: CatalogTable[], source: ResultSource | undefined, column: number): Relation[] {
  if (source?.state !== "editable" || !source.columns[column]) return [];
  return tableRelations(catalog, source.schema, source.table, source.columns.map((shown) => shown?.name ?? null)).filter((relation) => relation.from.includes(column));
}

/** The columns that pair up, written from the side that holds the foreign key. */
export function pairing(relation: Relation, columns: string[]): string {
  const from = relation.from.map((at) => columns[at]).join(", ");
  const to = relation.to.join(", ");
  return relation.direction === "references" ? `${from} → ${to}` : `${to} → ${from}`;
}

/** How a relation is named in the menu: the table, and the columns that pair up. */
export const relationLabel = (relation: Relation, columns: string[]) => `${relation.table} (${pairing(relation, columns)})`;

const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;

/** The distinct keys of the rows given, leaving out any with a NULL, which matches nothing. */
export function relatedKeys(relation: Relation, rows: Cell[][]): string[][] {
  const seen = new Map<string, string[]>();
  for (const row of rows) {
    const key = relation.from.map((at) => row[at]);
    if (key.some((value) => value === null || value === undefined)) continue;
    seen.set(JSON.stringify(key), key as string[]);
  }
  return [...seen.values()];
}

/** The rows of the other table that go with `keys`. Values are written as untyped literals, so Postgres reads each as its column's type. */
export function relatedQuery(relation: Relation, keys: string[][]): string {
  const target = qualifiedName(relation.schema, relation.table);
  if (relation.to.length === 1) return `select * from ${target} where ${quoteIdent(relation.to[0])} in (${keys.map((key) => literal(key[0])).join(", ")});`;
  const tuples = keys.map((key) => `(${key.map(literal).join(", ")})`).join(", ");
  return `select * from ${target} where (${relation.to.map(quoteIdent).join(", ")}) in (${tuples});`;
}
