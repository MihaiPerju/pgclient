import type { CatalogTable } from "./gateway";
import { defaultFields, loadFields, saveFields, togglePinned } from "./graphFields";

const invoices: CatalogTable = {
  schema: "public",
  name: "invoices",
  kind: "table",
  columns: [
    { name: "id", data_type: "uuid" },
    { name: "customer_id", data_type: "uuid" },
    { name: "created", data_type: "timestamp with time zone" },
    { name: "region", data_type: "text" },
    { name: "status", data_type: "text" },
    { name: "product_name", data_type: "text" },
  ],
  foreign_keys: [{ columns: ["customer_id"], references_schema: "public", references_table: "customers", references_columns: ["id"] }],
};
const columns = invoices.columns.map((column) => column.name);

beforeEach(() => localStorage.clear());

test("cards lead with what names a row, then what sorts it, its id and the rest, leaving keys and timestamps for last", () => {
  expect(defaultFields(columns, invoices)).toEqual(["product_name", "status", "id", "region"]);
});

test("without the catalog, a table's columns are still told apart by their names", () => {
  expect(defaultFields(["id", "owner_id", "created_at", "email"], undefined)).toEqual(["email", "id", "owner_id", "created_at"]);
});

test("pinning adds a field at the end, however many there are, and unpinning takes it off", () => {
  expect(togglePinned(["id"], "name")).toEqual(["id", "name"]);
  expect(togglePinned(["id", "name"], "id")).toEqual(["name"]);
  expect(togglePinned(["a", "b", "c", "d"], "e")).toEqual(["a", "b", "c", "d", "e"]);
});

test("the fields chosen for a table are remembered until reset, and anything else stored there is ignored", () => {
  saveFields("public", "invoices", ["status", "id"]);
  expect(loadFields("public", "invoices")).toEqual(["status", "id"]);
  expect(loadFields("public", "other")).toBeNull();

  saveFields("public", "invoices", null);
  expect(loadFields("public", "invoices")).toBeNull();

  localStorage.setItem("pgclient.graphFields.public.invoices", "{not json");
  expect(loadFields("public", "invoices")).toBeNull();
});
