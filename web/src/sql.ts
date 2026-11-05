/** Words Postgres will not take as a name unless they are quoted. */
const RESERVED = new Set(
  (
    "all analyse analyze and any array as asc asymmetric both case cast check collate column constraint create current_catalog " +
    "current_date current_role current_time current_timestamp current_user default deferrable desc distinct do else end except " +
    "false fetch for foreign from grant group having in initially intersect into lateral leading limit localtime localtimestamp " +
    "not null offset on only or order placing primary references returning select session_user some symmetric table then to " +
    "trailing true union unique user using variadic when where window with"
  ).split(" "),
);

/** A plain name is left readable, and anything else is quoted, with a quote inside doubled. */
export function quoteIdent(name: string): string {
  if (/^[a-z_][a-z0-9_$]*$/.test(name) && !RESERVED.has(name)) return name;
  return `"${name.replaceAll('"', '""')}"`;
}

export function qualifiedName(schema: string, name: string): string {
  return `${quoteIdent(schema)}.${quoteIdent(name)}`;
}

/** What double-clicking a table puts in the editor: a look at the first rows, which is safe to run on anything. */
export function previewQuery(schema: string, name: string): string {
  return `select * from ${qualifiedName(schema, name)} limit 100;`;
}
