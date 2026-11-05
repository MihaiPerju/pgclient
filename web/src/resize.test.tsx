import { fireEvent, render, renderHook, screen, act } from "@testing-library/react";
import { vi } from "vitest";

import { CornerGrip, ResizeHandle, useBoxSize, usePaneSize } from "./resize";

/** A pointer event with a position, which is what a drag is made of. */
const pointer = (element: HTMLElement, type: "pointerdown" | "pointermove" | "pointerup", x: number, y = 0) =>
  fireEvent(element, new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));

function setup(props: Partial<Parameters<typeof ResizeHandle>[0]> = {}) {
  const onResize = vi.fn();
  const onReset = vi.fn();
  const label = props.label ?? "Resize tables panel";
  render(<ResizeHandle orientation="vertical" label={label} size={() => 280} min={180} max={() => 600} onResize={onResize} onReset={onReset} {...props} />);
  return { handle: screen.getByRole("separator", { name: label }), onResize, onReset };
}

describe("the divider", () => {
  test("it is a separator that says which way it runs and how far it can go", () => {
    const { handle } = setup();

    expect(handle).toHaveAttribute("aria-orientation", "vertical");
    expect(handle).toHaveAttribute("aria-valuenow", "280");
    expect(handle).toHaveAttribute("aria-valuemin", "180");
    expect(handle).toHaveAttribute("aria-valuemax", "600");
    expect(handle).toHaveAttribute("tabindex", "0");
  });

  test("dragging moves the pane by as much as the pointer moved", () => {
    const { handle, onResize } = setup();

    pointer(handle, "pointerdown", 100);
    pointer(handle, "pointermove", 160);
    expect(onResize).toHaveBeenLastCalledWith(340);

    pointer(handle, "pointermove", 120);
    expect(onResize).toHaveBeenLastCalledWith(300);
  });

  test("a divider before the pane it sizes grows it as it moves back, by pointer and by arrow", () => {
    const { handle, onResize } = setup({ after: true, label: "Resize row details" });

    pointer(handle, "pointerdown", 500);
    pointer(handle, "pointermove", 440);
    expect(onResize).toHaveBeenLastCalledWith(340);

    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(onResize).toHaveBeenLastCalledWith(296);
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(onResize).toHaveBeenLastCalledWith(264);
  });

  test("a divider that runs across drags up and down", () => {
    const { handle, onResize } = setup({ orientation: "horizontal", label: "Resize editor", size: () => 200 });

    pointer(handle, "pointerdown", 0, 300);
    pointer(handle, "pointermove", 0, 350);

    expect(onResize).toHaveBeenLastCalledWith(250);
  });

  test("it never goes below the smallest size or above the largest", () => {
    const { handle, onResize } = setup();

    pointer(handle, "pointerdown", 500);
    pointer(handle, "pointermove", 0);
    expect(onResize).toHaveBeenLastCalledWith(180);

    pointer(handle, "pointermove", 5000);
    expect(onResize).toHaveBeenLastCalledWith(600);
  });

  test("the largest size is asked for when the drag starts, since the window may have changed since", () => {
    const max = vi.fn(() => 400);
    const { handle, onResize } = setup({ max });

    pointer(handle, "pointerdown", 0);
    pointer(handle, "pointermove", 1000);

    expect(onResize).toHaveBeenLastCalledWith(400);
  });

  test("once the pointer is up, moving it does nothing", () => {
    const { handle, onResize } = setup();

    pointer(handle, "pointerdown", 100);
    pointer(handle, "pointermove", 130);
    pointer(handle, "pointerup", 130);
    onResize.mockClear();
    pointer(handle, "pointermove", 200);

    expect(onResize).not.toHaveBeenCalled();
  });

  test("moving the pointer over it without pressing does nothing", () => {
    const { handle, onResize } = setup();

    pointer(handle, "pointermove", 200);

    expect(onResize).not.toHaveBeenCalled();
  });

  test("while it is being dragged it shows so, and text is not selected by accident", () => {
    const { handle } = setup();

    pointer(handle, "pointerdown", 100);
    expect(handle).toHaveAttribute("data-active", "true");
    expect(document.body.style.userSelect).toBe("none");

    pointer(handle, "pointerup", 100);
    expect(handle).not.toHaveAttribute("data-active", "true");
    expect(document.body.style.userSelect).not.toBe("none");
  });

  test("the arrow keys along its axis move it a step, and shift takes a bigger one", () => {
    const { handle, onResize } = setup();

    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(onResize).toHaveBeenLastCalledWith(296);

    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(onResize).toHaveBeenLastCalledWith(264);

    fireEvent.keyDown(handle, { key: "ArrowRight", shiftKey: true });
    expect(onResize).toHaveBeenLastCalledWith(344);
  });

  test("a divider that runs across answers to up and down, and not to left and right", () => {
    const { handle, onResize } = setup({ orientation: "horizontal", label: "Resize editor", size: () => 200 });

    fireEvent.keyDown(handle, { key: "ArrowDown" });
    expect(onResize).toHaveBeenLastCalledWith(216);
    fireEvent.keyDown(handle, { key: "ArrowUp" });
    expect(onResize).toHaveBeenLastCalledWith(184);

    onResize.mockClear();
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(onResize).not.toHaveBeenCalled();
  });

  test("home and end go to the smallest and the largest, and the keys stop at those limits", () => {
    const { handle, onResize } = setup();

    fireEvent.keyDown(handle, { key: "Home" });
    expect(onResize).toHaveBeenLastCalledWith(180);
    fireEvent.keyDown(handle, { key: "End" });
    expect(onResize).toHaveBeenLastCalledWith(600);
  });

  test("the keys cannot push it past a limit", () => {
    const { handle, onResize } = setup({ size: () => 600 });

    fireEvent.keyDown(handle, { key: "ArrowRight" });

    expect(onResize).toHaveBeenLastCalledWith(600);
  });

  test("a double click puts it back to how it started", () => {
    const { handle, onReset } = setup();

    fireEvent.doubleClick(handle);

    expect(onReset).toHaveBeenCalledTimes(1);
  });

  test("a click on it does not reach whatever is behind it, since it is only ever for dragging", () => {
    const behind = vi.fn();
    render(
      <div onClick={behind}>
        <ResizeHandle orientation="vertical" label="grip" size={() => 100} min={10} max={() => 500} onResize={vi.fn()} />
      </div>,
    );

    fireEvent.click(screen.getByRole("separator", { name: "grip" }));

    expect(behind).not.toHaveBeenCalled();
  });

  test("it can be given a look of its own, and left out of the tab order", () => {
    const { handle } = setup({ className: "pg-grip", focusable: false });

    expect(handle).toHaveClass("pg-grip");
    expect(handle).not.toHaveClass("pg-handle");
    expect(handle).toHaveAttribute("tabindex", "-1");
  });

  test("other keys are left alone", () => {
    const { handle, onResize } = setup();

    fireEvent.keyDown(handle, { key: "a" });

    expect(onResize).not.toHaveBeenCalled();
  });
});

