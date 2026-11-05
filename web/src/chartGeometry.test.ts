import { ago, bandPath, linePath, nearest, scaleFor, stack, ticks } from "./chartGeometry";

const frame = { width: 400, height: 200, left: 40, right: 10, top: 10, bottom: 30 };
const times = [0, 10, 20, 30];
const scale = scaleFor(frame, times, 100);

describe("where things go on the plot", () => {
  test("the oldest moment is at the left edge of the plot and the newest at the right", () => {
    expect(scale.x(0)).toBe(40);
    expect(scale.x(30)).toBe(390);
  });

  test("nothing is at the bottom of the plot and the top of the scale is at the top", () => {
    expect(scale.y(0)).toBe(170);
    expect(scale.y(100)).toBe(10);
    expect(scale.y(50)).toBe(90);
  });

  test("a value above the top of the scale is held at the top, not drawn outside the plot", () => {
    expect(scale.y(500)).toBe(10);
  });

  test("a chart with one point, or none, still has a scale and does not divide by nothing", () => {
    expect(Number.isFinite(scaleFor(frame, [5], 10).x(5))).toBe(true);
    expect(Number.isFinite(scaleFor(frame, [], 10).x(0))).toBe(true);
  });
});

describe("a line", () => {
  test("it goes through every point", () => {
    expect(linePath(times, [0, 50, 100, 50], scale)).toBe("M40.0,170.0L156.7,90.0L273.3,10.0L390.0,90.0");
  });

  test("a gap breaks it in two, and does not draw to nothing", () => {
    expect(linePath(times, [0, null, 100, 50], scale)).toBe("M40.0,170.0M273.3,10.0L390.0,90.0");
  });

  test("with no values there is no line", () => {
    expect(linePath(times, [null, null, null, null], scale)).toBe("");
  });
});

describe("lines stacked on one another", () => {
  test("each is as high as everything under it and itself", () => {
    const stacked = stack([
      { key: "a", label: "a", values: [1, 2, 3] },
      { key: "b", label: "b", values: [10, 20, 30] },
    ]);

    expect(stacked).toEqual([[1, 2, 3], [11, 22, 33]]);
  });

  test("a gap in one adds nothing to the stack, and a gap in all of them is a gap", () => {
    const stacked = stack([
      { key: "a", label: "a", values: [null, 2, null] },
      { key: "b", label: "b", values: [null, null, null] },
    ]);

    expect(stacked).toEqual([[null, 2, null], [null, 2, null]]);
  });
});

describe("the band between two stacked lines", () => {
  test("it is the shape between them, out along the upper one and back along the lower", () => {
    const path = bandPath([0, 10], [50, 50], [10, 10], scaleFor(frame, [0, 10], 100));

    expect(path).toBe("M40.0,90.0L390.0,90.0L390.0,154.0L40.0,154.0Z");
  });

  test("the lowest band sits on the bottom of the plot", () => {
    expect(bandPath([0, 10], [50, 50], null, scaleFor(frame, [0, 10], 100))).toContain("L390.0,170.0L40.0,170.0Z");
  });

  test("a gap ends a band, and the next run is a band of its own", () => {
    const path = bandPath(times, [10, 10, null, 10], null, scale);

    expect(path.match(/M/g)).toHaveLength(2);
  });
});

describe("the point nearest the pointer", () => {
  test("it is the one nearest in time", () => {
    expect(nearest(times, scale, scale.x(20) + 3)).toBe(2);
    expect(nearest(times, scale, 0)).toBe(0);
    expect(nearest(times, scale, 1000)).toBe(3);
  });
});

describe("the axis", () => {
  test("ticks are evenly spaced from the oldest to the newest", () => {
    expect(ticks(0, 100, 5)).toEqual([0, 25, 50, 75, 100]);
    expect(ticks(5, 5, 4)).toEqual([5]);
  });

  test("a span is said as how long ago, down to now, with the seconds while they tell two moments apart", () => {
    expect([0, 12, 90, 125, 1800, 7200].map(ago)).toEqual(["now", "12s ago", "1m 30s ago", "2m 05s ago", "30m ago", "2.0h ago"]);
  });
});
