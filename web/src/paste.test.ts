import { parseTsv, pastedRows } from "./paste";
import { toTsv } from "./selection";
import { clickCorner } from "./selection";

describe("reading pasted text as rows of cells", () => {
  test("a line for each row and a tab between the cells", () => {
    expect(parseTsv("1\tada\n2\tgrace")).toEqual([["1", "ada"], ["2", "grace"]]);
  });

  test("a line break at the end is not a row", () => {
    expect(parseTsv("1\tada\n")).toEqual([["1", "ada"]]);
    expect(parseTsv("1\tada\r\n")).toEqual([["1", "ada"]]);
  });

  test("a carriage return, a line feed, or both end a line", () => {
    expect(parseTsv("a\rb\nc\r\nd")).toEqual([["a"], ["b"], ["c"], ["d"]]);
  });

  test("an empty cell is nothing, which is NULL", () => {
    expect(parseTsv("1\t\t3")).toEqual([["1", null, "3"]]);
    expect(parseTsv("\t2")).toEqual([[null, "2"]]);
    expect(parseTsv("1\t")).toEqual([["1", null]]);
  });

  test("a quoted cell may hold a tab, a line break, and quotes doubled", () => {
    expect(parseTsv('"a\tb"\t"line1\nline2"\t"say ""hi"""')).toEqual([["a\tb", "line1\nline2", 'say "hi"']]);
  });

  test("a quoted empty cell is an empty string and not NULL", () => {
    expect(parseTsv('1\t""\t3')).toEqual([["1", "", "3"]]);
  });

  test("a quote in the middle of a cell is only a quote", () => {
    expect(parseTsv('5" pipe\tok')).toEqual([['5" pipe', "ok"]]);
  });

  test("quoted cells that end a line are read, with the line after them", () => {
    expect(parseTsv('"a"\n"b"')).toEqual([["a"], ["b"]]);
  });

  test("text that does not end in a line break still has its last row", () => {
    expect(parseTsv("1\tada")).toEqual([["1", "ada"]]);
  });

  test("nothing, or only a line break, is no rows", () => {
    expect(parseTsv("")).toEqual([]);
    expect(parseTsv("\n")).toEqual([[null]]);
  });

  test("JSON with its own quotes comes through whole when it was quoted for the clipboard", () => {
    const json = '{"a": "x", "b": [1, 2]}';

    expect(parseTsv(`1\t"${json.replaceAll('"', '""')}"`)).toEqual([["1", json]]);
  });

  test("a value with a tab in it, written by copy, comes back as it was", () => {
    const result = { columns: ["id", "note"], rows: [["1", "a\tb"], ["2", 'say "hi"'], ["3", "two\nlines"], ["4", null], ["5", ""]] as (string | null)[][] };

    const back = parseTsv(toTsv(result, clickCorner({ kind: "none" }), false));

    // An empty string and NULL are both empty on the clipboard, so they come back as NULL, which is the one a spreadsheet would mean.
    expect(back).toEqual([["1", "a\tb"], ["2", 'say "hi"'], ["3", "two\nlines"], ["4", null], ["5", null]]);
  });
});

describe("what a paste is worth adding", () => {
  test("rows with something in them", () => {
    expect(pastedRows("1\tada\n2\tgrace")).toHaveLength(2);
  });

  test("a blank line between rows is not a row", () => {
    expect(pastedRows("1\tada\n\n2\tgrace")).toHaveLength(2);
  });

  test("a row of empty cells that was meant, with several tabs in it, is kept", () => {
    expect(pastedRows("\t\t")).toHaveLength(1);
  });

  test("nothing at all is nothing", () => {
    expect(pastedRows("")).toEqual([]);
    expect(pastedRows("\n\n")).toEqual([]);
  });
});
