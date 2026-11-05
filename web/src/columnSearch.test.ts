import { matchingColumns, scrollLeftFor, splitMatch, stepMatch } from "./columnSearch";

const names = ["id", "service_id", "rollout_status", "created_at", "status", "Rollout_Phase"];

describe("which columns match", () => {
  test("those with the text anywhere in the name, in the order shown", () => {
    expect(matchingColumns(names, "status")).toEqual([2, 4]);
  });

  test("whatever the case, on either side", () => {
    expect(matchingColumns(names, "ROLLOUT")).toEqual([2, 5]);
    expect(matchingColumns(names, "rollout")).toEqual([2, 5]);
  });

  test("spaces around the text do not count", () => {
    expect(matchingColumns(names, "  status ")).toEqual([2, 4]);
  });

  test("nothing typed, or only spaces, matches nothing rather than everything", () => {
    expect(matchingColumns(names, "")).toEqual([]);
    expect(matchingColumns(names, "   ")).toEqual([]);
  });

  test("a name that is not there matches nothing", () => {
    expect(matchingColumns(names, "zzz")).toEqual([]);
  });

  test("characters that mean something in a pattern are only characters", () => {
    expect(matchingColumns(["a.b", "axb", "a(b"], ".")).toEqual([0]);
    expect(matchingColumns(["a.b", "axb", "a(b"], "(")).toEqual([2]);
  });

  test("a column with no name at all is not a match, and does not stop the others", () => {
    expect(matchingColumns(["", "id"], "id")).toEqual([1]);
  });
});

describe("stepping from match to match", () => {
  const matches = [2, 4, 5];

  test("with none current, forward is the first and back is the last", () => {
    expect(stepMatch(matches, null, 1)).toBe(2);
    expect(stepMatch(matches, null, -1)).toBe(5);
  });

  test("forward goes to the next, and round to the first after the last", () => {
    expect(stepMatch(matches, 2, 1)).toBe(4);
    expect(stepMatch(matches, 5, 1)).toBe(2);
  });

  test("back goes to the one before, and round to the last before the first", () => {
    expect(stepMatch(matches, 4, -1)).toBe(2);
    expect(stepMatch(matches, 2, -1)).toBe(5);
  });

  test("a current column that is no longer a match starts again from the end that was asked for", () => {
    expect(stepMatch(matches, 3, 1)).toBe(2);
    expect(stepMatch(matches, 3, -1)).toBe(5);
  });

  test("no matches is no step", () => {
    expect(stepMatch([], null, 1)).toBeNull();
    expect(stepMatch([], 3, -1)).toBeNull();
  });

  test("a single match is stepped back to itself", () => {
    expect(stepMatch([7], 7, 1)).toBe(7);
    expect(stepMatch([7], 7, -1)).toBe(7);
  });
});

describe("showing which letters matched", () => {
  test("the part before, the match with the case it has, and the part after", () => {
    expect(splitMatch("Rollout_Phase", "out")).toEqual(["Roll", "out", "_Phase"]);
  });

  test("the first place when there are several", () => {
    expect(splitMatch("status_status", "status")).toEqual(["", "status", "_status"]);
  });

  test("nothing when it does not match, or nothing was typed", () => {
    expect(splitMatch("id", "zz")).toBeNull();
    expect(splitMatch("id", "")).toBeNull();
  });
});

describe("how far to scroll to a column", () => {
  const widths = [180, 180, 180, 180, 180, 180, 180, 180, 180, 180];
  const view = 800;
  const counter = 52;

  test("a column far to the right is centred in the room beside the row numbers", () => {
    // Column 7 starts at 1260 and is 180 wide; the room is 748, so it is centred with 284 either side.
    expect(scrollLeftFor(widths, 7, view, counter, 0)).toBe(976);
  });

  test("a column in view already, clear of the row numbers, leaves the grid where it is", () => {
    expect(scrollLeftFor(widths, 2, view, counter, 0)).toBe(0);
    expect(scrollLeftFor(widths, 5, view, counter, 400)).toBe(400);
  });

  test("a column that is partly under the row numbers is brought out from under them", () => {
    expect(scrollLeftFor(widths, 3, view, counter, 600)).toBeLessThan(600);
  });

  test("a column that is partly past the right edge is brought in", () => {
    expect(scrollLeftFor(widths, 4, view, counter, 0)).toBeGreaterThan(0);
  });

  test("it never goes past where the grid ends", () => {
    // Everything is 52 + 1800 = 1852 wide in a window of 800, so 1052 is as far as it goes.
    expect(scrollLeftFor(widths, 9, view, counter, 0)).toBe(1052);
  });

  test("it never goes before the start", () => {
    expect(scrollLeftFor(widths, 0, view, counter, 300)).toBe(0);
  });

  test("a column wider than the room starts at the row numbers, and does not scroll past its own start", () => {
    const wide = [180, 1200, 180];

    expect(scrollLeftFor(wide, 1, view, counter, 0)).toBe(180);
  });

  test("a grid that fits in the window does not scroll", () => {
    expect(scrollLeftFor([100, 100], 1, 800, 52, 0)).toBe(0);
  });
});
