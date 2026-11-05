import { prettyJson, tokenizeJson } from "./json";

describe("prettyJson", () => {
  test("lays an object out over lines", () => {
    expect(prettyJson('{"a":1,"b":[true,null]}')).toBe('{\n  "a": 1,\n  "b": [\n    true,\n    null\n  ]\n}');
  });

  test.each(["plain text", "42", '"quoted"', "{not json", ""])("leaves %j alone", (value) => {
    expect(prettyJson(value)).toBeNull();
  });
});

describe("tokenizeJson", () => {
  test("tells keys, strings, numbers and literals apart", () => {
    const tokens = tokenizeJson('{\n  "name": "ada",\n  "age": -3.5e2,\n  "ok": true,\n  "none": null\n}');
    const of = (kind: string) => tokens.filter((token) => token.kind === kind).map((token) => token.text);

    expect(of("key")).toEqual(['"name"', '"age"', '"ok"', '"none"']);
    expect(of("string")).toEqual(['"ada"']);
    expect(of("number")).toEqual(["-3.5e2"]);
    expect(of("literal")).toEqual(["true", "null"]);
  });

  test("a string that looks like a number or a key is still a string", () => {
    const tokens = tokenizeJson('["12", "a: b"]');

    expect(tokens.filter((token) => token.kind === "string").map((token) => token.text)).toEqual(['"12"', '"a: b"']);
    expect(tokens.map((token) => token.text).join("")).toBe('["12", "a: b"]');
  });
});
