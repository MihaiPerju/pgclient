import type { Completion, CompletionContext, CompletionResult, CompletionSource } from "@codemirror/autocomplete";
import { PostgreSQL, sql } from "@codemirror/lang-sql";
import { syntaxTree } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import type { EditorState } from "@codemirror/state";

import { DEFAULT_SCHEMA, completionSchema } from "./catalog";
import type { CatalogTable } from "./gateway";

/** A table the statement reads from, by the name it goes by there: its alias, or else its own name. */
export interface TableRef {
  table: CatalogTable;
  name: string;
  /** Where in the statement it is named. */
  at: number;
}

const IDENT = String.raw`(?:"[^"]+"|[A-Za-z_][\w$]*)`;
/** Words that can follow a table and so are never its alias. */
const NOT_ALIAS = new Set(
  "on using where join inner left right full outer cross natural lateral group order limit offset having window union intersect except returning set values select from as and or into for fetch".split(" "),
);

const unquote = (name: string) => (name.startsWith('"') ? name.slice(1, -1) : name.toLowerCase());

/** The text with strings and comments blanked out, the same length, so nothing in them is mistaken for a name. */
export function blanked(text: string): string {
  return text.replace(/'(?:[^']|'')*'?|--[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/g, (found) => found.replace(/[^\n]/g, " "));
}

/** The statement the cursor is in, and where it starts, so the tables of the next one never count. */
export function statementAt(state: EditorState, pos: number): { text: string; from: number } {
  for (let node = syntaxTree(state).resolveInner(pos, -1); node; node = node.parent!) {
    if (node.name === "Statement") return { text: state.sliceDoc(node.from, node.to), from: node.from };
    if (!node.parent) break;
  }
  return { text: state.doc.toString(), from: 0 };
}

function find(catalog: CatalogTable[], written: string): CatalogTable | undefined {
  const [first, second] = written.match(new RegExp(IDENT, "g"))!.map(unquote);
  if (second !== undefined) return catalog.find((table) => table.schema === first && table.name === second);
  // Unqualified, as Postgres's search path would: public first, then the only table anywhere by that name.
  const named = catalog.filter((table) => table.name === first);
  return named.find((table) => table.schema === DEFAULT_SCHEMA) ?? (named.length === 1 ? named[0] : undefined);
}

/** The catalog's tables a statement names after from, join, update or into, with the alias each goes by. */
export function tablesIn(statement: string, catalog: CatalogTable[]): TableRef[] {
  const text = blanked(statement);
  const refs: TableRef[] = [];
  const one = new RegExp(String.raw`(${IDENT}(?:\s*\.\s*${IDENT})?)(?:\s+(?:as\s+)?(${IDENT}))?`, "iy");
  for (const start of text.matchAll(/\b(from|join|update|into)\s+/gi)) {
    let at = start.index + start[0].length;
    // `from a x, b y` names several, each after a comma.
    for (;;) {
      one.lastIndex = at;
      const found = one.exec(text);
      if (!found) break;
      const table = find(catalog, found[1].replace(/\s+/g, ""));
      const alias = found[2] && !NOT_ALIAS.has(found[2].toLowerCase()) ? unquote(found[2]) : null;
      if (table) refs.push({ table, name: alias ?? table.name, at: found.index });
      const end = alias ? one.lastIndex : found.index + found[1].length;
      const comma = /^\s*,\s*/.exec(text.slice(end));
      if (!comma) break;
      at = end + comma[0].length;
    }
  }
  return refs;
}

/** Columns of the statement's tables wherever a column can be written, without a table or alias in front. A column that
 * more than one of them has is offered with its table's name, so the query never says something ambiguous. */
