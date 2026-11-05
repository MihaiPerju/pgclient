import type { CatalogTable, ResultSource } from "./gateway";
import { relatedKeys, relatedQuery, relationLabel, relationsOf } from "./related";

const catalog: CatalogTable[] = [
  { schema: "public", name: "users", kind: "table", columns: [{ name: "id", data_type: "integer" }], foreign_keys: [] },
  {
    schema: "public",
    name: "orders",
    kind: "table",
    columns: [],
    foreign_keys: [{ columns: ["user_id"], references_schema: "public", references_table: "users", references_columns: ["id"] }],
  },
  {
    schema: "public",
    name: "order_lines",
    kind: "table",
    columns: [],
    foreign_keys: [{ columns: ["order_id"], references_schema: "public", references_table: "orders", references_columns: ["id"] }],
  },
];

const column = (name: string) => ({ name, data_type: "integer", nullable: false, has_default: false });
const orders: ResultSource = { state: "editable", schema: "public", table: "orders", columns: [column("id"), column("user_id"), null], key: ["id"] };

test("a column in a foreign key opens the row it points at", () => {
  expect(relationsOf(catalog, orders, 1)).toEqual([{ direction: "references", schema: "public", table: "users", from: [1], to: ["id"] }]);
});

test("a column other tables point at opens the rows pointing at it", () => {
  expect(relationsOf(catalog, orders, 0)).toEqual([{ direction: "referenced_by", schema: "public", table: "order_lines", from: [0], to: ["order_id"] }]);
});

test("a worked-out column, or a result that is not one table's, opens nothing", () => {
  expect(relationsOf(catalog, orders, 2)).toEqual([]);
  expect(relationsOf(catalog, { state: "read_only", reason: "joined" }, 1)).toEqual([]);
  expect(relationsOf(catalog, undefined, 1)).toEqual([]);
});

test("a key whose columns are not all in the result is left out", () => {
  const withoutId: ResultSource = { ...orders, columns: [column("user_id")] } as ResultSource;
  expect(relationsOf(catalog, withoutId, 0).map((relation) => relation.table)).toEqual(["users"]);
});

test("the label says which columns pair up, from the result's side", () => {
  const [relation] = relationsOf(catalog, orders, 1);
  expect(relationLabel(relation, ["id", "user_id", "total"])).toBe("users (user_id → id)");
});

test("each key is looked for once, and NULLs are left out", () => {
  const relation = relationsOf(catalog, orders, 1)[0];
  expect(relatedKeys(relation, [["1", "7"], ["2", "7"], ["3", null], ["4", "9"]])).toEqual([["7"], ["9"]]);
});

test("the query quotes values as literals, with quotes inside doubled", () => {
  const relation = { direction: "references" as const, schema: "public", table: "user", from: [0], to: ["email"] };
  expect(relatedQuery(relation, [["a@b.c"], ["o'brien@x.y"]])).toBe(`select * from public."user" where email in ('a@b.c', 'o''brien@x.y');`);
});

test("a key of several columns is looked for as a row", () => {
  const relation = { direction: "referenced_by" as const, schema: "public", table: "stock", from: [0, 1], to: ["shop", "sku"] };
  expect(relatedQuery(relation, [["1", "a"], ["2", "b"]])).toBe("select * from public.stock where (shop, sku) in (('1', 'a'), ('2', 'b'));");
});
