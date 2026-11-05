import { describe, expect, it } from "vitest";

import { toCsv, toJson } from "./exportResult";

describe("toCsv", () => {
  it("writes the header and a line per row", () => {
    expect(toCsv({ columns: ["id", "name"], rows: [["1", "Ada"], ["2", "Bo"]] })).toBe("id,name\r\n1,Ada\r\n2,Bo\r\n");
  });

  it("quotes what would break the line apart", () => {
    expect(toCsv({ columns: ["a"], rows: [["x,y"], ['say "hi"'], ["two\nlines"]] })).toBe('a\r\n"x,y"\r\n"say ""hi"""\r\n"two\nlines"\r\n');
  });

  it("writes a missing value as an empty field", () => {
    expect(toCsv({ columns: ["a", "b"], rows: [[null, "x"]] })).toBe("a,b\r\n,x\r\n");
  });

  it("still writes the header when there are no rows", () => {
    expect(toCsv({ columns: ["a", "b"], rows: [] })).toBe("a,b\r\n");
  });
});

describe("toJson", () => {
  it("writes an object per row, with null for a missing value", () => {
    const json = toJson({ columns: ["id", "note"], rows: [["1", null]] });
    expect(JSON.parse(json)).toEqual([{ id: "1", note: null }]);
  });

  it("numbers the columns that share a name so none is lost", () => {
    const json = toJson({ columns: ["id", "id", "id"], rows: [["1", "2", "3"]] });
    expect(JSON.parse(json)).toEqual([{ id: "1", id_2: "2", id_3: "3" }]);
  });

  it("writes an empty list for no rows", () => {
    expect(JSON.parse(toJson({ columns: ["a"], rows: [] }))).toEqual([]);
  });
});
