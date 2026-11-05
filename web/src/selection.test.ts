import { cellEdges, cellsFrom, clickCell, clickColumn, clickCorner, clickRow, dragTo, isCellSelected, isColumnSelected, isRowSelected, none, projection, released, selectedCells, selectedRows, status, toTsv, cellCount, type Selection } from "./selection";

const plain = { toggle: false, range: false };
const toggle = { toggle: true, range: false };
const range = { toggle: false, range: true };
const ROWS = 10;

const rowsOf = (selection: Selection) => (selection.kind === "rows" ? [...selection.rows].sort((a, b) => a - b) : null);
const columnsOf = (selection: Selection) => (selection.kind === "columns" ? [...selection.columns].sort((a, b) => a - b) : null);

describe("rows", () => {
  test("a click selects a row, and another click on a different row adds it", () => {
    const first = clickRow(none, 3, plain, ROWS);

    expect(rowsOf(first)).toEqual([3]);
    expect(rowsOf(clickRow(first, 5, plain, ROWS))).toEqual([3, 5]);
  });

  test("clicking a selected row takes it off and leaves the others", () => {
    let selection = clickRow(clickRow(clickRow(none, 1, plain, ROWS), 4, plain, ROWS), 6, plain, ROWS);
    expect(rowsOf(selection)).toEqual([1, 4, 6]);

    selection = clickRow(selection, 4, plain, ROWS);
    expect(rowsOf(selection)).toEqual([1, 6]);
  });

  test("command-click does the same as a click", () => {
    const selection = clickRow(clickRow(none, 1, plain, ROWS), 4, toggle, ROWS);

    expect(rowsOf(selection)).toEqual([1, 4]);
    expect(rowsOf(clickRow(selection, 1, toggle, ROWS))).toEqual([4]);
  });

  test("taking off the last row leaves nothing selected", () => {
    const selection = clickRow(clickRow(none, 2, plain, ROWS), 2, toggle, ROWS);

    expect(selection.kind).toBe("none");
  });

  test("shift-click selects every row from where the last click was", () => {
    const selection = clickRow(clickRow(none, 2, plain, ROWS), 5, range, ROWS);

    expect(rowsOf(selection)).toEqual([2, 3, 4, 5]);
  });

  test("shift-click works upwards too, and keeps the first click as its anchor", () => {
    let selection = clickRow(none, 6, plain, ROWS);
    selection = clickRow(selection, 3, range, ROWS);
    expect(rowsOf(selection)).toEqual([3, 4, 5, 6]);

    selection = clickRow(selection, 8, range, ROWS);
    expect(rowsOf(selection)).toEqual([6, 7, 8]);
  });

  test("clicking the only selected row again lets it go", () => {
    const selected = clickRow(none, 3, plain, ROWS);

    expect(clickRow(selected, 3, plain, ROWS).kind).toBe("none");
  });

  test("shift-click with nothing selected selects just that row", () => {
    expect(rowsOf(clickRow(none, 4, range, ROWS))).toEqual([4]);
  });
});

describe("columns", () => {
  test("a click selects the column, command-click adds one, shift-click makes a range", () => {
    let selection = clickColumn(none, 1, plain);
    expect(columnsOf(selection)).toEqual([1]);

    selection = clickColumn(selection, 3, toggle);
    expect(columnsOf(selection)).toEqual([1, 3]);

    selection = clickColumn(clickColumn(none, 0, plain), 2, range);
    expect(columnsOf(selection)).toEqual([0, 1, 2]);
  });

  test("clicking the only selected column again lets it go, and so does command-click", () => {
    const selected = clickColumn(none, 1, plain);

    expect(clickColumn(selected, 1, plain).kind).toBe("none");
    expect(clickColumn(selected, 1, toggle).kind).toBe("none");
  });

  test("clicking one of several selected columns narrows to it, and clicking that again lets go", () => {
    const several = clickColumn(clickColumn(none, 0, plain), 2, toggle);

    const narrowed = clickColumn(several, 2, plain);
    expect(columnsOf(narrowed)).toEqual([2]);
    expect(clickColumn(narrowed, 2, plain).kind).toBe("none");
  });
});

