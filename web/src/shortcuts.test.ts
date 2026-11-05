import { commandFor, tabForNumber, type Keys } from "./shortcuts";

const press = (key: string, over: Partial<Keys> = {}): Keys => ({ key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...over });
const mac = (key: string, over: Partial<Keys> = {}) => commandFor(press(key, { metaKey: true, ...over }), true);
const other = (key: string, over: Partial<Keys> = {}) => commandFor(press(key, { ctrlKey: true, ...over }), false);

describe("what a key press asks for", () => {
  test("command T opens a tab and command W closes one", () => {
    expect(mac("t")).toEqual({ kind: "new-tab" });
    expect(mac("w")).toEqual({ kind: "close-tab" });
    expect(mac("T")).toEqual({ kind: "new-tab" });
  });

  test("a number goes to that tab", () => {
    expect(mac("1")).toEqual({ kind: "go-to-tab", number: 1 });
    expect(mac("9")).toEqual({ kind: "go-to-tab", number: 9 });
    expect(mac("0")).toBeNull();
  });

  test("backslash splits, and the arrows with option move between the panes", () => {
    expect(mac("\\")).toEqual({ kind: "toggle-split" });
    expect(mac("ArrowLeft", { altKey: true })).toEqual({ kind: "go-to-pane", step: -1 });
    expect(mac("ArrowRight", { altKey: true })).toEqual({ kind: "go-to-pane", step: 1 });
  });

  test("control and tab are the next tab, and with shift the one before, on a Mac too", () => {
    expect(commandFor(press("Tab", { ctrlKey: true }), true)).toEqual({ kind: "next-tab", step: 1 });
    expect(commandFor(press("Tab", { ctrlKey: true, shiftKey: true }), true)).toEqual({ kind: "next-tab", step: -1 });
    expect(other("Tab")).toEqual({ kind: "next-tab", step: 1 });
  });

  test("on another system control is the command key", () => {
    expect(other("t")).toEqual({ kind: "new-tab" });
    expect(other("w")).toEqual({ kind: "close-tab" });
  });

  test("on a Mac control is not the command key, so control T is left alone", () => {
    expect(commandFor(press("t", { ctrlKey: true }), true)).toBeNull();
  });

  test("the keys the editor and the grid have for their own are not taken", () => {
    for (const key of ["c", "a", "b", "z", "Enter", "f", "s"]) expect(mac(key)).toBeNull();
  });

  test("with shift or option added a key is another command, not this one", () => {
    expect(mac("t", { shiftKey: true })).toBeNull();
    expect(mac("w", { altKey: true })).toBeNull();
    expect(mac("1", { shiftKey: true })).toBeNull();
  });

  test("a plain key is nothing", () => {
    expect(commandFor(press("t"), true)).toBeNull();
    expect(commandFor(press("Tab"), true)).toBeNull();
  });
});

describe("which tab a number is", () => {
  test("the nth, counting from one", () => {
    expect(tabForNumber(4, 1)).toBe(0);
    expect(tabForNumber(4, 3)).toBe(2);
  });

  test("nine is the last, however many there are", () => {
    expect(tabForNumber(4, 9)).toBe(3);
    expect(tabForNumber(12, 9)).toBe(11);
  });

  test("a number past the tabs there are is nothing", () => {
    expect(tabForNumber(2, 5)).toBeNull();
    expect(tabForNumber(0, 1)).toBeNull();
  });
});
