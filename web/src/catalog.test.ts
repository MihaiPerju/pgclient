import { CompletionContext, type CompletionResult, type CompletionSource } from "@codemirror/autocomplete";
import { PostgreSQL, sql } from "@codemirror/lang-sql";
import { EditorState } from "@codemirror/state";
import { vi } from "vitest";

import { DEFAULT_SCHEMA, completionSchema, loadCatalog } from "./catalog";
import type { CatalogTable, Gateway } from "./gateway";

const CATALOG: CatalogTable[] = [
  { schema: "public", name: "orders", kind: "table", columns: [{ name: "id", data_type: "uuid" }, { name: "customer_id", data_type: "uuid" }], foreign_keys: [] },
  { schema: "public", name: "customers", kind: "table", columns: [{ name: "id", data_type: "uuid" }, { name: "email", data_type: "text" }], foreign_keys: [] },
  { schema: "public", name: "recent_orders", kind: "view", columns: [{ name: "id", data_type: "uuid" }], foreign_keys: [] },
  { schema: "audit", name: "log", kind: "table", columns: [{ name: "at", data_type: "timestamp with time zone" }], foreign_keys: [] },
];

/** What the editor would offer with the cursor at `|`, from the real SQL completion and nothing else. */
async function suggestions(text: string, explicit = true): Promise<string[]> {
  const pos = text.indexOf("|");
  const state = EditorState.create({
    doc: text.replace("|", ""),
    selection: { anchor: pos },
    extensions: sql({ dialect: PostgreSQL, schema: completionSchema(CATALOG), defaultSchema: DEFAULT_SCHEMA }),
  });
  const context = new CompletionContext(state, pos, explicit);
  const sources = state.languageDataAt<CompletionSource>("autocomplete", pos);
  const results = await Promise.all(sources.map((source) => source(context)));
  return results.filter((result): result is CompletionResult => result !== null).flatMap((result) => result.options.filter((option) => option.type !== "keyword").map((option) => option.label));
}

describe("suggestions while typing", () => {
  test("after from, the tables of public by name, and the other schemas to reach theirs", async () => {
    const offered = await suggestions("select * from |");

    expect(offered).toEqual(expect.arrayContaining(["orders", "customers", "recent_orders", "audit"]));
    expect(offered).not.toContain("log");
  });

  test("a schema and a dot give that schema's tables", async () => {
    expect(await suggestions("select * from audit.|")).toEqual(["log"]);
  });

  test("an alias and a dot give the columns of the table it stands for", async () => {
    expect(await suggestions("select o.| from orders o")).toEqual(["id", "customer_id"]);
  });

  test("in a join, each alias gives its own table's columns", async () => {
    expect(await suggestions("select * from orders o join customers c on c.| = o.customer_id")).toEqual(["id", "email"]);
  });

  test("a table named outright gives its columns too", async () => {
    expect(await suggestions("select customers.| from customers")).toEqual(["id", "email"]);
  });

  test("tables come before keywords, so after from they are what is offered first", () => {
    const orders = (completionSchema(CATALOG) as unknown as Record<string, Record<string, { self: { boost?: number } }>>).public.orders;
    expect(orders.self.boost).toBeGreaterThan(0);
  });

  test("each column says its type, and each table what kind it is", () => {
    const schemas = completionSchema(CATALOG) as unknown as Record<string, Record<string, { self: { detail?: string }; children: { label: string; detail?: string }[] }>>;
    expect(schemas.public.recent_orders.self.detail).toBe("view");
    expect(schemas.audit.log.children).toEqual([expect.objectContaining({ label: "at", detail: "timestamp with time zone" })]);
  });
});

describe("loading the catalog", () => {
  const gatewayWith = (catalog: Gateway["catalog"]) => ({ catalog: vi.fn(catalog) }) as unknown as Gateway & { catalog: ReturnType<typeof vi.fn> };

  test("a database is asked once, however often its catalog is wanted", async () => {
    const gateway = gatewayWith(async () => CATALOG);

    await loadCatalog(gateway, "s1", "app");
    await loadCatalog(gateway, "s1", "app");
    expect(await loadCatalog(gateway, "s1", "app")).toBe(CATALOG);

    expect(gateway.catalog).toHaveBeenCalledTimes(1);
  });

  test("two asks at once share the one answer", async () => {
    const gateway = gatewayWith(async () => CATALOG);

    await Promise.all([loadCatalog(gateway, "s1", "app"), loadCatalog(gateway, "s1", "app")]);

    expect(gateway.catalog).toHaveBeenCalledTimes(1);
  });

  test("each database, and each server, has its own", async () => {
    const gateway = gatewayWith(async () => CATALOG);

    await loadCatalog(gateway, "s1", "app");
    await loadCatalog(gateway, "s1", "orders");
    await loadCatalog(gateway, "s2", "app");

    expect(gateway.catalog).toHaveBeenCalledTimes(3);
  });

  test("asking for it fresh goes to the database again, and what comes back is kept", async () => {
    const gateway = gatewayWith(async () => CATALOG);
    await loadCatalog(gateway, "s1", "app");

    await loadCatalog(gateway, "s1", "app", true);
    await loadCatalog(gateway, "s1", "app");

    expect(gateway.catalog).toHaveBeenCalledTimes(2);
  });

  test("a failure is not kept, so the next ask tries again", async () => {
    const gateway = gatewayWith(async () => CATALOG);
    gateway.catalog.mockRejectedValueOnce("ERROR: the tunnel is down");

    await expect(loadCatalog(gateway, "s1", "app")).rejects.toBe("ERROR: the tunnel is down");
    expect(await loadCatalog(gateway, "s1", "app")).toBe(CATALOG);
  });
});