export function columnSource(catalog: CatalogTable[]): CompletionSource {
  return (context: CompletionContext): CompletionResult | null => {
    const word = context.matchBefore(/[\w$]*/)!;
    if (word.from === word.to && !context.explicit) return null;
    const before = context.state.sliceDoc(Math.max(0, word.from - 12), word.from);
    // After a dot the editor offers that table's own columns, and after from or join it is a table that comes next.
    if (/\.\s*$/.test(before) || /\b(from|join|update|into|table)\s+$/i.test(before)) return null;
    const { text } = statementAt(context.state, context.pos);
    const refs = tablesIn(text, catalog);
    if (refs.length === 0) return null;
    const count = new Map<string, number>();
    for (const ref of refs) for (const column of ref.table.columns) count.set(column.name, (count.get(column.name) ?? 0) + 1);
    const options: Completion[] = refs.flatMap((ref) =>
      ref.table.columns.map((column) => ({
        label: count.get(column.name)! > 1 ? `${ref.name}.${column.name}` : column.name,
        detail: refs.length > 1 ? `${ref.name} · ${column.data_type}` : column.data_type,
        type: "property",
        boost: 2,
      })),
    );
    return { from: word.from, options, validFor: /^[\w$.]*$/ };
  };
}

const sameTable = (a: CatalogTable, schema: string, name: string) => a.schema === schema && a.name === name;

/** How two of the statement's tables join, from the foreign keys between them in either direction. */
function conditions(joined: TableRef, other: TableRef): string[] {
  const pair = (left: TableRef, leftColumns: string[], right: TableRef, rightColumns: string[]) =>
    leftColumns.map((column, i) => `${left.name}.${column} = ${right.name}.${rightColumns[i]}`).join(" and ");
  const found: string[] = [];
  for (const key of joined.table.foreign_keys)
    if (sameTable(other.table, key.references_schema, key.references_table)) found.push(pair(joined, key.columns, other, key.references_columns));
  for (const key of other.table.foreign_keys)
    if (sameTable(joined.table, key.references_schema, key.references_table)) found.push(pair(joined, key.references_columns, other, key.columns));
  return found;
}

/** After `join t x on`, the conditions the foreign keys give for joining t to the tables before it. After `join t x` alone,
 * the same with the `on` in front. */
export function joinSource(catalog: CatalogTable[]): CompletionSource {
  const afterOn = new RegExp(String.raw`\bjoin\s+${IDENT}(?:\s*\.\s*${IDENT})?(?:\s+(?:as\s+)?${IDENT})?\s+on\s+([\w$]*)$`, "i");
  const afterTable = new RegExp(String.raw`\bjoin\s+${IDENT}(?:\s*\.\s*${IDENT})?(?:\s+(?:as\s+)?${IDENT})?\s+([\w$]*)$`, "i");
  return (context: CompletionContext): CompletionResult | null => {
    const { text, from } = statementAt(context.state, context.pos);
    const before = blanked(text).slice(0, context.pos - from);
    const on = afterOn.exec(before);
    const bare = on ? null : afterTable.exec(before);
    const match = on ?? bare;
    if (!match) return null;
    const typed = match[1];
    if (bare && !"on".startsWith(typed.toLowerCase())) return null;
    if (!typed && !context.explicit) return null;
    const refs = tablesIn(text, catalog);
    const joinAt = from + match.index;
    const joined = refs.find((ref) => ref.at + from > joinAt);
    if (!joined) return null;
    const earlier = refs.filter((ref) => ref.at + from < joinAt && ref !== joined);
    const options = earlier.flatMap((other) => conditions(joined, other)).map(
      (condition): Completion => ({ label: bare ? `on ${condition}` : condition, type: "text", detail: "foreign key", boost: 3 }),
    );
    if (options.length === 0) return null;
    return { from: context.pos - typed.length, options };
  };
}

/** Postgres's SQL, with the catalog's tables and columns, the columns of the tables a statement reads without an alias in
 * front, and the conditions its joins can take from foreign keys. */
export function sqlSuggestions(catalog: CatalogTable[] | null | undefined): Extension[] {
  const language = sql({ dialect: PostgreSQL, schema: catalog ? completionSchema(catalog) : undefined, defaultSchema: DEFAULT_SCHEMA });
  if (!catalog) return [language];
  return [language, language.language.data.of({ autocomplete: columnSource(catalog) }), language.language.data.of({ autocomplete: joinSource(catalog) })];
}