describe("rows and columns do not mix", () => {
  test("choosing a column drops the rows, and choosing a row drops the columns", () => {
    const rows = clickRow(none, 2, plain, ROWS);
    const columns = clickColumn(rows, 1, plain);
    expect(rowsOf(columns)).toBeNull();
    expect(columnsOf(columns)).toEqual([1]);

    expect(columnsOf(clickRow(columns, 4, toggle, ROWS))).toBeNull();
    expect(rowsOf(clickRow(columns, 4, toggle, ROWS))).toEqual([4]);
  });
});

describe("the corner, which stands for every row", () => {
  test("it selects all the rows, and selects none when clicked again", () => {
    const all = clickCorner(none);

    expect(isRowSelected(all, 0)).toBe(true);
    expect(isRowSelected(all, 999_999)).toBe(true);
    expect(clickCorner(all).kind).toBe("none");
  });

  test("it works for a result of a million rows without a million entries", () => {
    const all = clickCorner(none);

    expect(all.kind === "rows" && all.rows.size).toBe(0);
  });

  test("a click on one row afterwards takes that row off and keeps the rest", () => {
    expect(rowsOf(clickRow(clickCorner(none), 7, plain, ROWS))).toEqual([0, 1, 2, 3, 4, 5, 6, 8, 9]);
  });

  test("command-clicking a row while everything is selected leaves every other row", () => {
    const selection = clickRow(clickCorner(none), 2, toggle, 4);

    expect(rowsOf(selection)).toEqual([0, 1, 3]);
  });

  test("it replaces a column selection", () => {
    expect(isRowSelected(clickCorner(clickColumn(none, 1, plain)), 3)).toBe(true);
  });
});

describe("asking what is selected", () => {
  test("rows and columns know whether they are in", () => {
    expect(isRowSelected(clickRow(none, 2, plain, ROWS), 2)).toBe(true);
    expect(isRowSelected(clickRow(none, 2, plain, ROWS), 3)).toBe(false);
    expect(isColumnSelected(clickColumn(none, 1, plain), 1)).toBe(true);
    expect(isColumnSelected(clickColumn(none, 1, plain), 0)).toBe(false);
    expect(isRowSelected(none, 0)).toBe(false);
  });

  test("the status line counts them the way pgAdmin does", () => {
    expect(status(none, ROWS)).toBe("");
    expect(status(clickRow(clickRow(none, 1, plain, ROWS), 2, toggle, ROWS), ROWS)).toBe("Rows selected: 2");
    expect(status(clickRow(none, 1, plain, ROWS), ROWS)).toBe("Rows selected: 1");
    expect(status(clickColumn(none, 1, plain), ROWS)).toBe("Columns selected: 1");
    expect(status(clickCorner(none), 119)).toBe("Rows selected: 119");
  });
});

describe("what is copied", () => {
  const result = {
    columns: ["id", "name", "note"],
    rows: [
      ["1", "ada", null],
      ["2", "grace", "line\nbreak"],
      ["3", 'say "hi"', "a\tb"],
      ["4", "alan", "x"],
    ],
  };

  test("selected rows come as tab-separated lines, in order, with every column", () => {
    const selection = clickRow(clickRow(none, 3, plain, 4), 0, toggle, 4);

    expect(toTsv(result, selection, false)).toBe("1\tada\t\n4\talan\tx");
  });

  test("with headers, the column names come first", () => {
    expect(toTsv(result, clickRow(none, 0, plain, 4), true)).toBe("id\tname\tnote\n1\tada\t");
  });

  test("a selected column is copied top to bottom, one value to a line", () => {
    expect(toTsv(result, clickColumn(none, 1, plain), false)).toBe('ada\ngrace\n"say ""hi"""\nalan');
  });

  test("several columns keep their order, whichever was clicked first", () => {
    const selection = clickColumn(clickColumn(none, 2, plain), 0, toggle);

    expect(toTsv(result, selection, true)).toBe('id\tnote\n1\t\n2\t"line\nbreak"\n3\t"a\tb"\n4\tx');
  });

  test("everything, from the corner, is the whole result", () => {
    expect(toTsv(result, clickCorner(none), true).split("\n")[0]).toBe("id\tname\tnote");
    expect(toTsv(result, clickCorner(none), false)).toContain("4\talan\tx");
  });

  test("a missing value is copied as nothing, and a value that holds a tab, a newline or a quote is quoted so it pastes into one cell", () => {
    const text = toTsv(result, clickColumn(none, 2, plain), false);

    expect(text).toBe('\n"line\nbreak"\n"a\tb"\nx');
  });

  test("nothing selected copies nothing", () => {
    expect(toTsv(result, none, true)).toBe("");
  });
});

