import { CompletionContext, type CompletionResult, type CompletionSource } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";

import type { CatalogTable } from "./gateway";
import { sqlSuggestions, tablesIn } from "./suggest";

const key = (columns: string[], table: string, references: string[]) => ({ columns, references_schema: "public", references_table: table, references_columns: references });

const CATALOG: CatalogTable[] = [
  {
    schema: "public",
    name: "customers",
    kind: "table",
    columns: [{ name: "id", data_type: "uuid" }, { name: "email", data_type: "text" }, { name: "region", data_type: "text" }],
    foreign_keys: [],
  },
  {
    schema: "public",
    name: "orders",
    kind: "table",
    columns: [{ name: "id", data_type: "uuid" }, { name: "customer_id", data_type: "uuid" }, { name: "region", data_type: "text" }, { name: "total", data_type: "numeric" }],
    foreign_keys: [key(["customer_id"], "customers", ["id"]), key(["customer_id", "region"], "customers", ["id", "region"])],
  },
  { schema: "audit", name: "log", kind: "table", columns: [{ name: "at", data_type: "timestamptz" }], foreign_keys: [] },
];

/** The labels the editor offers with the cursor at `|`, through everything it is set up with, keywords left out. */
async function offered(text: string, explicit = true): Promise<string[]> {
  const pos = text.indexOf("|");
  const state = EditorState.create({ doc: text.replace("|", ""), selection: { anchor: pos }, extensions: sqlSuggestions(CATALOG) });
  const context = new CompletionContext(state, pos, explicit);
  const results = await Promise.all(state.languageDataAt<CompletionSource>("autocomplete", pos).map((source) => source(context)));
  return results.filter((result): result is CompletionResult => result !== null).flatMap((result) => result.options.filter((option) => option.type !== "keyword").map((option) => option.label));
}

describe("the tables a statement reads", () => {
  const names = (sql: string) => tablesIn(sql, CATALOG).map((ref) => `${ref.table.schema}.${ref.table.name} as ${ref.name}`);

  test("by alias, with or without as, and by name when there is none", () => {
    expect(names("select * from orders o join customers as c on true")).toEqual(["public.orders as o", "public.customers as c"]);
    expect(names("select * from orders where total > 1")).toEqual(["public.orders as orders"]);
  });

  test("several after one from, and in other schemas", () => {
    expect(names("select * from orders o, audit.log l")).toEqual(["public.orders as o", "audit.log as l"]);
  });

  test("in updates and inserts too", () => {
    expect(names("update orders set total = 0")).toEqual(["public.orders as orders"]);
    expect(names("insert into customers (email) values ('a')")).toEqual(["public.customers as customers"]);
  });

  test("a keyword after a table is never taken for its alias", () => {
    expect(names("select * from orders left join customers on true")).toEqual(["public.orders as orders", "public.customers as customers"]);
  });

  test("nothing in a string or a comment counts", () => {
    expect(names("select 'from customers' from orders -- join customers c")).toEqual(["public.orders as orders"]);
  });

  test("quoted names are read as written", () => {
    expect(names('select * from "orders" "O"')).toEqual(["public.orders as O"]);
  });

  test("a table the catalog does not have is left out", () => {
    expect(names("select * from nowhere n join orders o on true")).toEqual(["public.orders as o"]);
  });
});

describe("columns without a table in front", () => {
  test("in the select list, of the table named after it", async () => {
    expect(await offered("select | from customers")).toEqual(expect.arrayContaining(["id", "email", "region"]));
  });

  test("as soon as something is typed, without being asked", async () => {
    expect(await offered("select * from orders where tot|", false)).toContain("total");
  });

  test("a column more than one of the tables has comes with the name of each, and the rest come bare", async () => {
    const labels = await offered("select | from orders o join customers c on c.id = o.customer_id");

    expect(labels).toEqual(expect.arrayContaining(["o.id", "c.id", "o.region", "c.region", "customer_id", "total", "email"]));
    expect(labels).not.toContain("id");
  });

  test("only the statement the cursor is in counts", async () => {
    const labels = await offered("select * from customers; select | from orders");

    expect(labels).toContain("total");
    expect(labels).not.toContain("email");
  });

  test("not where a table goes, nor after a dot, where the editor already offers what belongs", async () => {
    expect(await offered("select * from customers c join |")).not.toContain("email");
    expect((await offered("select c.| from customers c")).filter((label) => label === "email")).toHaveLength(1);
  });
});

describe("join conditions from foreign keys", () => {
  test("after on, each way the joined table's keys reach a table before it", async () => {
    expect(await offered("select * from orders o join customers c on |")).toEqual(
      expect.arrayContaining(["c.id = o.customer_id", "c.id = o.customer_id and c.region = o.region"]),
    );
  });

  test("whichever side holds the key", async () => {
    expect(await offered("select * from customers c join orders o on |")).toEqual(
      expect.arrayContaining(["o.customer_id = c.id", "o.customer_id = c.id and o.region = c.region"]),
    );
  });

  test("before on, the same with on in front, once on is begun", async () => {
    expect(await offered("select * from orders o join customers c o|", false)).toContain("on c.id = o.customer_id");
  });

  test("without aliases, by the tables' names", async () => {
    expect(await offered("select * from orders join customers on |")).toContain("customers.id = orders.customer_id");
  });

  test("nothing is made up for tables no key joins", async () => {
    expect(await offered("select * from orders o join audit.log l on |")).not.toEqual(expect.arrayContaining([expect.stringContaining(" = ")]));
  });
});
