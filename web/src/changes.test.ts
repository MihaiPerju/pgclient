import { addRows, applied, buildChanges, dropAdded, edit, editAdded, editedCount, isPending, nothingPending, shown, toggleDeleted } from "./changes";
import type { ResultSource } from "./gateway";
import type { ResultSet } from "./results";

const source: Extract<ResultSource, { state: "editable" }> = {
  state: "editable",
  schema: "public",
  table: "people",
  columns: [
    { name: "label", data_type: "text", nullable: true, has_default: false },
    { name: "id", data_type: "integer", nullable: false, has_default: true },
    null,
  ],
  key: ["id"],
};

const result: ResultSet = {
  columns: ["name", "id", "shout"],
  rows: [
    ["ada", "1", "ADA"],
    ["grace", "2", "GRACE"],
    [null, "3", null],
  ],
  rowsAffected: 3,
  source,
};

test("nothing is pending until something is marked or edited", () => {
  expect(isPending(nothingPending)).toBe(false);
});

test("marking rows for deletion, and marking the same ones again lets them go", () => {
  const marked = toggleDeleted(nothingPending, [0, 2]);

  expect([...marked.deleted]).toEqual([0, 2]);
  expect(isPending(marked)).toBe(true);
  expect(toggleDeleted(marked, [0, 2]).deleted.size).toBe(0);
});

test("marking rows of which only some are marked marks them all", () => {
  expect([...toggleDeleted(toggleDeleted(nothingPending, [0]), [0, 1]).deleted]).toEqual([0, 1]);
});

test("an edited cell shows its new value, and an edit back to what it was is no edit", () => {
  const edited = edit(nothingPending, 1, 0, "Grace", "grace");

  expect(shown(result, edited, 1, 0)).toBe("Grace");
  expect(shown(result, edited, 1, 1)).toBe("2");
  expect(isPending(edit(edited, 1, 0, "grace", "grace"))).toBe(false);
});

test("a cell can be edited to null", () => {
  expect(shown(result, edit(nothingPending, 0, 0, null, "ada"), 0, 0)).toBeNull();
});

test("the edits of a row that is to be deleted are not counted", () => {
  const pending = toggleDeleted(edit(nothingPending, 1, 0, "Grace", "grace"), [1]);

  expect(editedCount(pending)).toBe(0);
});

test("a deleted row is found by its key, wherever the key sits in the result", () => {
  expect(buildChanges(result, source, toggleDeleted(nothingPending, [1]))).toEqual([{ kind: "delete", key: { id: "2" } }]);
});

test("an edited row sets the table's column the cell shows, and is found by the key it was read with", () => {
  const pending = edit(edit(nothingPending, 0, 0, "Ada L", "ada"), 0, 1, "10", "1");

  expect(buildChanges(result, source, pending)).toEqual([{ kind: "update", key: { id: "1" }, set: { label: "Ada L", id: "10" } }]);
});

test("a row both edited and marked for deletion is only deleted", () => {
  const pending = toggleDeleted(edit(nothingPending, 0, 0, "Ada L", "ada"), [0]);

  expect(buildChanges(result, source, pending)).toEqual([{ kind: "delete", key: { id: "1" } }]);
});

test("a cell that is worked out is never sent", () => {
  expect(buildChanges(result, source, edit(nothingPending, 0, 2, "x", "ADA"))).toEqual([]);
});

test("once written, the deleted rows are gone and the edits are in the rows", () => {
  const pending = toggleDeleted(edit(nothingPending, 2, 0, "Alan", null), [0]);

  expect(applied(result, pending).rows).toEqual([
    ["grace", "2", "GRACE"],
    ["Alan", "3", null],
  ]);
  expect(applied(result, pending).source).toBe(source);
});