describe("a single cell", () => {
  test("a click selects that cell, and a click on another moves the selection to it", () => {
    const first = clickCell(none, 2, 1);

    expect(isCellSelected(first, 2, 1)).toBe(true);
    expect(isCellSelected(first, 2, 0)).toBe(false);
    expect(isCellSelected(clickCell(first, 3, 0), 2, 1)).toBe(false);
    expect(isCellSelected(clickCell(first, 3, 0), 3, 0)).toBe(true);
  });

  test("clicking the cell that is selected lets it go", () => {
    expect(clickCell(clickCell(none, 2, 1), 2, 1).kind).toBe("none");
  });

  test("a cell does not count as its row or its column being selected", () => {
    const selection = clickCell(none, 2, 1);

    expect(isRowSelected(selection, 2)).toBe(false);
    expect(isColumnSelected(selection, 1)).toBe(false);
  });

  test("choosing a row, a column or the corner lets go of the cell, and choosing a cell lets go of those", () => {
    const cell = clickCell(none, 2, 1);

    expect(isCellSelected(clickRow(cell, 2, plain, ROWS), 2, 1)).toBe(false);
    expect(clickRow(cell, 2, plain, ROWS).kind).toBe("rows");
    expect(clickColumn(cell, 1, plain).kind).toBe("columns");
    expect(clickCorner(cell).kind).toBe("rows");
    expect(clickCell(clickRow(none, 2, plain, ROWS), 0, 0).kind).toBe("cells");
    expect(clickCell(clickColumn(none, 1, plain), 0, 0).kind).toBe("cells");
  });

  test("the status line says a cell is selected", () => {
    expect(status(clickCell(none, 0, 0), ROWS)).toBe("Cell selected");
  });
});

describe("copying a cell", () => {
  const result = {
    columns: ["id", "note"],
    rows: [
      ["1", "plain"],
      ["2", null],
      ["3", "line\nbreak"],
    ],
  };

  test("what is copied is the value itself, with nothing added", () => {
    expect(toTsv(result, clickCell(none, 0, 1), false)).toBe("plain");
  });

  test("a missing value copies as nothing", () => {
    expect(toTsv(result, clickCell(none, 1, 1), false)).toBe("");
  });

  test("a value with a line break in it is copied as it is, so pasting it into an editor gives what was seen", () => {
    expect(toTsv(result, clickCell(none, 2, 1), false)).toBe("line\nbreak");
  });

  test("with headers, the column name comes first, on a line of its own", () => {
    expect(toTsv(result, clickCell(none, 0, 1), true)).toBe("note\nplain");
  });
});

