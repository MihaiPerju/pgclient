import { canHide, hiddenSummary, hideSelected, inView, nothingHidden } from "./hiding";
import { cellsFrom, clickColumn, clickRow, none } from "./selection";

const plain = { toggle: false, range: false };
const also = { toggle: true, range: false };

test("hiding takes the picked rows, or the picked columns, out of view, adding to what is already hidden", () => {
  const rows = clickRow(clickRow(none, 1, plain, 5), 3, also, 5);
  const once = hideSelected(nothingHidden, rows, 5);
  expect([...once.rows].sort()).toEqual([1, 3]);
  expect(once.columns.size).toBe(0);

  const twice = hideSelected(once, clickColumn(none, 0, plain), 5);
  expect([...twice.rows].sort()).toEqual([1, 3]);
  expect([...twice.columns]).toEqual([0]);
});

test("only rows and columns can be hidden, not a block of cells, which is neither", () => {
  expect(canHide(clickRow(none, 1, plain, 5))).toBe(true);
  expect(canHide(clickColumn(none, 1, plain))).toBe(true);
  expect(canHide(cellsFrom(1, 1))).toBe(false);
  expect(canHide(none)).toBe(false);
  expect(hideSelected(nothingHidden, cellsFrom(1, 1), 5)).toBe(nothingHidden);
});

test("what is in view is every line but the hidden, in order", () => {
  expect(inView(5, new Set([1, 3]))).toEqual([0, 2, 4]);
  expect(inView(3, new Set())).toEqual([0, 1, 2]);
});

test("what is hidden is said in a few words, or not at all", () => {
  expect(hiddenSummary(nothingHidden)).toBeNull();
  expect(hiddenSummary({ rows: new Set([1, 2]), columns: new Set([0]) })).toBe("2 rows · 1 column hidden");
  expect(hiddenSummary({ rows: new Set(), columns: new Set([0, 4]) })).toBe("2 columns hidden");
});