describe("rows to add", () => {
  const people: Extract<ResultSource, { state: "editable" }> = {
    state: "editable",
    schema: "public",
    table: "people",
    columns: [
      { name: "id", data_type: "integer", nullable: false, has_default: true },
      { name: "email", data_type: "text", nullable: false, has_default: false },
      { name: "created", data_type: "timestamptz", nullable: false, has_default: true },
    ],
    key: ["id"],
  };
  const read: ResultSet = { columns: ["id", "email", "created"], rows: [["1", "a@x.io", "2026-01-01"]], rowsAffected: 1, source: people };

  test("pasted rows are waiting to be added, below the rows that were read", () => {
    const pending = addRows(nothingPending, people, [["1", "a@x.io", "2026-01-01"], ["2", "b@x.io", "2026-01-02"]]);

    expect(pending.added).toHaveLength(2);
    expect(isPending(pending)).toBe(true);
  });

  test("the key the database makes for itself is left empty, so a copy does not collide with what it was copied from", () => {
    const pending = addRows(nothingPending, people, [["1", "a@x.io", "2026-01-01"]]);

    expect(pending.added[0]).toEqual([null, "a@x.io", "2026-01-01"]);
  });

  test("a column that has a default but is not the key keeps what was copied", () => {
    expect(addRows(nothingPending, people, [["1", "a@x.io", "2026-01-01"]]).added[0][2]).toBe("2026-01-01");
  });

  test("a key the database does not make for itself is kept, since it has to be something", () => {
    const manual: typeof people = { ...people, columns: people.columns.map((column) => (column?.name === "id" ? { ...column, has_default: false } : column)) };

    expect(addRows(nothingPending, manual, [["7", "a@x.io", "x"]]).added[0][0]).toBe("7");
  });

  test("a row with fewer cells than there are columns leaves the rest empty, and one with more leaves the extra off", () => {
    expect(addRows(nothingPending, people, [["1", "a@x.io"]]).added[0]).toEqual([null, "a@x.io", null]);
    expect(addRows(nothingPending, people, [["1", "a@x.io", "t", "extra", "more"]]).added[0]).toHaveLength(3);
  });

  test("rows pasted twice are both kept, in order", () => {
    const once = addRows(nothingPending, people, [["1", "first", "t"]]);

    expect(addRows(once, people, [["2", "second", "t"]]).added.map((row) => row[1])).toEqual(["first", "second"]);
  });

  test("a cell of a new row can be changed, and only that one", () => {
    const pending = editAdded(addRows(nothingPending, people, [["1", "a", "t"], ["2", "b", "t"]]), 1, 1, "changed");

    expect(pending.added.map((row) => row[1])).toEqual(["a", "changed"]);
  });

  test("a new row can be taken off the list again", () => {
    const pending = dropAdded(addRows(nothingPending, people, [["1", "a", "t"], ["2", "b", "t"], ["3", "c", "t"]]), [0, 2]);

    expect(pending.added.map((row) => row[1])).toEqual(["b"]);
  });

  test("nothing is pending once every new row is taken off", () => {
    expect(isPending(dropAdded(addRows(nothingPending, people, [["1", "a", "t"]]), [0]))).toBe(false);
  });

  test("what the database is told is an insert with a value for each column, and none for a default that was left empty", () => {
    const pending = addRows(nothingPending, people, [["1", "a@x.io", ""]]);

    expect(buildChanges(read, people, pending)).toEqual([{ kind: "insert", values: { email: "a@x.io", created: "" } }]);
  });

  test("a default that was given a value is sent, and a column that may not default is sent even when it is null", () => {
    const pending = editAdded(addRows(nothingPending, people, [["1", null, null]]), 0, 2, "2027-01-01");

    expect(buildChanges(read, people, pending)).toEqual([{ kind: "insert", values: { email: null, created: "2027-01-01" } }]);
  });

  test("inserts come after the deletes and edits, which are one save with them", () => {
    const pending = addRows(toggleDeleted(nothingPending, [0]), people, [["9", "new", "t"]]);

    expect(buildChanges(read, people, pending).map((change) => change.kind)).toEqual(["delete", "insert"]);
  });

  test("a column that is worked out by the query is not part of a new row", () => {
    const worked: typeof people = { ...people, columns: [people.columns[0], people.columns[1], null] };

    expect(buildChanges(read, worked, addRows(nothingPending, worked, [["1", "a", "x"]]))[0]).toEqual({ kind: "insert", values: { email: "a" } });
  });

  test("a row marked for deletion has its edits left out, as before", () => {
    expect(editedCount(toggleDeleted(edit(nothingPending, 0, 1, "x", "a"), [0]))).toBe(0);
  });
});
