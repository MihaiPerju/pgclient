import { isDateType, readable } from "./readableDates";

test("only date and timestamp columns hold dates to read", () => {
  expect(isDateType("timestamp with time zone")).toBe(true);
  expect(isDateType("timestamp without time zone")).toBe(true);
  expect(isDateType("date")).toBe(true);
  expect(isDateType("time without time zone")).toBe(false);
  expect(isDateType("interval")).toBe(false);
  expect(isDateType("text")).toBe(false);
});

test("a timestamp with a time zone is read in the zone of the screen", () => {
  expect(readable("2026-09-28 12:44:08.659515+00", "UTC")).toBe("Sep 28, 2026, 12:44:08 PM UTC");
  expect(readable("2026-09-28 12:44:08+02", "UTC")).toBe("Sep 28, 2026, 10:44:08 AM UTC");
  expect(readable("2026-09-28 12:44:08+05:30", "UTC")).toBe("Sep 28, 2026, 7:14:08 AM UTC");
});

test("a timestamp without a zone is read as it is, never shifted", () => {
  expect(readable("2026-09-28 12:44:08.5", "America/New_York")).toBe("Sep 28, 2026, 12:44:08 PM");
});

test("a date has no time", () => {
  expect(readable("2026-09-28", "America/New_York")).toBe("Sep 28, 2026");
});

test("what is not a date, such as infinity, is left as it is", () => {
  expect(readable("infinity", "UTC")).toBe("infinity");
  expect(readable("0044-03-15 12:00:00 BC", "UTC")).toBe("0044-03-15 12:00:00 BC");
});
