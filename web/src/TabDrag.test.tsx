import { act, fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";

import { TabBar, type TabView } from "./TabBar";
import { TabDragProvider } from "./TabDrag";
import type { Drop } from "./tabs";

const view = (id: string): TabView => ({ id, label: `db-${id}`, title: id, environment: null, busy: false });

interface Props {
  panes: string[][];
  onDrop?: (id: string, drop: Drop) => void;
  onNudge?: (id: string, step: 1 | -1) => void;
  onSelect?: (id: string) => void;
}

function Harness({ panes, onDrop = vi.fn(), onNudge = vi.fn(), onSelect = vi.fn() }: Props) {
  return (
    <TabDragProvider labelOf={(id) => `db-${id}`} onDrop={onDrop} onNudge={onNudge}>
      {panes.map((tabs, index) => (
        <div key={index} data-column={index}>
          <TabBar pane={index} tabs={tabs.map(view)} activeId={tabs[0]} onSelect={onSelect} onClose={vi.fn()} onNew={vi.fn()} split={panes.length > 1} />
        </div>
      ))}
    </TabDragProvider>
  );
}

/** Panes of 400 across and 400 high, side by side, with a strip of 30 along the top and tabs of 100 across in it. */
function layout(panes: number) {
  const rect = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom, x: left, y: top, width: right - left, height: bottom - top, toJSON: () => ({}) }) as DOMRect;
  const width = panes === 1 ? 800 : 400;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const holder = this.closest("[data-column]") as HTMLElement | null;
    if (!holder) return rect(0, 0, 0, 0);
    const left = Number(holder.dataset.column) * width;
    if (this === holder) return rect(left, 0, left + width, 400);
    if (this.hasAttribute("data-tab")) {
      const at = [...holder.querySelectorAll("[data-tab]")].indexOf(this);
      return rect(left + at * 100, 0, left + (at + 1) * 100, 30);
    }
    if (this.hasAttribute("data-tabstrip")) return rect(left, 0, left + width, 30);
    return rect(0, 0, 0, 0);
  });
}

const tab = (id: string) => screen.getByRole("tab", { name: new RegExp(`db-${id}`) });
const press = (id: string, at = { x: 150, y: 10 }, extra = {}) => fireEvent.pointerDown(tab(id), { pointerId: 1, button: 0, pointerType: "mouse", clientX: at.x, clientY: at.y, ...extra });
const move = (x: number, y: number) => fireEvent.pointerMove(window, { pointerId: 1, pointerType: "mouse", clientX: x, clientY: y });
const lift = (x: number, y: number) => fireEvent.pointerUp(window, { pointerId: 1, pointerType: "mouse", clientX: x, clientY: y });

beforeEach(() => layout(2));

describe("a press that is not a drag", () => {
  test("a click selects the tab as always and drops nothing", () => {
    const onDrop = vi.fn();
    const onSelect = vi.fn();
    render(<Harness panes={[["a", "b"], ["c"]]} onDrop={onDrop} onSelect={onSelect} />);

    press("b");
    move(152, 11);
    lift(152, 11);
    fireEvent.click(tab("b"));

    expect(onDrop).not.toHaveBeenCalled();
    expect(onSelect).toHaveBeenCalledWith("b");
    expect(screen.queryByTestId("tab-ghost")).not.toBeInTheDocument();
  });

  test("the right button does not start a drag", () => {
    render(<Harness panes={[["a", "b"], ["c"]]} />);

    press("a", { x: 50, y: 10 }, { button: 2 });
    move(450, 10);

    expect(screen.queryByTestId("tab-ghost")).not.toBeInTheDocument();
  });

  test("a press on the close button does not start a drag", () => {
    render(<Harness panes={[["a", "b"], ["c"]]} />);

    fireEvent.pointerDown(screen.getByRole("button", { name: "Close db-a" }), { pointerId: 1, button: 0, clientX: 90, clientY: 10 });
    move(450, 10);

    expect(screen.queryByTestId("tab-ghost")).not.toBeInTheDocument();
  });
});

