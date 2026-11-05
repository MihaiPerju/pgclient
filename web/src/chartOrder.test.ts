import { chartAt, moveBefore, moveBy, moveTo, ordered } from "./chartOrder";

const known = ["a", "b", "c", "d"];

describe("the order of the charts", () => {
  test("is the one remembered, with charts it has not heard of added at the end and ones that are gone left out", () => {
    expect(ordered(known, ["c", "x", "a"])).toEqual(["c", "a", "b", "d"]);
  });

  test("is the default when nothing was remembered, or what was is not a list", () => {
    expect(ordered(known, null)).toEqual(known);
    expect(ordered(known, "c")).toEqual(known);
  });

  test("a chart dropped on another goes in front of it, whether it came from before or after", () => {
    expect(moveBefore(known, "d", "b")).toEqual(["a", "d", "b", "c"]);
    expect(moveBefore(known, "a", "c")).toEqual(["b", "a", "c", "d"]);
  });

  test("a chart dropped on itself, or on one that is not there, stays where it is", () => {
    expect(moveBefore(known, "b", "b")).toBe(known);
    expect(moveBefore(known, "b", "x")).toBe(known);
  });

  test("a chart is moved a place at a time by the keyboard, and stops at either end", () => {
    expect(moveBy(known, "b", 1)).toEqual(["a", "c", "b", "d"]);
    expect(moveBy(known, "b", -1)).toEqual(["b", "a", "c", "d"]);
    expect(moveBy(known, "a", -1)).toBe(known);
    expect(moveBy(known, "d", 1)).toBe(known);
  });
});

test("a chart is put at a place in the order, and a place past either end is the end", () => {
  expect(moveTo(known, "a", 2)).toEqual(["b", "c", "a", "d"]);
  expect(moveTo(known, "d", 0)).toEqual(["d", "a", "b", "c"]);
  expect(moveTo(known, "b", 1)).toBe(known);
  expect(moveTo(known, "b", 99)).toEqual(["a", "c", "d", "b"]);
});

describe("the chart under the pointer", () => {
  const rects = [
    { id: "a", left: 0, top: 0, width: 100, height: 50 },
    { id: "b", left: 110, top: 0, width: 100, height: 50 },
  ];

  test("is the one whose box the point is in", () => {
    expect(chartAt(rects, 150, 20)).toBe("b");
    expect(chartAt(rects, 5, 5)).toBe("a");
  });

  test("is none in the gap between them, or outside them", () => {
    expect(chartAt(rects, 105, 20)).toBeNull();
    expect(chartAt(rects, 50, 80)).toBeNull();
  });
});
