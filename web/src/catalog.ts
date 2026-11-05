import type { Completion } from "@codemirror/autocomplete";
import type { SQLNamespace } from "@codemirror/lang-sql";
import { useEffect, useRef, useState } from "react";

import type { CatalogTable, Gateway } from "./gateway";

/** Where names are found without their schema, as Postgres finds them. */
export const DEFAULT_SCHEMA = "public";

/** Each gateway keeps its own catalogs, so a test's fake never sees another test's tables. */
const caches = new WeakMap<Gateway, Map<string, Promise<CatalogTable[]>>>();

/** A database's catalog, asked for once and shared after that. A failure is forgotten, so the next ask tries again. */
export function loadCatalog(gateway: Gateway, serverId: string, database: string, fresh = false): Promise<CatalogTable[]> {
  let cache = caches.get(gateway);
  if (!cache) caches.set(gateway, (cache = new Map()));
  const key = `${serverId}\n${database}`;
  const known = cache.get(key);
  if (known && !fresh) return known;
  const loading = gateway.catalog(serverId, database);
  cache.set(key, loading);
  loading.catch(() => cache.get(key) === loading && cache.delete(key));
  return loading;
}

/** The chosen database's catalog, loaded as soon as the database is chosen so it is there before the first word is typed.
 * A change of `reload` asks the database again. Until it arrives, and if it cannot be had, there is none. */
export function useCatalog(gateway: Gateway, serverId: string | null, database: string | null, reload: number): CatalogTable[] | null {
  const [catalog, setCatalog] = useState<CatalogTable[] | null>(null);
  const lastReload = useRef(reload);
  useEffect(() => {
    const fresh = lastReload.current !== reload;
    lastReload.current = reload;
    setCatalog(null);
    if (serverId === null || database === null) return;
    let current = true;
    loadCatalog(gateway, serverId, database, fresh)
      .then((found) => current && setCatalog(found))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [gateway, serverId, database, reload]);
  return catalog;
}

const KIND_LABELS = { table: "table", view: "view", materialized_view: "materialized view", foreign_table: "foreign table" } as const;

/** The catalog as the editor's SQL completion wants it: schema, then table, then that table's columns. */
export function completionSchema(catalog: CatalogTable[]): SQLNamespace {
  const schemas: Record<string, Record<string, { self: Completion; children: Completion[] }>> = {};
  for (const table of catalog) {
    (schemas[table.schema] ??= {})[table.name] = {
      self: { label: table.name, type: table.kind === "table" ? "class" : "type", detail: KIND_LABELS[table.kind], boost: 1 },
      children: table.columns.map((column) => ({ label: column.name, type: "property", detail: column.data_type })),
    };
  }
  return schemas;
}