describe("dragging a tab", () => {
  test("it shows what is being dragged, following the pointer, and marks the tab it came from", () => {
    render(<Harness panes={[["a", "b"], ["c"]]} />);

    press("a", { x: 50, y: 10 });
    move(250, 100);

    const ghost = screen.getByTestId("tab-ghost");
    expect(ghost).toHaveTextContent("db-a");
    expect(ghost.style.left).toBe("250px");
    expect(ghost.style.top).toBe("100px");
    expect(ghost.style.whiteSpace).toBe("nowrap");
    expect(tab("a")).toHaveAttribute("data-dragging", "true");
    expect(tab("b")).not.toHaveAttribute("data-dragging");
  });

  test("a line shows the gap it would go in, in the strip of the pane under the pointer", () => {
    render(<Harness panes={[["a", "b"], ["c", "d"]]} />);

    press("a", { x: 50, y: 10 });
    move(520, 10);

    const line = screen.getByTestId("tab-drop-line");
    expect(line.style.left).toBe("500px");
  });

  test("let go over the other pane's tabs it is dropped at that gap", () => {
    const onDrop = vi.fn();
    render(<Harness panes={[["a", "b"], ["c", "d"]]} onDrop={onDrop} />);

    press("a", { x: 50, y: 10 });
    move(520, 10);
    lift(520, 10);

    expect(onDrop).toHaveBeenCalledWith("a", { kind: "between", pane: 1, at: 1 });
    expect(screen.queryByTestId("tab-ghost")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tab-drop-line")).not.toBeInTheDocument();
  });

  test("let go among the tabs of its own pane it is dropped at that gap", () => {
    const onDrop = vi.fn();
    render(<Harness panes={[["a", "b", "c"], ["d"]]} onDrop={onDrop} />);

    press("a", { x: 50, y: 10 });
    move(290, 10);
    lift(290, 10);

    expect(onDrop).toHaveBeenCalledWith("a", { kind: "between", pane: 0, at: 3 });
  });

  test("let go over the body of the other pane it goes to the end of that pane", () => {
    const onDrop = vi.fn();
    render(<Harness panes={[["a", "b"], ["c", "d"]]} onDrop={onDrop} />);

    press("a", { x: 50, y: 10 });
    move(600, 250);
    lift(600, 250);

    expect(onDrop).toHaveBeenCalledWith("a", { kind: "between", pane: 1, at: 2 });
  });

  test("let go over nothing, or over its own pane's body, nothing is dropped", () => {
    const onDrop = vi.fn();
    render(<Harness panes={[["a", "b"], ["c"]]} onDrop={onDrop} />);

    press("a", { x: 50, y: 10 });
    move(100, 250);
    expect(screen.queryByTestId("tab-drop-line")).not.toBeInTheDocument();
    lift(100, 250);

    press("a", { x: 50, y: 10 });
    move(900, 900);
    lift(900, 900);

    expect(onDrop).not.toHaveBeenCalled();
  });

  test("a click that ends a drag does not also select the tab", () => {
    const onSelect = vi.fn();
    render(<Harness panes={[["a", "b"], ["c"]]} onSelect={onSelect} />);

    press("b", { x: 150, y: 10 });
    move(500, 10);
    lift(500, 10);
    fireEvent.click(tab("b"));

    expect(onSelect).not.toHaveBeenCalled();
  });

  test("Escape gives the drag up", () => {
    const onDrop = vi.fn();
    render(<Harness panes={[["a", "b"], ["c"]]} onDrop={onDrop} />);

    press("a", { x: 50, y: 10 });
    move(450, 10);
    fireEvent.keyDown(window, { key: "Escape" });
    lift(450, 10);

    expect(onDrop).not.toHaveBeenCalled();
    expect(screen.queryByTestId("tab-ghost")).not.toBeInTheDocument();
  });

  test("a cancelled pointer gives the drag up too", () => {
    const onDrop = vi.fn();
    render(<Harness panes={[["a", "b"], ["c"]]} onDrop={onDrop} />);

    press("a", { x: 50, y: 10 });
    move(450, 10);
    fireEvent.pointerCancel(window, { pointerId: 1 });

    expect(screen.queryByTestId("tab-ghost")).not.toBeInTheDocument();
  });

  test("a pointer that is not the one that pressed is ignored", () => {
    render(<Harness panes={[["a", "b"], ["c"]]} />);

    press("a", { x: 50, y: 10 });
    fireEvent.pointerMove(window, { pointerId: 2, clientX: 450, clientY: 10 });

    expect(screen.queryByTestId("tab-ghost")).not.toBeInTheDocument();
  });

  test("a drag stops listening once it is over, so a later move does nothing", () => {
    render(<Harness panes={[["a", "b"], ["c"]]} />);

    press("a", { x: 50, y: 10 });
    move(450, 10);
    lift(450, 10);
    move(460, 10);

    expect(screen.queryByTestId("tab-ghost")).not.toBeInTheDocument();
  });
});

describe("opening a pane of its own", () => {
  test("over the right edge of a window that is not split, an area says it would open beside", () => {
    layout(1);
    render(<Harness panes={[["a", "b", "c"]]} />);

    press("b", { x: 150, y: 10 });
    move(780, 250);

    expect(screen.getByTestId("tab-aside-zone")).toHaveTextContent("Open beside");
  });

  test("let go there it asks for a pane of its own", () => {
    layout(1);
    const onDrop = vi.fn();
    render(<Harness panes={[["a", "b", "c"]]} onDrop={onDrop} />);

    press("b", { x: 150, y: 10 });
    move(780, 250);
    lift(780, 250);

    expect(onDrop).toHaveBeenCalledWith("b", { kind: "aside" });
  });

  test("elsewhere on the body there is no such area", () => {
    layout(1);
    render(<Harness panes={[["a", "b", "c"]]} />);

    press("b", { x: 150, y: 10 });
    move(300, 250);

    expect(screen.queryByTestId("tab-aside-zone")).not.toBeInTheDocument();
  });

  test("once the window is split there is no such area", () => {
    render(<Harness panes={[["a", "b"], ["c"]]} />);

    press("a", { x: 50, y: 10 });
    move(390, 250);

    expect(screen.queryByTestId("tab-aside-zone")).not.toBeInTheDocument();
  });
});

describe("moving a tab without a pointer", () => {
  test("Alt with the right or left arrow moves the tab a place", () => {
    const onNudge = vi.fn();
    render(<Harness panes={[["a", "b", "c"], ["d"]]} onNudge={onNudge} />);

    fireEvent.keyDown(tab("b"), { key: "ArrowRight", altKey: true });
    fireEvent.keyDown(tab("b"), { key: "ArrowLeft", altKey: true });

    expect(onNudge.mock.calls).toEqual([["b", 1], ["b", -1]]);
  });

  test("the arrows alone still only change the tab in front", () => {
    const onNudge = vi.fn();
    const onSelect = vi.fn();
    render(<Harness panes={[["a", "b", "c"], ["d"]]} onNudge={onNudge} onSelect={onSelect} />);

    fireEvent.keyDown(tab("a"), { key: "ArrowRight" });

    expect(onNudge).not.toHaveBeenCalled();
    expect(onSelect).toHaveBeenCalledWith("b");
  });
});

test("a tab bar outside a provider still renders and its tabs can be clicked", () => {
  const onSelect = vi.fn();
  render(<TabBar tabs={[view("a"), view("b")]} activeId="a" onSelect={onSelect} onClose={vi.fn()} onNew={vi.fn()} />);

  act(() => tab("b").click());

  expect(onSelect).toHaveBeenCalledWith("b");
});