describe("remembering a size", () => {
  const KEY = "pgclient.testPane";

  test("with nothing stored there is no size, so the pane keeps its default", () => {
    const { result } = renderHook(() => usePaneSize(KEY));

    expect(result.current.size).toBeNull();
  });

  test("a size that is set is kept, and found again next time", () => {
    const first = renderHook(() => usePaneSize(KEY));
    act(() => first.result.current.setSize(312.4));
    expect(first.result.current.size).toBe(312);
    first.unmount();

    const second = renderHook(() => usePaneSize(KEY));

    expect(second.result.current.size).toBe(312);
    expect(localStorage.getItem(KEY)).toBe("312");
  });

  test("resetting forgets it", () => {
    const { result } = renderHook(() => usePaneSize(KEY));
    act(() => result.current.setSize(300));

    act(() => result.current.reset());

    expect(result.current.size).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  test("something in storage that is not a sensible size is ignored", () => {
    for (const junk of ["abc", "-5", "0", "Infinity", ""]) {
      localStorage.setItem(KEY, junk);

      expect(renderHook(() => usePaneSize(KEY)).result.current.size).toBeNull();
    }
  });
});


describe("the corner grip, which changes width and height together", () => {
  const MIN = { width: 200, height: 100 };

  function grip(props: Partial<Parameters<typeof CornerGrip>[0]> = {}) {
    const onResize = vi.fn();
    const onReset = vi.fn();
    render(<CornerGrip label="Resize editor" size={() => ({ width: 700, height: 300 })} min={MIN} max={() => ({ width: 1000, height: 600 })} onResize={onResize} onReset={onReset} {...props} />);
    return { handle: screen.getByRole("separator", { name: "Resize editor" }), onResize, onReset };
  }

  test("dragging changes both by as much as the pointer moved", () => {
    const { handle, onResize } = grip();

    pointer(handle, "pointerdown", 100, 100);
    pointer(handle, "pointermove", 150, 170);

    expect(onResize).toHaveBeenLastCalledWith({ width: 750, height: 370 });
  });

  test("a box centred on the page gets twice the width, so its edge keeps up with the pointer", () => {
    const { handle, onResize } = grip({ widthPerPixel: 2 });

    pointer(handle, "pointerdown", 100, 100);
    pointer(handle, "pointermove", 150, 100);

    expect(onResize).toHaveBeenLastCalledWith({ width: 800, height: 300 });
  });

  test("it never goes below the smallest size or above the largest", () => {
    const { handle, onResize } = grip();

    pointer(handle, "pointerdown", 500, 500);
    pointer(handle, "pointermove", 0, 0);
    expect(onResize).toHaveBeenLastCalledWith({ width: 200, height: 100 });

    pointer(handle, "pointermove", 5000, 5000);
    expect(onResize).toHaveBeenLastCalledWith({ width: 1000, height: 600 });
  });

  test("moving with no button down does nothing, and nothing happens after the drag ends", () => {
    const { handle, onResize } = grip();

    pointer(handle, "pointermove", 50, 50);
    pointer(handle, "pointerdown", 0, 0);
    pointer(handle, "pointerup", 0, 0);
    pointer(handle, "pointermove", 50, 50);

    expect(onResize).not.toHaveBeenCalled();
  });

  test("the arrow keys resize it, and a double click puts it back", () => {
    const { handle, onResize, onReset } = grip();

    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(onResize).toHaveBeenLastCalledWith({ width: 716, height: 300 });
    fireEvent.keyDown(handle, { key: "ArrowUp", shiftKey: true });
    expect(onResize).toHaveBeenLastCalledWith({ width: 700, height: 236 });
    fireEvent.doubleClick(handle);

    expect(onReset).toHaveBeenCalled();
  });
});

describe("the size of a box that was dragged", () => {
  test("it is nothing until a person sets one, and then it is kept for next time", () => {
    const first = renderHook(() => useBoxSize("pg.box"));
    expect(first.result.current.box).toBeNull();

    act(() => first.result.current.setBox({ width: 800.4, height: 350.6 }));
    expect(first.result.current.box).toEqual({ width: 800, height: 351 });

    expect(renderHook(() => useBoxSize("pg.box")).result.current.box).toEqual({ width: 800, height: 351 });
  });

  test("it can be put back, and nonsense that was stored is ignored", () => {
    localStorage.setItem("pg.box", "not json");
    expect(renderHook(() => useBoxSize("pg.box")).result.current.box).toBeNull();

    const { result } = renderHook(() => useBoxSize("pg.other"));
    act(() => result.current.setBox({ width: 500, height: 200 }));
    act(() => result.current.reset());

    expect(result.current.box).toBeNull();
    expect(localStorage.getItem("pg.other")).toBeNull();
  });
});
