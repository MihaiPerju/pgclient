import { DEFAULT_WIDTH, MAX_WIDTH, MIN_WIDTH, fitWidth } from "./columns";

const longest = (width: number) => "x".repeat(width);

test("a column starts out wide enough for a typical value", () => {
  expect(DEFAULT_WIDTH).toBeGreaterThanOrEqual(120);
  expect(DEFAULT_WIDTH).toBeLessThanOrEqual(240);
});

test("fitting a column makes it as wide as its longest value, with room around it", () => {
  const narrow = fitWidth("id", ["1", "22"]);
  const wide = fitWidth("id", [longest(20), "1"]);
  const wider = fitWidth("id", [longest(40)]);

  expect(wide).toBeGreaterThan(narrow);
  expect(wider).toBeGreaterThan(wide);
  expect(wider - wide).toBeGreaterThanOrEqual(20 * 7);
});

test("the name at the top counts too, since it has to be readable", () => {
  expect(fitWidth("a_rather_long_column_name_indeed", ["1"])).toBeGreaterThan(fitWidth("a", ["1"]));
});

test("a missing value is as wide as the word NULL that is shown for it", () => {
  expect(fitWidth("a", [null])).toBe(fitWidth("a", ["NULL"]));
});

test("it never gets narrower than the smallest or wider than the largest", () => {
  expect(fitWidth("a", ["1"])).toBe(MIN_WIDTH);
  expect(fitWidth("a", [longest(5000)])).toBe(MAX_WIDTH);
});

test("only the first rows are measured, so a result of a million rows is fitted at once", () => {
  const rows = [...Array.from({ length: 200 }, () => "1"), longest(100)];

  expect(fitWidth("a", rows)).toBe(MIN_WIDTH);
});
