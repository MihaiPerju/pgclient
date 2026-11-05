import { previewQuery, qualifiedName, quoteIdent } from "./sql";

test("a plain lower-case name is left as it is", () => {
  expect(quoteIdent("people")).toBe("people");
  expect(quoteIdent("order_items_2")).toBe("order_items_2");
});

test("capitals, spaces and odd characters need quotes, and a quote inside is doubled", () => {
  expect(quoteIdent("People")).toBe('"People"');
  expect(quoteIdent("Odd Name")).toBe('"Odd Name"');
  expect(quoteIdent('say "hi"')).toBe('"say ""hi"""');
  expect(quoteIdent("it's")).toBe('"it\'s"');
  expect(quoteIdent("1st")).toBe('"1st"');
});

test("a word Postgres reserves is quoted even when it is plain", () => {
  for (const word of ["user", "order", "group", "table", "select", "limit", "end", "default"]) {
    expect(quoteIdent(word)).toBe(`"${word}"`);
  }
});

test("schema and name are joined with a dot, each quoted as it needs", () => {
  expect(qualifiedName("public", "people")).toBe("public.people");
  expect(qualifiedName("Audit", "user")).toBe('"Audit"."user"');
});

test("the preview looks at the first hundred rows", () => {
  expect(previewQuery("public", "people")).toBe("select * from public.people limit 100;");
});
