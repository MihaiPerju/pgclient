import { ASIDE_SHARE, DRAG_DISTANCE, dropAt, insertionX, startsDrag, type Box, type PaneBoxes } from "./tabDrop";

const box = (left: number, top: number, right: number, bottom: number): Box => ({ left, top, right, bottom });

/** A pane whose strip is 30 high, with tabs 100 wide one after another from the left. */
function pane(left: number, right: number, tabs: number): PaneBoxes {
  return {
    pane: box(left, 0, right, 400),
    strip: box(left, 0, right, 30),
    tabs: Array.from({ length: tabs }, (_, index) => box(left + index * 100, 0, left + (index + 1) * 100, 30)),
  };
}

const alone = [pane(0, 800, 3)];
const split = [pane(0, 400, 3), pane(400, 800, 2)];

describe("when a press becomes a drag", () => {
  test("it is once the pointer has gone far enough, in any direction, so a click stays a click", () => {
    expect(startsDrag({ x: 10, y: 10 }, { x: 12, y: 11 })).toBe(false);
    expect(startsDrag({ x: 10, y: 10 }, { x: 10 + DRAG_DISTANCE, y: 10 })).toBe(true);
    expect(startsDrag({ x: 10, y: 10 }, { x: 10, y: 10 - DRAG_DISTANCE })).toBe(true);
    expect(startsDrag({ x: 10, y: 10 }, { x: 13, y: 14 })).toBe(true);
  });
});

describe("what a place under the pointer means", () => {
  test("over the first half of a tab is the gap before it, and over the second half the gap after it", () => {
    expect(dropAt({ x: 120, y: 10 }, alone, 0)).toEqual({ kind: "between", pane: 0, at: 1 });
    expect(dropAt({ x: 180, y: 10 }, alone, 0)).toEqual({ kind: "between", pane: 0, at: 2 });
  });

  test("before the first tab is the first gap, and past the last is the last", () => {
    expect(dropAt({ x: 2, y: 10 }, alone, 0)).toEqual({ kind: "between", pane: 0, at: 0 });
    expect(dropAt({ x: 700, y: 10 }, alone, 0)).toEqual({ kind: "between", pane: 0, at: 3 });
  });

  test("over the strip of the other pane is a gap in it", () => {
    expect(dropAt({ x: 450, y: 10 }, split, 0)).toEqual({ kind: "between", pane: 1, at: 0 });
    expect(dropAt({ x: 520, y: 10 }, split, 0)).toEqual({ kind: "between", pane: 1, at: 1 });
  });

  test("an empty strip has one gap", () => {
    expect(dropAt({ x: 10, y: 10 }, [pane(0, 800, 0)], 0)).toEqual({ kind: "between", pane: 0, at: 0 });
  });

  test("over the body of the other pane is the end of its tabs, which is where a tab dropped on it goes", () => {
    expect(dropAt({ x: 600, y: 200 }, split, 0)).toEqual({ kind: "between", pane: 1, at: 2 });
    expect(dropAt({ x: 100, y: 200 }, split, 1)).toEqual({ kind: "between", pane: 0, at: 3 });
  });

  test("over the body of its own pane is nothing, since there it is already", () => {
    expect(dropAt({ x: 100, y: 200 }, split, 0)).toBeNull();
    expect(dropAt({ x: 600, y: 200 }, split, 1)).toBeNull();
  });

  test("over the edge of a pane that is alone is off to the side, a pane of its own", () => {
    expect(dropAt({ x: 790, y: 200 }, alone, 0)).toEqual({ kind: "aside" });
    expect(dropAt({ x: 800 * (1 - ASIDE_SHARE) + 1, y: 200 }, alone, 0)).toEqual({ kind: "aside" });
  });

  test("the rest of the body of a pane that is alone is nothing", () => {
    expect(dropAt({ x: 400, y: 200 }, alone, 0)).toBeNull();
    expect(dropAt({ x: 800 * (1 - ASIDE_SHARE) - 1, y: 200 }, alone, 0)).toBeNull();
  });

  test("off to the side is only on the body, so the tabs along the top are still gaps", () => {
    expect(dropAt({ x: 790, y: 10 }, alone, 0)).toEqual({ kind: "between", pane: 0, at: 3 });
  });

  test("outside every pane is nothing", () => {
    expect(dropAt({ x: -5, y: 10 }, alone, 0)).toBeNull();
    expect(dropAt({ x: 100, y: 500 }, alone, 0)).toBeNull();
    expect(dropAt({ x: 100, y: 10 }, [], 0)).toBeNull();
  });
});

describe("where the line that shows a gap is drawn", () => {
  test("a gap before a tab is at its left edge, and a gap after the last is at its right edge", () => {
    expect(insertionX(alone[0], 0)).toBe(0);
    expect(insertionX(alone[0], 1)).toBe(100);
    expect(insertionX(alone[0], 3)).toBe(300);
  });

  test("a pane with no tabs has its gap at the start of its strip", () => {
    expect(insertionX(pane(400, 800, 0), 0)).toBe(400);
  });

  test("a gap beyond the ends is drawn at the end it is nearest", () => {
    expect(insertionX(alone[0], 9)).toBe(300);
    expect(insertionX(alone[0], -3)).toBe(0);
  });
});