describe("a block of cells, made by dragging from one to another", () => {
  test("dragging right along a row takes the cells between", () => {
    const selection = dragTo(cellsFrom(2, 1), 2, 4);

    expect([1, 2, 3, 4].every((column) => isCellSelected(selection, 2, column))).toBe(true);
    expect(isCellSelected(selection, 2, 0)).toBe(false);
    expect(isCellSelected(selection, 2, 5)).toBe(false);
    expect(isCellSelected(selection, 1, 2)).toBe(false);
  });

  test("dragging down a column takes the cells between", () => {
    const selection = dragTo(cellsFrom(1, 3), 4, 3);

    expect([1, 2, 3, 4].every((row) => isCellSelected(selection, row, 3))).toBe(true);
    expect(isCellSelected(selection, 5, 3)).toBe(false);
    expect(isCellSelected(selection, 2, 2)).toBe(false);
  });

  test("dragging across both takes the block with the two cells as its corners", () => {
    const selection = dragTo(cellsFrom(1, 1), 3, 2);

    const inside = [1, 2, 3].flatMap((row) => [1, 2].map((column) => isCellSelected(selection, row, column)));
    expect(inside.every(Boolean)).toBe(true);
    expect(isCellSelected(selection, 4, 1)).toBe(false);
    expect(isCellSelected(selection, 1, 3)).toBe(false);
  });

  test("it works dragging up and to the left just the same", () => {
    const selection = dragTo(cellsFrom(4, 3), 2, 1);

    expect([2, 3, 4].flatMap((row) => [1, 2, 3].map((column) => isCellSelected(selection, row, column))).every(Boolean)).toBe(true);
    expect(isCellSelected(selection, 1, 1)).toBe(false);
  });

  test("dragging back towards where it began takes cells off again, since the start stays where it was", () => {
    let selection = dragTo(cellsFrom(1, 1), 4, 4);
    selection = dragTo(selection, 2, 2);

    expect(isCellSelected(selection, 2, 2)).toBe(true);
    expect(isCellSelected(selection, 3, 3)).toBe(false);
    expect(isCellSelected(selection, 4, 4)).toBe(false);
  });

  test("dragging from nothing starts a block at that cell", () => {
    expect(isCellSelected(dragTo(none, 3, 3), 3, 3)).toBe(true);
  });

  test("the status counts the cells, and says so plainly for one", () => {
    expect(status(cellsFrom(1, 1), ROWS)).toBe("Cell selected");
    expect(status(dragTo(cellsFrom(1, 1), 3, 2), ROWS)).toBe("Cells selected: 6");
    expect(status(dragTo(cellsFrom(1, 1), 1, 4), ROWS)).toBe("Cells selected: 4");
  });

  test("a click that did not move lets go of the cell it was on, if that was the only one selected", () => {
    expect(released(cellsFrom(2, 2), cellsFrom(2, 2)).kind).toBe("none");
  });

  test("a click that was the start of a drag, or on a cell that was not selected, keeps its selection", () => {
    const dragged = dragTo(cellsFrom(2, 2), 2, 3);
    expect(released(cellsFrom(2, 2), dragged)).toEqual(dragged);
    expect(released(none, cellsFrom(2, 2)).kind).toBe("cells");
    expect(released(cellsFrom(5, 5), cellsFrom(2, 2)).kind).toBe("cells");
  });

  test("only the outer edge of the block is outlined, so it reads as one block", () => {
    const block = dragTo(cellsFrom(1, 1), 2, 2);

    expect(cellEdges(block, 1, 1)).toEqual({ top: true, bottom: false, left: true, right: false });
    expect(cellEdges(block, 1, 2)).toEqual({ top: true, bottom: false, left: false, right: true });
    expect(cellEdges(block, 2, 1)).toEqual({ top: false, bottom: true, left: true, right: false });
    expect(cellEdges(block, 2, 2)).toEqual({ top: false, bottom: true, left: false, right: true });
    expect(cellEdges(block, 3, 3)).toBeNull();
  });

  test("a single cell is outlined all the way round", () => {
    expect(cellEdges(cellsFrom(2, 2), 2, 2)).toEqual({ top: true, bottom: true, left: true, right: true });
  });
});

describe("copying a block of cells", () => {
  const result = {
    columns: ["id", "name", "note"],
    rows: [
      ["1", "ada", "x"],
      ["2", "grace", null],
      ["3", 'say "hi"', "z"],
    ],
  };

  test("the cells come as tab-separated lines, only the ones in the block", () => {
    expect(toTsv(result, dragTo(cellsFrom(0, 1), 1, 2), false)).toBe("ada\tx\ngrace\t");
  });

  test("with headers, the names of just those columns come first", () => {
    expect(toTsv(result, dragTo(cellsFrom(0, 1), 1, 2), true)).toBe("name\tnote\nada\tx\ngrace\t");
  });

  test("a block that runs along a row is one line, and along a column is one value to a line", () => {
    expect(toTsv(result, dragTo(cellsFrom(1, 0), 1, 2), false)).toBe("2\tgrace\t");
    expect(toTsv(result, dragTo(cellsFrom(0, 1), 2, 1), false)).toBe('ada\ngrace\n"say ""hi"""');
  });

  test("it does not matter which corner the drag began at", () => {
    expect(toTsv(result, dragTo(cellsFrom(1, 2), 0, 1), false)).toBe("ada\tx\ngrace\t");
  });
});

