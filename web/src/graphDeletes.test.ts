import { deleteChanges, withoutRows, type RowToDelete } from "./graphDeletes";
import type { ResultSet } from "./results";

const row = (schema: string, table: string, columns: string[], values: (string | null)[]): RowToDelete => ({ schema, table, columns, row: values });

describe("deleting the rows of cards", () => {
  test("each row is found by the primary key of its table, whatever order the columns were read in", () => {
    const rows = [row("public", "pets", ["name", "id"], ["rex", "10"]), row("public", "pets", ["name", "id"], ["tom", "11"])];

    expect(deleteChanges(rows, ["id"])).toEqual([
      { kind: "delete", key: { id: "10" } },
      { kind: "delete", key: { id: "11" } },
    ]);
  });

  test("a key of several columns has a value for each", () => {
    expect(deleteChanges([row("public", "links", ["a", "b", "note"], ["1", "2", "x"])], ["a", "b"])).toEqual([{ kind: "delete", key: { a: "1", b: "2" } }]);
  });

  test("a table with no primary key cannot have its rows deleted, and says so", () => {
    expect(() => deleteChanges([row("public", "log", ["msg"], ["hi"])], [])).toThrow("public.log has no primary key, so its rows cannot be deleted");
  });

  test("a row read without its whole primary key cannot be found again, and says so", () => {
    expect(() => deleteChanges([row("public", "pets", ["name"], ["rex"])], ["id"])).toThrow("public.pets was read without its primary key (id), so its rows cannot be deleted");
  });
});

describe("a result once rows of its table are deleted", () => {
  const result: ResultSet = { columns: ["id"], rows: [["1"], ["2"], ["3"]], rowsAffected: 3 };

  test("keeps the rows that are left, as they were", () => {
    const left = withoutRows(result, [["2"]]);

    expect(left.rows).toEqual([["1"], ["3"]]);
    expect(left.rows[0]).toBe(result.rows[0]);
  });

  test("is the same result when none of its rows were deleted", () => {
    expect(withoutRows(result, [["9"]])).toBe(result);
  });
});
