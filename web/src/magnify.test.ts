import { between, HOLD, levelAt, settleLevel } from "./magnify";

test("the surface is drawn between its own place and the window, as far as its level says", () => {
  const own = { left: 100, top: 400, width: 600, height: 300 };
  const full = { left: 24, top: 24, width: 1000, height: 800 };

  expect(between(own, full, 0)).toEqual(own);
  expect(between(own, full, 1)).toEqual(full);
  expect(between(own, full, 0.5)).toEqual({ left: 62, top: 212, width: 800, height: 550 });
});

test("spreading the fingers grows it from where the pinch began, never past the window or below its own place", () => {
  expect(levelAt(0, 1 + HOLD.range / 2)).toBeCloseTo(0.5);
  expect(levelAt(0.5, 1 - HOLD.range / 4)).toBeCloseTo(0.25);
  expect(levelAt(0, 5)).toBe(1);
  expect(levelAt(0.2, 0.1)).toBe(0);
});

test("once the fingers stop it stays put, unless it was barely grown or nearly full", () => {
  expect(settleLevel(0.05)).toBe(0);
  expect(settleLevel(0.4)).toBe(0.4);
  expect(settleLevel(0.95)).toBe(1);
});