describe("the cells of a block", () => {
  test("every cell is listed, row by row", () => {
    const block = dragTo(cellsFrom(1, 2), 2, 3);

    expect(selectedCells(block)).toEqual([
      { row: 1, column: 2 },
      { row: 1, column: 3 },
      { row: 2, column: 2 },
      { row: 2, column: 3 },
    ]);
  });

  test("a block dragged upwards and to the left lists the same cells", () => {
    expect(selectedCells(dragTo(cellsFrom(2, 3), 1, 2))).toHaveLength(4);
  });

  test("nothing, rows and columns have no cells", () => {
    expect(selectedCells(none)).toEqual([]);
    expect(selectedCells(clickRow(none, 1, plain, ROWS))).toEqual([]);
    expect(selectedCells(clickColumn(none, 1, plain))).toEqual([]);
  });
});

describe("what a selection projects", () => {
  test("a block picks its rows and its columns, rows only rows, columns only columns, and nothing picks all", () => {
    expect(projection(dragTo(cellsFrom(3, 2), 1, 0), ROWS)).toEqual({ rows: [1, 2, 3], columns: [0, 1, 2] });
    expect(projection(clickRow(clickRow(none, 4, plain, ROWS), 1, { toggle: true, range: false }, ROWS), ROWS)).toEqual({ rows: [1, 4], columns: null });
    expect(projection(clickColumn(clickColumn(none, 3, plain), 0, { toggle: true, range: false }), ROWS)).toEqual({ rows: null, columns: [0, 3] });
    expect(projection(none, ROWS)).toEqual({ rows: null, columns: null });
  });
});

describe("what is hidden is never part of a selection", () => {
  const hidden = { rows: new Set([1]), columns: new Set([1]) };
  const result = { columns: ["id", "name", "email"], rows: [["1", "ada", "a@x"], ["2", "grace", "g@x"], ["3", "alan", "t@x"]] };
  const block = dragTo(cellsFrom(0, 0), 2, 2);

  test("rows picked by a range, or all of them, leave out those hidden", () => {
    expect(selectedRows(clickRow(clickRow(none, 0, plain, 3), 2, { toggle: false, range: true }, 3), 3, hidden)).toEqual([0, 2]);
    expect(selectedRows(clickCorner(none), 3, hidden)).toEqual([0, 2]);
  });

  test("a block of cells leaves out the hidden rows and columns it spans, in what it counts and what it copies", () => {
    expect(selectedCells(block, hidden)).toEqual([{ row: 0, column: 0 }, { row: 0, column: 2 }, { row: 2, column: 0 }, { row: 2, column: 2 }]);
    expect(cellCount(block, hidden)).toBe(4);
    expect(status(block, 3, hidden)).toBe("Cells selected: 4");
    expect(toTsv(result, block, true, hidden)).toBe("id\temail\n1\ta@x\n3\tt@x");
  });

  test("rows copy without the hidden columns, and columns without the hidden rows", () => {
    expect(toTsv(result, clickCorner(none), false, hidden)).toBe("1\ta@x\n3\tt@x");
    expect(toTsv(result, clickColumn(none, 2, plain), false, hidden)).toBe("a@x\nt@x");
    expect(status(clickCorner(none), 3, hidden)).toBe("Rows selected: 2");
  });

  test("the rows and columns it projects for a graph leave out those hidden", () => {
    expect(projection(block, 3, hidden)).toEqual({ rows: [0, 2], columns: [0, 2] });
  });
});
