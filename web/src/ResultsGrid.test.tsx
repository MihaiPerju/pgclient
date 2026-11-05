import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

import { DEFAULT_WIDTH, MIN_WIDTH, fitWidth } from "./columns";
import type { Pending } from "./changes";
import type { ResultSource } from "./gateway";
import { ResultsGrid } from "./ResultsGrid";
import type { ResultSet } from "./results";

const result: ResultSet = {
  columns: ["id", "name"],
  rows: [
    ["1", "ada"],
    ["2", null],
    ["3", "grace"],
    ["4", "alan"],
  ],
  rowsAffected: 4,
};

const counter = (n: number) => screen.getByRole("rowheader", { name: String(n) });
const header = (name: string) => screen.getByRole("columnheader", { name });
const corner = () => screen.getByRole("columnheader", { name: "Select all rows" });
const cell = (text: string) => screen.getByText(text).closest('[role="cell"]') as HTMLElement;
/** The cell in a given row (counting from 1) and column (from 0), for values that also appear as a row number. */
const cellAt = (row: number, column: number) => within(screen.getAllByRole("row")[row]).getAllByRole("cell")[column];
const copyWithHeaders = () => screen.getByRole("button", { name: "Copy with headers" });

/** Clicks while holding a key down, as a hand on the keyboard would. */
async function clickWith(user: ReturnType<typeof userEvent.setup>, key: "Meta" | "Shift", element: HTMLElement) {
  await user.keyboard(`{${key}>}`);
  await user.click(element);
  await user.keyboard(`{/${key}}`);
}

const setup = (shown: ResultSet = result) => {
  const user = userEvent.setup();
  const view = render(<ResultsGrid result={shown} />);
  return { user, ...view };
};

describe("a counter column down the left, like pgAdmin's", () => {
  test("it numbers the rows from one", () => {
    setup();

    expect([1, 2, 3, 4].map((n) => counter(n).textContent)).toEqual(["1", "2", "3", "4"]);
  });

  test("the counter column has a header of its own, which is the corner", () => {
    setup();

    expect(corner()).toBeInTheDocument();
  });
});

describe("picking a column", () => {
  test("clicking its name highlights it from top to bottom, and says so", async () => {
    const { user } = setup();

    await user.click(header("name"));

    expect(header("name")).toHaveAttribute("aria-selected", "true");
    expect(header("id")).not.toHaveAttribute("aria-selected", "true");
    expect(cell("ada")).toHaveAttribute("data-selected", "true");
    expect(cell("grace")).toHaveAttribute("data-selected", "true");
    expect(cellAt(1, 0)).not.toHaveAttribute("data-selected", "true");
    expect(screen.getByText("Columns selected: 1")).toBeInTheDocument();
  });

  test("command-click adds a second column", async () => {
    const { user } = setup();
    await user.click(header("id"));

    await clickWith(user, "Meta", header("name"));

    expect(screen.getByText("Columns selected: 2")).toBeInTheDocument();
  });
});

describe("picking rows", () => {
  test("clicking a counter selects that row only", async () => {
    const { user } = setup();

    await user.click(counter(2));

    expect(counter(2)).toHaveAttribute("aria-selected", "true");
    expect(counter(3)).not.toHaveAttribute("aria-selected", "true");
    expect(cell("grace")).not.toHaveAttribute("data-selected", "true");
    expect(screen.getByText("Rows selected: 1")).toBeInTheDocument();
  });

  test("every cell of the chosen row is highlighted", async () => {
    const { user } = setup();

    await user.click(counter(3));

    expect(cell("grace")).toHaveAttribute("data-selected", "true");
    expect(cellAt(3, 0)).toHaveAttribute("data-selected", "true");
  });

  test("command-click adds another row, and shift-click takes a stretch of them", async () => {
    const { user } = setup();
    await user.click(counter(1));
    await clickWith(user, "Meta", counter(3));
    expect(screen.getByText("Rows selected: 2")).toBeInTheDocument();

    await user.click(counter(1));
    await clickWith(user, "Shift", counter(4));
    expect(screen.getByText("Rows selected: 4")).toBeInTheDocument();
  });

  test("clicking the corner selects every row, and again lets them go", async () => {
    const { user } = setup();

    await user.click(corner());
    expect(screen.getByText("Rows selected: 4")).toBeInTheDocument();
    expect(counter(4)).toHaveAttribute("aria-selected", "true");

    await user.click(corner());
    expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
  });

  test("clicking the same row again lets it go", async () => {
    const { user } = setup();
    await user.click(counter(2));

    await user.click(counter(2));

    expect(counter(2)).not.toHaveAttribute("aria-selected", "true");
    expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
  });

  test("clicking the same column name again lets it go", async () => {
    const { user } = setup();
    await user.click(header("name"));

    await user.click(header("name"));

    expect(header("name")).not.toHaveAttribute("aria-selected", "true");
    expect(cell("ada")).not.toHaveAttribute("data-selected", "true");
    expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
  });

  test("picking a row lets go of a column", async () => {
    const { user } = setup();
    await user.click(header("id"));

    await user.click(counter(2));

    expect(header("id")).not.toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Rows selected: 1")).toBeInTheDocument();
  });

  test("escape lets everything go", async () => {
    const { user } = setup();
    await user.click(counter(2));

    await user.keyboard("{Escape}");

    expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
  });

  test("command-A selects every row", async () => {
    const { user } = setup();
    await user.click(counter(1));

    await user.keyboard("{Meta>}a{/Meta}");

    expect(screen.getByText("Rows selected: 4")).toBeInTheDocument();
  });
});

describe("copying", () => {
  test("command-C copies the chosen rows, tab-separated, without headers to begin with", async () => {
    const { user } = setup();
    await user.click(counter(1));
    await clickWith(user, "Meta", counter(2));

    await user.keyboard("{Meta>}c{/Meta}");

    expect(await navigator.clipboard.readText()).toBe("1\tada\n2\t");
  });

  test("a column is copied as a list", async () => {
    const { user } = setup();
    await user.click(header("name"));

    await user.keyboard("{Meta>}c{/Meta}");

    expect(await navigator.clipboard.readText()).toBe("ada\n\ngrace\nalan");
  });

  test("with the headers button on, the column names come first", async () => {
    const { user } = setup();
    expect(copyWithHeaders()).toHaveAttribute("aria-pressed", "false");
    await user.click(copyWithHeaders());
    expect(copyWithHeaders()).toHaveAttribute("aria-pressed", "true");
    await user.click(counter(3));

    await user.keyboard("{Meta>}c{/Meta}");

    expect(await navigator.clipboard.readText()).toBe("id\tname\n3\tgrace");
  });

  test("the choice about headers is remembered", async () => {
    const { user, unmount } = setup();
    await user.click(copyWithHeaders());
    unmount();

    render(<ResultsGrid result={result} />);

    expect(copyWithHeaders()).toHaveAttribute("aria-pressed", "true");
  });

  test("the copy button does the same as command-C, and has nothing to do until something is chosen", async () => {
    const { user } = setup();
    const button = screen.getByRole("button", { name: "Copy" });
    expect(button).toBeDisabled();

    await user.click(counter(4));
    await user.click(button);

    expect(await navigator.clipboard.readText()).toBe("4\talan");
  });

  test("it says what was copied", async () => {
    const { user } = setup();
    await user.click(counter(1));
    await clickWith(user, "Meta", counter(2));

    await user.keyboard("{Meta>}c{/Meta}");

    expect(await screen.findByText("Copied 2 rows")).toBeInTheDocument();
  });

  test("with nothing chosen, command-C is left alone for the browser to copy whatever text is selected", async () => {
    const { user } = setup();
    await navigator.clipboard.writeText("before");
    await user.click(screen.getByRole("table"));

    await user.keyboard("{Meta>}c{/Meta}");

    expect(await navigator.clipboard.readText()).toBe("before");
  });
});

describe("when the browser will not let the page use the clipboard", () => {
  test("the older way of copying is tried, so the copy still happens", async () => {
    const { user } = setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("not allowed"));
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", { value: execCommand, configurable: true });
    await user.click(counter(1));

    await user.keyboard("{Meta>}c{/Meta}");

    expect(await screen.findByText("Copied 1 row")).toBeInTheDocument();
    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  test("if neither way works it says so rather than looking as if it had", async () => {
    const { user } = setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("not allowed"));
    Object.defineProperty(document, "execCommand", { value: vi.fn(() => false), configurable: true });
    await user.click(counter(1));

    await user.keyboard("{Meta>}c{/Meta}");

    expect(await screen.findByText("Could not copy")).toBeInTheDocument();
  });
});

describe("while rows are still arriving", () => {
  test("what was chosen stays chosen as more rows come in", async () => {
    const { user, rerender } = setup();
    await user.click(counter(2));

    rerender(<ResultsGrid result={{ ...result, rows: [...result.rows, ["5", "new"]] }} />);

    expect(counter(2)).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Rows selected: 1")).toBeInTheDocument();
  });

  test("a different result starts with nothing chosen", async () => {
    const { user, rerender } = setup();
    await user.click(counter(2));

    act(() => rerender(<ResultsGrid result={{ columns: ["other"], rows: [["x"]], rowsAffected: 1 }} />));

    expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
  });
});

describe("fine lines between the columns, the same as the ones between rows", () => {
  test("the headers and the cells each have a line on their right, and the counter column too", () => {
    setup();
    const line = (element: HTMLElement) => getComputedStyle(element).borderRightWidth;

    expect(line(header("id"))).toBe("1px");
    expect(line(header("name"))).toBe("1px");
    expect(line(cell("ada"))).toBe("1px");
    expect(line(counter(1))).toBe("1px");
    expect(line(corner())).toBe("1px");
  });
});

/** A pointer event with a position, which is what a drag is made of. */
const pointer = (element: HTMLElement, type: "pointerdown" | "pointermove" | "pointerup", x: number) =>
  fireEvent(element, new MouseEvent(type, { bubbles: true, clientX: x, clientY: 0 }));
const grip = (name: string) => screen.getByRole("separator", { name: `Resize ${name}` });
const drag = (name: string, by: number) => {
  pointer(grip(name), "pointerdown", 500);
  pointer(grip(name), "pointermove", 500 + by);
  pointer(grip(name), "pointerup", 500 + by);
};
const widthOf = (element: HTMLElement) => parseInt(element.style.width, 10);

describe("column widths", () => {
  test("every column has a grip on its right edge to drag", () => {
    setup();

    expect(grip("id")).toBeInTheDocument();
    expect(grip("name")).toBeInTheDocument();
  });

  test("columns start at the same width, and the header and the cells below agree", () => {
    setup();

    expect(widthOf(header("id"))).toBe(DEFAULT_WIDTH);
    expect(widthOf(header("name"))).toBe(DEFAULT_WIDTH);
    expect(widthOf(cellAt(1, 0))).toBe(DEFAULT_WIDTH);
  });

  test("dragging the grip widens that column, cells and all", () => {
    setup();

    drag("id", 60);

    expect(widthOf(header("id"))).toBe(DEFAULT_WIDTH + 60);
    expect(widthOf(cellAt(1, 0))).toBe(DEFAULT_WIDTH + 60);
    expect(widthOf(cellAt(4, 0))).toBe(DEFAULT_WIDTH + 60);
  });

  test("the columns beside it are not made narrower, they are pushed along", () => {
    setup();
    const total = () => parseInt((screen.getByRole("table").firstElementChild as HTMLElement).style.minWidth, 10);
    const before = total();

    drag("id", 60);

    expect(widthOf(header("name"))).toBe(DEFAULT_WIDTH);
    expect(widthOf(cellAt(2, 1))).toBe(DEFAULT_WIDTH);
    expect(total()).toBe(before + 60);
  });

  test("a column can be made narrower too, down to a smallest width", () => {
    setup();

    drag("name", -40);
    expect(widthOf(header("name"))).toBe(DEFAULT_WIDTH - 40);

    drag("name", -5000);
    expect(widthOf(header("name"))).toBe(MIN_WIDTH);
  });

  test("dragging a grip does not select the column it belongs to", async () => {
    setup();

    drag("id", 30);
    fireEvent.click(grip("id"));

    expect(header("id")).not.toHaveAttribute("aria-selected", "true");
    expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
  });

  test("a double click on the grip fits the column to what is in it", () => {
    const wide: ResultSet = { columns: ["id", "name"], rows: [["1", "a-value-that-is-quite-a-lot-longer-than-the-rest"], ["2", "x"]], rowsAffected: 2 };
    setup(wide);

    fireEvent.doubleClick(grip("name"));

    expect(widthOf(header("name"))).toBe(fitWidth("name", ["a-value-that-is-quite-a-lot-longer-than-the-rest", "x"]));
    expect(widthOf(header("id"))).toBe(DEFAULT_WIDTH);
  });

  test("widths are kept as more rows arrive, and start again for a different result", () => {
    const { rerender } = setup();
    drag("id", 60);

    rerender(<ResultsGrid result={{ ...result, rows: [...result.rows, ["5", "new"]] }} />);
    expect(widthOf(header("id"))).toBe(DEFAULT_WIDTH + 60);

    rerender(<ResultsGrid result={{ columns: ["id", "name"], rows: [["1", "a"]], rowsAffected: 1 }} />);
    expect(widthOf(header("id"))).toBe(DEFAULT_WIDTH);
  });

  test("a column that is selected can be resized without losing the selection", async () => {
    const { user } = setup();
    await user.click(header("name"));

    drag("name", 30);

    expect(header("name")).toHaveAttribute("aria-selected", "true");
  });
});

describe("a single cell", () => {
  test("clicking a cell highlights it, and only it", async () => {
    const { user } = setup();

    await user.click(cellAt(2, 1));

    expect(cellAt(2, 1)).toHaveAttribute("data-selected", "true");
    expect(cellAt(2, 0)).not.toHaveAttribute("data-selected", "true");
    expect(cellAt(3, 1)).not.toHaveAttribute("data-selected", "true");
    expect(screen.getByText("Cell selected")).toBeInTheDocument();
  });

  test("clicking another cell moves the highlight", async () => {
    const { user } = setup();
    await user.click(cellAt(1, 0));

    await user.click(cellAt(3, 1));

    expect(cellAt(1, 0)).not.toHaveAttribute("data-selected", "true");
    expect(cellAt(3, 1)).toHaveAttribute("data-selected", "true");
  });

  test("clicking it again lets it go", async () => {
    const { user } = setup();
    await user.click(cellAt(1, 1));

    await user.click(cellAt(1, 1));

    expect(cellAt(1, 1)).not.toHaveAttribute("data-selected", "true");
    expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
  });

  test("command-C copies the value of the cell", async () => {
    const { user } = setup();
    await user.click(cellAt(3, 1));

    await user.keyboard("{Meta>}c{/Meta}");

    expect(await navigator.clipboard.readText()).toBe("grace");
    expect(await screen.findByText("Copied 1 cell")).toBeInTheDocument();
  });

  test("a missing value copies as nothing", async () => {
    const { user } = setup();
    const write = vi.spyOn(navigator.clipboard, "writeText");
    await user.click(cellAt(2, 1));

    await user.keyboard("{Meta>}c{/Meta}");

    expect(write).toHaveBeenCalledWith("");
  });

  test("with the headers button on, the column name comes first", async () => {
    const { user } = setup();
    await user.click(copyWithHeaders());
    await user.click(cellAt(4, 1));

    await user.keyboard("{Meta>}c{/Meta}");

    expect(await navigator.clipboard.readText()).toBe("name\nalan");
  });

  test("the copy button copies it too", async () => {
    const { user } = setup();
    await user.click(cellAt(1, 1));

    await user.click(screen.getByRole("button", { name: "Copy" }));

    expect(await navigator.clipboard.readText()).toBe("ada");
  });

  test("picking a row lets go of the cell, and escape lets go of everything", async () => {
    const { user } = setup();
    await user.click(cellAt(1, 1));

    await user.click(counter(2));
    expect(cellAt(1, 1)).not.toHaveAttribute("data-selected", "true");

    await user.click(cellAt(1, 1));
    await user.keyboard("{Escape}");
    expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
  });
});

describe("dragging across cells", () => {
  /** Holds the button down on one cell, passes over the others, and lets go: which is all a drag is. */
  function dragAcross(from: HTMLElement, ...over: HTMLElement[]) {
    fireEvent.mouseDown(from, { button: 0 });
    for (const element of over) fireEvent.mouseEnter(element);
    fireEvent.mouseUp(window);
  }

  test("dragging along a row selects the cells in it", () => {
    setup();

    dragAcross(cellAt(2, 0), cellAt(2, 1));

    expect(cellAt(2, 0)).toHaveAttribute("data-selected", "true");
    expect(cellAt(2, 1)).toHaveAttribute("data-selected", "true");
    expect(cellAt(1, 1)).not.toHaveAttribute("data-selected", "true");
    expect(screen.getByText("Cells selected: 2")).toBeInTheDocument();
  });

  test("dragging down a column selects the cells in it", () => {
    setup();

    dragAcross(cellAt(1, 1), cellAt(2, 1), cellAt(3, 1));

    expect([1, 2, 3].map((row) => cellAt(row, 1).getAttribute("data-selected"))).toEqual(["true", "true", "true"]);
    expect(cellAt(4, 1)).not.toHaveAttribute("data-selected", "true");
    expect(cellAt(2, 0)).not.toHaveAttribute("data-selected", "true");
    expect(screen.getByText("Cells selected: 3")).toBeInTheDocument();
  });

  test("dragging diagonally selects the block between the two corners", () => {
    setup();

    dragAcross(cellAt(1, 0), cellAt(2, 0), cellAt(2, 1));

    for (const [row, column] of [[1, 0], [1, 1], [2, 0], [2, 1]]) expect(cellAt(row, column)).toHaveAttribute("data-selected", "true");
    expect(cellAt(3, 0)).not.toHaveAttribute("data-selected", "true");
    expect(screen.getByText("Cells selected: 4")).toBeInTheDocument();
  });

  test("the selection follows the pointer while the button is down, and can shrink again", () => {
    setup();
    fireEvent.mouseDown(cellAt(1, 0), { button: 0 });

    fireEvent.mouseEnter(cellAt(3, 1));
    expect(screen.getByText("Cells selected: 6")).toBeInTheDocument();

    fireEvent.mouseEnter(cellAt(2, 0));
    expect(screen.getByText("Cells selected: 2")).toBeInTheDocument();
    fireEvent.mouseUp(window);
  });

  test("once the button is up, passing over cells changes nothing", () => {
    setup();
    dragAcross(cellAt(1, 0), cellAt(1, 1));

    fireEvent.mouseEnter(cellAt(4, 1));

    expect(screen.getByText("Cells selected: 2")).toBeInTheDocument();
  });

  test("letting go outside the grid still ends the drag", () => {
    setup();
    fireEvent.mouseDown(cellAt(1, 0), { button: 0 });
    fireEvent.mouseUp(document.body);

    fireEvent.mouseEnter(cellAt(4, 1));

    expect(screen.queryByText(/Cells selected/)).not.toBeInTheDocument();
  });

  test("passing over cells without the button down selects nothing", () => {
    setup();

    fireEvent.mouseEnter(cellAt(2, 1));

    expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
  });

  test("the drag does not select text on the page, and leaves the grid ready for the keyboard", () => {
    setup();

    const allowed = fireEvent.mouseDown(cellAt(1, 0), { button: 0 });
    fireEvent.mouseUp(window);

    expect(allowed).toBe(false);
    expect(screen.getByRole("table")).toHaveFocus();
  });

  test("a drag with the right button does nothing", () => {
    setup();

    fireEvent.mouseDown(cellAt(1, 0), { button: 2 });
    fireEvent.mouseEnter(cellAt(2, 1));
    fireEvent.mouseUp(window);

    expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
  });

  test("a click that does not move on a selected cell still lets it go, and a drag does not", async () => {
    const { user } = setup();
    await user.click(cellAt(1, 1));
    await user.click(cellAt(1, 1));
    expect(screen.queryByText(/selected/)).not.toBeInTheDocument();

    dragAcross(cellAt(1, 1), cellAt(1, 1));
    expect(screen.getByText("Cell selected")).toBeInTheDocument();
  });

  test("shift-click on another cell takes the block from the one already selected", async () => {
    const { user } = setup();
    await user.click(cellAt(1, 0));

    await clickWith(user, "Shift", cellAt(3, 1));

    expect(screen.getByText("Cells selected: 6")).toBeInTheDocument();
    expect(cellAt(2, 1)).toHaveAttribute("data-selected", "true");
  });

  test("command-C copies the block as tab-separated lines", async () => {
    const { user } = setup();
    dragAcross(cellAt(1, 0), cellAt(2, 0), cellAt(2, 1));

    await user.keyboard("{Meta>}c{/Meta}");

    expect(await navigator.clipboard.readText()).toBe("1\tada\n2\t");
    expect(await screen.findByText("Copied 4 cells")).toBeInTheDocument();
  });

  test("with the headers button on, the names of the columns in the block come first", async () => {
    const { user } = setup();
    await user.click(copyWithHeaders());
    dragAcross(cellAt(3, 0), cellAt(4, 0), cellAt(4, 1));

    await user.keyboard("{Meta>}c{/Meta}");

    expect(await navigator.clipboard.readText()).toBe("id\tname\n3\tgrace\n4\talan");
  });

  test("the block is outlined round its outer edge only", () => {
    setup();

    dragAcross(cellAt(1, 0), cellAt(2, 0), cellAt(2, 1));

    const ring = (element: HTMLElement) => element.style.boxShadow;
    expect(ring(cellAt(1, 0))).toContain("inset");
    expect(ring(cellAt(3, 0))).toBe("");
    expect(ring(cellAt(1, 0))).not.toBe(ring(cellAt(1, 1)));
  });

  test("choosing a row, a column or the corner afterwards lets go of the block", async () => {
    const { user } = setup();
    dragAcross(cellAt(1, 0), cellAt(2, 1));

    await user.click(counter(3));

    expect(cellAt(1, 0)).not.toHaveAttribute("data-selected", "true");
    expect(screen.getByText("Rows selected: 1")).toBeInTheDocument();
  });
});

describe("JSON cells", () => {
  const json: ResultSet = { columns: ["id", "doc"], rows: [["1", '{"name":"ada","tags":["a"]}'], ["2", "plain"]], rowsAffected: 2 };

  test("double-clicking one opens it laid out, and a plain value does nothing", async () => {
    render(<ResultsGrid result={json} />);

    await userEvent.dblClick(cellAt(2, 1));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await userEvent.dblClick(cellAt(1, 1));
    const view = await screen.findByLabelText("JSON text");
    expect(view.textContent).toBe('{\n  "name": "ada",\n  "tags": [\n    "a"\n  ]\n}');
  });
});

describe("deleting and editing rows, which are written only once saved", () => {
  const source: ResultSource = {
    state: "editable",
    schema: "public",
    table: "people",
    columns: [
      { name: "id", data_type: "integer", nullable: false, has_default: true },
      { name: "name", data_type: "text", nullable: true, has_default: false },
    ],
    key: ["id"],
  };
  const editable: ResultSet = { ...result, source };
  const deleteButton = () => screen.getByRole("button", { name: "Delete" });
  const row = (n: number) => screen.getAllByRole("row")[n];

  const open = (shown: ResultSet = editable, onSave = vi.fn(async (_pending: Pending) => {})) => {
    const user = userEvent.setup();
    render(<ResultsGrid result={shown} onSave={onSave} />);
    return { user, onSave };
  };

  test("a result that cannot be saved has no Delete", () => {
    setup();

    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  test("Delete sits right after Copy with headers, and waits for rows to be picked", () => {
    open();

    expect(copyWithHeaders().nextElementSibling).toBe(deleteButton());
    expect(deleteButton()).toBeDisabled();
    expect(deleteButton()).toHaveAttribute("title", "Select rows to delete");
  });

  test("a result that is read only says why Delete is not there to use", () => {
    open({ ...result, source: { state: "read_only", reason: "people has no primary key" } });

    expect(deleteButton()).toBeDisabled();
    expect(deleteButton()).toHaveAttribute("title", "people has no primary key");
  });

  test("a result not yet described says it is being checked", () => {
    open(result);

    expect(deleteButton()).toHaveAttribute("title", expect.stringContaining("Checking"));
  });

  test("Delete crosses the picked rows out, and offers to Save, but writes nothing yet", async () => {
    const { user, onSave } = open();

    await user.click(counter(1));
    await clickWith(user, "Meta", counter(3));
    await user.click(deleteButton());

    expect(row(1)).toHaveAttribute("data-deleted", "true");
    expect(row(2)).not.toHaveAttribute("data-deleted");
    expect(row(3)).toHaveAttribute("data-deleted", "true");
    expect(screen.getByText("2 rows to delete · not saved yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Save/ })).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  test("every row can be crossed out at once from the corner", async () => {
    const { user } = open();

    await user.click(corner());
    await user.click(deleteButton());

    expect(screen.getByText("4 rows to delete · not saved yet")).toBeInTheDocument();
  });

  test("Save hands over what was marked, and is gone once it has been written", async () => {
    const { user, onSave } = open();
    await user.click(counter(2));
    await user.click(deleteButton());

    await user.click(screen.getByRole("button", { name: /Save/ }));

    expect([...onSave.mock.calls[0][0].deleted]).toEqual([1]);
    await waitFor(() => expect(screen.queryByRole("button", { name: /Save/ })).not.toBeInTheDocument());
  });

  test("a save the database refuses says so and keeps everything marked", async () => {
    const { user } = open(editable, vi.fn(async () => Promise.reject("1 rows changed where one was expected")));
    await user.click(counter(2));
    await user.click(deleteButton());

    await user.click(screen.getByRole("button", { name: /Save/ }));

    expect(await screen.findByText("1 rows changed where one was expected")).toBeInTheDocument();
    expect(row(2)).toHaveAttribute("data-deleted", "true");
    expect(screen.getByRole("button", { name: /Save/ })).toBeInTheDocument();
  });

  test("Delete on rows that are already crossed out lets them go again", async () => {
    const { user } = open();
    await user.click(counter(2));
    await user.click(deleteButton());

    await user.click(deleteButton());

    expect(row(2)).not.toHaveAttribute("data-deleted");
    expect(screen.queryByRole("button", { name: /Save/ })).not.toBeInTheDocument();
  });

  test("Discard drops everything that was not saved", async () => {
    const { user } = open();
    await user.click(counter(1));
    await user.click(deleteButton());

    await user.click(screen.getByRole("button", { name: /Discard/ }));

    expect(row(1)).not.toHaveAttribute("data-deleted");
    expect(screen.queryByRole("button", { name: /Save/ })).not.toBeInTheDocument();
  });

  const altDoubleClick = async (user: ReturnType<typeof userEvent.setup>, element: HTMLElement) => {
    await user.keyboard("{Alt>}");
    await user.dblClick(element);
    await user.keyboard("{/Alt}");
  };

  test("Alt-double-clicking a cell opens it in a pop-up that only Saves what changed", async () => {
    const { user, onSave } = open();

    await altDoubleClick(user, cell("ada"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("textbox", { name: "name" })).toHaveValue("ada");
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();

    await user.clear(within(dialog).getByRole("textbox", { name: "name" }));
    await user.type(within(dialog).getByRole("textbox", { name: "name" }), "Ada L");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(cellAt(1, 1)).toHaveAttribute("data-edited", "true"));
    expect(screen.getByText("1 cell edited · not saved yet")).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  test("an edited cell is handed over with the rest when saved", async () => {
    const { user, onSave } = open();
    await user.dblClick(cell("ada"));
    await user.keyboard("Ada L{Enter}");

    await user.click(screen.getByRole("button", { name: /Save/ }));

    expect(onSave.mock.calls[0][0].edited.get(0)?.get(1)).toBe("Ada L");
  });

  describe("Backspace on what is picked", () => {
    test("it crosses out the picked rows, as Delete does, and writes nothing", async () => {
      const { user, onSave } = open();
      await user.click(counter(1));
      await clickWith(user, "Meta", counter(3));

      await user.keyboard("{Backspace}");

      expect(row(1)).toHaveAttribute("data-deleted", "true");
      expect(row(3)).toHaveAttribute("data-deleted", "true");
      expect(row(2)).not.toHaveAttribute("data-deleted");
      expect(screen.getByRole("button", { name: /Save/ })).toBeInTheDocument();
      expect(onSave).not.toHaveBeenCalled();
    });

    test("the Delete key does the same, and every row can go at once", async () => {
      const { user } = open();
      await user.click(corner());

      await user.keyboard("{Delete}");

      expect(screen.getByText("4 rows to delete · not saved yet")).toBeInTheDocument();
    });

    test("pressing it again on rows that are crossed out lets them go again", async () => {
      const { user } = open();
      await user.click(counter(2));
      await user.keyboard("{Backspace}");

      await user.keyboard("{Backspace}");

      expect(row(2)).not.toHaveAttribute("data-deleted");
      expect(screen.queryByRole("button", { name: /Save/ })).not.toBeInTheDocument();
    });

    test("on a picked cell it empties the value to NULL, still to be saved", async () => {
      const { user, onSave } = open();
      await user.click(cell("ada"));

      await user.keyboard("{Backspace}");

      expect(within(row(1)).getByText("NULL")).toBeInTheDocument();
      expect(cellAt(1, 1)).toHaveAttribute("data-edited", "true");
      expect(screen.getByText("1 cell edited · not saved yet")).toBeInTheDocument();
      expect(onSave).not.toHaveBeenCalled();
    });

    test("a column that may not be null can be emptied too, and shows a * where the value is missing", async () => {
      const { user, onSave } = open();
      await user.click(cellAt(1, 0));

      await user.keyboard("{Backspace}");

      const marker = within(cellAt(1, 0)).getByRole("img", { name: "A value is needed" });
      expect(marker).toHaveTextContent("*");
      expect(marker).toHaveAttribute("title", expect.stringContaining("may not be null"));
      expect(cellAt(1, 0)).toHaveAttribute("data-edited", "true");
      expect(screen.getByText("1 cell edited · not saved yet")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: /Save/ }));
      expect(onSave.mock.calls[0][0].edited.get(0)?.get(0)).toBeNull();
    });

    test("the * stands in for NULL only where a value is needed", async () => {
      const { user } = open();
      await user.click(cellAt(1, 1));

      await user.keyboard("{Backspace}");

      expect(within(cellAt(1, 1)).getByText("NULL")).toBeInTheDocument();
      expect(within(cellAt(1, 1)).queryByRole("img", { name: "A value is needed" })).not.toBeInTheDocument();
    });

    test("a block empties every cell in it, and marks the ones that need a value", async () => {
      const { user } = open();
      await user.pointer([{ keys: "[MouseLeft>]", target: cellAt(1, 0) }, { target: cellAt(1, 1) }, { keys: "[/MouseLeft]" }]);

      await user.keyboard("{Backspace}");

      expect(within(cellAt(1, 0)).getByRole("img", { name: "A value is needed" })).toBeInTheDocument();
      expect(within(cellAt(1, 1)).getByText("NULL")).toBeInTheDocument();
      expect(screen.getByText("2 cells edited · not saved yet")).toBeInTheDocument();
    });

    test("a value typed back into a cell that was emptied takes the * away", async () => {
      const { user } = open();
      await user.click(cellAt(1, 0));
      await user.keyboard("{Backspace}");

      await user.dblClick(cellAt(1, 0));
      await user.keyboard("1{Enter}");

      expect(within(cellAt(1, 0)).queryByRole("img", { name: "A value is needed" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Save/ })).not.toBeInTheDocument();
    });

    test("a column that is worked out by the query says so", async () => {
      const worked: ResultSet = { columns: ["id", "shout"], rows: [["1", "ADA"]], rowsAffected: 1, source: { ...source, columns: [source.columns[0], null] } };
      const { user } = open(worked);
      await user.click(cell("ADA"));

      await user.keyboard("{Backspace}");

      expect(screen.getByText("shout is worked out by the query, so it cannot be changed")).toBeInTheDocument();
    });

    test("a result that cannot be changed says why when the key is pressed", async () => {
      const { user } = open({ ...result, source: { state: "read_only", reason: "people has no primary key" } });
      await user.click(cell("ada"));

      await user.keyboard("{Backspace}");

      expect(screen.getByText("These rows cannot be changed: people has no primary key")).toBeInTheDocument();
    });

    test("a result not yet described says it is still being checked", async () => {
      const { user } = open(result);
      await user.click(cell("ada"));

      await user.keyboard("{Backspace}");

      expect(screen.getByText("Still checking whether these rows can be changed")).toBeInTheDocument();
    });

    test("a cell in a row that is crossed out is left alone", async () => {
      const { user } = open();
      await user.click(counter(1));
      await user.keyboard("{Backspace}");
      await user.click(cell("ada"));

      await user.keyboard("{Backspace}");

      expect(screen.getByText("1 row to delete · not saved yet")).toBeInTheDocument();
    });

    test("a result that cannot be changed ignores it", async () => {
      const { user } = open({ ...result, source: { state: "read_only", reason: "no key" } });
      await user.click(counter(1));

      await user.keyboard("{Backspace}");

      expect(row(1)).not.toHaveAttribute("data-deleted");
    });

    test("a picked column is left alone", async () => {
      const { user } = open();
      await user.click(header("name"));

      await user.keyboard("{Backspace}");

      expect(screen.queryByRole("button", { name: /Save/ })).not.toBeInTheDocument();
    });

    test("typing in a cell being edited is for the text, and crosses out nothing", async () => {
      const { user } = open();
      await user.click(counter(1));
      await user.dblClick(cell("ada"));

      await user.keyboard("{Backspace}");

      // The text is all selected when the box opens, so Backspace empties the box, and only the box.
      expect(within(cellAt(1, 1)).getByRole("textbox", { name: "Edit cell" })).toHaveValue("");
      expect(row(1)).not.toHaveAttribute("data-deleted");
    });
  });

  describe("editing a value where it sits", () => {
    const input = () => within(cellAt(1, 1)).getByRole("textbox", { name: "Edit cell" });

    test("double-clicking a plain value turns the cell into a text box holding it, with no pop-up", async () => {
      const { user } = open();

      await user.dblClick(cell("ada"));

      expect(input()).toHaveValue("ada");
      expect(input()).toHaveFocus();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    test("clicking outside keeps what was typed, marks the cell as edited, and makes Save available", async () => {
      const { user, onSave } = open();
      await user.dblClick(cell("ada"));

      await user.keyboard("Ada L");
      await user.click(document.body);

      expect(cellAt(1, 1)).toHaveTextContent("Ada L");
      expect(cellAt(1, 1)).toHaveAttribute("data-edited", "true");
      expect(screen.queryByRole("textbox", { name: "Edit cell" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Save/ })).toBeInTheDocument();
      expect(screen.getByText("1 cell edited · not saved yet")).toBeInTheDocument();
      expect(onSave).not.toHaveBeenCalled();
    });

    test("Enter keeps what was typed too", async () => {
      const { user } = open();
      await user.dblClick(cell("ada"));

      await user.keyboard("Ada L{Enter}");

      expect(cellAt(1, 1)).toHaveTextContent("Ada L");
      expect(screen.getByRole("button", { name: /Save/ })).toBeInTheDocument();
    });

    test("Escape drops it", async () => {
      const { user } = open();
      await user.dblClick(cell("ada"));

      await user.keyboard("Ada L{Escape}");

      expect(cellAt(1, 1)).toHaveTextContent("ada");
      expect(cellAt(1, 1)).not.toHaveAttribute("data-edited");
      expect(screen.queryByRole("button", { name: /Save/ })).not.toBeInTheDocument();
    });

    test("leaving the text as it was is no edit", async () => {
      const { user } = open();
      await user.dblClick(cell("ada"));

      await user.click(document.body);

      expect(screen.queryByRole("button", { name: /Save/ })).not.toBeInTheDocument();
    });

    test("typing back what was there is no edit either", async () => {
      const { user } = open();
      await user.dblClick(cell("ada"));

      await user.keyboard("x{Backspace}{Enter}");
      await user.dblClick(cellAt(1, 1));
      await user.keyboard("Ada{Enter}");
      await user.dblClick(cellAt(1, 1));
      await user.keyboard("ada{Enter}");

      expect(screen.queryByRole("button", { name: /Save/ })).not.toBeInTheDocument();
    });

    test("a NULL left empty stays NULL and is not an edit to an empty string", async () => {
      const { user } = open();
      await user.dblClick(within(row(2)).getByText("NULL"));

      await user.click(document.body);

      expect(within(row(2)).getByText("NULL")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Save/ })).not.toBeInTheDocument();
    });

    test("typing in the box is not copy, select all or Escape for the grid", async () => {
      const { user } = open();
      await user.dblClick(cell("ada"));

      await user.keyboard("{Meta>}a{/Meta}");

      expect(screen.queryByText(/Rows selected/)).not.toBeInTheDocument();
      expect(input()).toBeInTheDocument();
    });

    test("a click in the box places the cursor and does not select cells", async () => {
      const { user } = open();
      await user.dblClick(cell("ada"));

      await user.click(input());

      expect(input()).toHaveFocus();
      expect(cellAt(1, 1)).toHaveAttribute("data-selected", "false");
    });

    test("a JSON value opens the pop-up with the code editor, not the cell", async () => {
      const { user } = open({ columns: ["id", "doc"], rows: [["1", '{"a":1}']], rowsAffected: 1, source: { ...source, columns: [source.columns[0], { name: "doc", data_type: "jsonb", nullable: false, has_default: false }] } });

      await user.dblClick(cell('{"a":1}'));

      expect(await screen.findByRole("group", { name: "doc JSON" })).toBeInTheDocument();
      expect(screen.queryByRole("textbox", { name: "Edit cell" })).not.toBeInTheDocument();
    });

    test("a value over several lines opens the pop-up, where a text area can hold it", async () => {
      const { user } = open({ columns: ["id", "name"], rows: [["1", "one\ntwo"]], rowsAffected: 1, source });

      await user.dblClick(cellAt(1, 1));

      expect(await screen.findByRole("textbox", { name: "name" })).toHaveValue("one\ntwo");
    });

    test("a row crossed out cannot be edited in place either", async () => {
      const { user } = open();
      await user.click(counter(1));
      await user.click(deleteButton());

      await user.dblClick(cell("ada"));

      expect(screen.queryByRole("textbox", { name: "Edit cell" })).not.toBeInTheDocument();
    });
  });

  test("a cell can be set to NULL when its column allows it", async () => {
    const { user } = open();
    await altDoubleClick(user, cell("ada"));
    const dialog = await screen.findByRole("dialog");

    await user.click(within(dialog).getByRole("checkbox", { name: "NULL" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(within(row(1)).getAllByText("NULL")).toHaveLength(1));
    expect(screen.getByText("1 cell edited · not saved yet")).toBeInTheDocument();
  });

  test("a column that may not be null offers no NULL", async () => {
    const { user } = open();

    await altDoubleClick(user, cell("grace").previousElementSibling as HTMLElement);
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).queryByRole("checkbox", { name: "NULL" })).not.toBeInTheDocument();
  });

  test("a row that is crossed out cannot be edited", async () => {
    const { user } = open();
    await user.click(counter(1));
    await user.click(deleteButton());

    await user.dblClick(cell("ada"));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("a column that is worked out cannot be edited, and a JSON value in it is only viewed", async () => {
    const worked: ResultSet = { columns: ["id", "doc"], rows: [["1", '{"a":1}']], rowsAffected: 1, source: { ...source, columns: [source.columns[0], null] } };
    const { user } = open(worked);

    await user.dblClick(cell('{"a":1}'));

    expect(await screen.findByLabelText("JSON text")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});

describe("finding a column by its name", () => {
  const wide: ResultSet = {
    columns: ["id", "service_id", "rollout_status", "created_at", "status", "Rollout_Phase"],
    rows: [["1", "s1", "done", "2026", "ok", "x"]],
    rowsAffected: 1,
  };
  const finder = () => screen.getByRole("textbox", { name: "Find a column" });
  const open = async (shown: ResultSet = wide) => {
    const user = userEvent.setup();
    const scrollTo = vi.fn();
    render(<ResultsGrid result={shown} />);
    const table = screen.getByRole("table");
    Object.defineProperty(table, "clientWidth", { configurable: true, value: 500 });
    table.scrollTo = scrollTo as never;
    return { user, scrollTo, table };
  };

  test("the search button opens a bar for it, with the field ready to type in", async () => {
    const { user } = await open();

    await user.click(screen.getByRole("button", { name: "Find a column" }));

    expect(finder()).toHaveFocus();
  });

  test("command F in the grid opens it, and leaves the browser's own search out of it", async () => {
    const { user, table } = await open();
    table.focus();
    const press = new KeyboardEvent("keydown", { key: "f", metaKey: true, bubbles: true, cancelable: true });

    fireEvent(table, press);

    expect(press.defaultPrevented).toBe(true);
    expect(finder()).toBeInTheDocument();
    await user.keyboard("{Escape}");
  });

  test("typing marks the columns that have the text and says how many", async () => {
    const { user } = await open();
    await user.click(screen.getByRole("button", { name: "Find a column" }));

    await user.keyboard("status");

    expect(header("rollout_status")).toHaveAttribute("data-found", "current");
    expect(header("status")).toHaveAttribute("data-found", "match");
    expect(header("id")).not.toHaveAttribute("data-found");
    expect(screen.getByText("1 of 2")).toBeInTheDocument();
  });

  test("the letters that matched are marked in the name", async () => {
    const { user } = await open();
    await user.click(screen.getByRole("button", { name: "Find a column" }));

    await user.keyboard("status");

    expect(within(header("rollout_status")).getByText("status").tagName).toBe("MARK");
  });

  test("the grid scrolls to the first match as soon as there is one", async () => {
    const { user, scrollTo } = await open();
    await user.click(screen.getByRole("button", { name: "Find a column" }));

    await user.keyboard("created");

    expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ left: expect.any(Number) }));
  });

  test("Enter goes to the next match and Shift Enter back, round at either end", async () => {
    const { user } = await open();
    await user.click(screen.getByRole("button", { name: "Find a column" }));
    await user.keyboard("status");

    await user.keyboard("{Enter}");
    expect(header("status")).toHaveAttribute("data-found", "current");
    expect(screen.getByText("2 of 2")).toBeInTheDocument();

    await user.keyboard("{Enter}");
    expect(header("rollout_status")).toHaveAttribute("data-found", "current");

    await user.keyboard("{Shift>}{Enter}{/Shift}");
    expect(header("status")).toHaveAttribute("data-found", "current");
  });

  test("a name that is not there says so and marks nothing", async () => {
    const { user } = await open();
    await user.click(screen.getByRole("button", { name: "Find a column" }));

    await user.keyboard("zzz");

    expect(screen.getByText("No column")).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "id" })).not.toHaveAttribute("data-found");
  });

  test("the case does not matter", async () => {
    const { user } = await open();
    await user.click(screen.getByRole("button", { name: "Find a column" }));

    await user.keyboard("ROLLOUT");

    expect(screen.getByText("1 of 2")).toBeInTheDocument();
  });

  test("Escape closes the bar, clears what it marked, and gives the grid the keyboard back", async () => {
    const { user, table } = await open();
    await user.click(screen.getByRole("button", { name: "Find a column" }));
    await user.keyboard("status{Escape}");

    expect(screen.queryByRole("textbox", { name: "Find a column" })).not.toBeInTheDocument();
    expect(header("rollout_status")).not.toHaveAttribute("data-found");
    expect(table).toHaveFocus();
  });

  test("Backspace in the field edits the text, and does not reach the grid to cross rows out", async () => {
    const { user } = await open({ ...wide, source: { state: "editable", schema: "public", table: "t", columns: wide.columns.map((name) => ({ name, data_type: "text", nullable: true, has_default: false })), key: ["id"] } });
    await user.click(counter(1));
    await user.click(screen.getByRole("button", { name: "Find a column" }));

    await user.keyboard("abc{Backspace}");

    expect(finder()).toHaveValue("ab");
    expect(screen.queryByText(/to delete/)).not.toBeInTheDocument();
  });

  test("a new result starts clean, with the bar closed", async () => {
    const { user } = await open();
    await user.click(screen.getByRole("button", { name: "Find a column" }));
    await user.keyboard("status");

    render(<ResultsGrid result={{ columns: ["other"], rows: [["1"]], rowsAffected: 1 }} />);

    expect(screen.getAllByRole("textbox", { name: "Find a column" })).toHaveLength(1);
  });

  test("clicking a header still picks the column, and the search leaves what is picked alone", async () => {
    const { user } = await open();
    await user.click(screen.getByRole("button", { name: "Find a column" }));
    await user.keyboard("status");

    await user.click(header("id"));

    expect(header("id")).toHaveAttribute("aria-selected", "true");
    expect(header("rollout_status")).toHaveAttribute("data-found", "current");
  });
});

describe("pasting copied rows to add them", () => {
  const people: ResultSource = {
    state: "editable",
    schema: "public",
    table: "people",
    columns: [
      { name: "id", data_type: "integer", nullable: false, has_default: true },
      { name: "email", data_type: "text", nullable: false, has_default: false },
      { name: "age", data_type: "integer", nullable: true, has_default: false },
    ],
    key: ["id"],
  };
  const read: ResultSet = {
    columns: ["id", "email", "age"],
    rows: [["1", "a@x.io", "30"], ["2", "b@x.io", null]],
    rowsAffected: 2,
    source: people,
  };
  const row = (n: number) => screen.getAllByRole("row")[n];
  const cellIn = (n: number, column: number) => within(row(n)).getAllByRole("cell")[column];

  const open = (shown: ResultSet = read, onSave = vi.fn(async (_pending: Pending) => {})) => {
    const user = userEvent.setup();
    render(<ResultsGrid result={shown} onSave={onSave} />);
    return { user, onSave, table: screen.getByRole("table") };
  };
  const pasteInto = (table: HTMLElement, text: string) => {
    const event = new Event("paste", { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown };
    event.clipboardData = { getData: (type: string) => (type === "text/plain" ? text : "") };
    fireEvent(table, event);
    return event;
  };

  test("pasted rows appear below the others, marked as new, and say they are not saved", () => {
    const { table } = open();

    pasteInto(table, "3\tc@x.io\t41\n4\td@x.io\t");

    expect(screen.getAllByRole("row")).toHaveLength(1 + 4);
    expect(row(3)).toHaveAttribute("data-new", "true");
    expect(row(4)).toHaveAttribute("data-new", "true");
    expect(row(1)).not.toHaveAttribute("data-new");
    expect(within(row(3)).getByTitle("A new row, not saved yet")).toHaveTextContent("+");
    expect(screen.getByText("2 rows to add · not saved yet")).toBeInTheDocument();
  });

  test("the id the database makes is left empty on a copy, and the rest of the row is what was copied", () => {
    const { table } = open();

    pasteInto(table, "1\ta@x.io\t30");

    // The id may not be null, so an empty one shows the star that says a value is needed, which the database will supply when it is saved.
    expect(within(cellIn(3, 0)).getByRole("img", { name: "A value is needed" })).toBeInTheDocument();
    expect(cellIn(3, 1)).toHaveTextContent("a@x.io");
    expect(cellIn(3, 2)).toHaveTextContent("30");
  });

  test("the rows that were read are left as they were", () => {
    const { table } = open();

    pasteInto(table, "1\ta@x.io\t30");

    expect(cellIn(1, 1)).toHaveTextContent("a@x.io");
    expect(row(1)).not.toHaveAttribute("data-deleted");
  });

  test("a copy made by the grid itself pastes back as the same rows", async () => {
    const { user, table } = open();
    await user.click(counter(1));
    await clickWith(user, "Meta", counter(2));
    await user.keyboard("{Meta>}c{/Meta}");
    const copied = await navigator.clipboard.readText();

    pasteInto(table, copied);

    expect(screen.getAllByRole("row")).toHaveLength(1 + 4);
    expect(cellIn(3, 1)).toHaveTextContent("a@x.io");
    expect(cellIn(4, 1)).toHaveTextContent("b@x.io");
    // The age that was NULL in the second row was copied as nothing, and comes back as NULL.
    expect(within(cellIn(4, 2)).getByText("NULL")).toBeInTheDocument();
  });

  test("a cell of a new row can be changed in place like any other", async () => {
    const { user, table } = open();
    pasteInto(table, "1\ta@x.io\t30");

    await user.dblClick(cellIn(3, 1));
    await user.keyboard("fixed@x.io{Enter}");

    expect(cellIn(3, 1)).toHaveTextContent("fixed@x.io");
    expect(screen.getByText("1 row to add · not saved yet")).toBeInTheDocument();
  });

  test("a new row can be taken off again with Backspace, and nothing is left to save", async () => {
    const { user, table } = open();
    pasteInto(table, "1\ta@x.io\t30");
    await user.click(within(row(3)).getByTitle("A new row, not saved yet"));

    await user.keyboard("{Backspace}");

    expect(screen.getAllByRole("row")).toHaveLength(1 + 2);
    expect(screen.queryByRole("button", { name: /Save/ })).not.toBeInTheDocument();
  });

  test("Delete takes new rows off and crosses the rest out, in one go", async () => {
    const { user, table } = open();
    pasteInto(table, "1\ta@x.io\t30");
    await user.click(counter(1));
    await clickWith(user, "Meta", within(row(3)).getByTitle("A new row, not saved yet"));

    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(screen.getAllByRole("row")).toHaveLength(1 + 2);
    expect(row(1)).toHaveAttribute("data-deleted", "true");
  });

  test("Save hands over the rows to add, with every other kind of change", async () => {
    const { user, table, onSave } = open();
    pasteInto(table, "1\tnew@x.io\t7");
    await user.click(counter(1));
    await user.click(screen.getByRole("button", { name: "Delete" }));

    await user.click(screen.getByRole("button", { name: /Save/ }));

    const pending = onSave.mock.calls[0][0];
    expect([...pending.deleted]).toEqual([0]);
    expect(pending.added).toEqual([[null, "new@x.io", "7"]]);
  });

  test("a save the database refuses says why in its own words, and keeps every row that was added", async () => {
    const message = 'ERROR: duplicate key value violates unique constraint "people_email_key"\nDETAIL: Key (email)=(a@x.io) already exists.';
    const { user, table } = open(read, vi.fn(async () => Promise.reject(message)));
    pasteInto(table, "1\ta@x.io\t30");

    await user.click(screen.getByRole("button", { name: /Save/ }));

    expect(await screen.findByText(/duplicate key value violates unique constraint/)).toBeInTheDocument();
    expect(screen.getByText(/Key \(email\)=\(a@x.io\) already exists\./)).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(1 + 3);
    expect(screen.getByRole("button", { name: /Save/ })).toBeInTheDocument();
  });

  test("after a refusal the row can be fixed and saved again", async () => {
    const attempts = vi.fn().mockRejectedValueOnce("ERROR: duplicate key").mockResolvedValue(undefined);
    const { user, table } = open(read, attempts);
    pasteInto(table, "1\ta@x.io\t30");
    await user.click(screen.getByRole("button", { name: /Save/ }));
    await screen.findByText("ERROR: duplicate key");

    await user.dblClick(cellIn(3, 1));
    await user.keyboard("other@x.io{Enter}");
    await user.click(screen.getByRole("button", { name: /Save/ }));

    await waitFor(() => expect(attempts).toHaveBeenCalledTimes(2));
    expect(attempts.mock.calls[1][0].added[0][1]).toBe("other@x.io");
  });

  test("Discard drops the new rows with the rest", async () => {
    const { user, table } = open();
    pasteInto(table, "1\ta@x.io\t30");

    await user.click(screen.getByRole("button", { name: /Discard/ }));

    expect(screen.getAllByRole("row")).toHaveLength(1 + 2);
  });

  test("a result that cannot be changed says why, and adds nothing", () => {
    const { table } = open({ ...read, source: { state: "read_only", reason: "people has no primary key" } });

    const event = pasteInto(table, "1\ta@x.io\t30");

    expect(event.defaultPrevented).toBe(true);
    expect(screen.getByText("Rows cannot be added here: people has no primary key")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(1 + 2);
  });

  test("a result not yet described says it is still being checked", () => {
    const { table } = open({ ...read, source: undefined });

    pasteInto(table, "1\ta@x.io\t30");

    expect(screen.getByText("Still checking whether rows can be added here")).toBeInTheDocument();
  });

  test("a result with nothing copied that is worth adding says so", () => {
    const { table } = open();

    pasteInto(table, "\n\n");

    expect(screen.getByText("There was nothing to add in what was copied")).toBeInTheDocument();
  });

  test("with a cell being typed into, a paste is for the text of the cell", async () => {
    const { user, table } = open();
    await user.dblClick(cellIn(1, 1));

    const event = pasteInto(table, "1\tx\t2");

    expect(event.defaultPrevented).toBe(false);
    expect(screen.getAllByRole("row")).toHaveLength(1 + 2);
  });

  test("a grid that cannot be saved to lets the paste go by", () => {
    render(<ResultsGrid result={read} />);

    const event = pasteInto(screen.getByRole("table"), "1\ta@x.io\t30");

    expect(event.defaultPrevented).toBe(false);
    expect(screen.getAllByRole("row")).toHaveLength(1 + 2);
  });

  test("a row cannot be added with Backspace on a cell of a new row to something that is not there", async () => {
    const { user, table } = open();
    pasteInto(table, "1\ta@x.io\t30");

    await user.click(cellIn(3, 2));
    await user.keyboard("{Backspace}");

    expect(within(cellIn(3, 2)).getByText("NULL")).toBeInTheDocument();
    expect(screen.getByText("1 row to add · not saved yet")).toBeInTheDocument();
  });

  test("a column that may not be null shows a star where a new row has no value", () => {
    const { table } = open();

    pasteInto(table, "1\t\t30");

    expect(within(cellIn(3, 1)).getByRole("img", { name: "A value is needed" })).toBeInTheDocument();
  });
});

describe("exporting", () => {
  test("offers CSV and JSON, and saves with the format chosen", async () => {
    const onExport = vi.fn(async () => "/tmp/result.csv");
    const user = userEvent.setup();
    render(<ResultsGrid result={result} onExport={onExport} />);

    await user.click(screen.getByRole("button", { name: /Export/ }));
    await user.click(await screen.findByText("CSV"));

    expect(onExport).toHaveBeenCalledWith("csv");
    expect(await screen.findByText("Saved /tmp/result.csv")).toBeInTheDocument();
  });

  test("says nothing when the person backs out of the dialog", async () => {
    const onExport = vi.fn(async () => null);
    const user = userEvent.setup();
    render(<ResultsGrid result={result} onExport={onExport} />);

    await user.click(screen.getByRole("button", { name: /Export/ }));
    await user.click(await screen.findByText("JSON"));

    await waitFor(() => expect(onExport).toHaveBeenCalledWith("json"));
    expect(screen.queryByText(/Saved/)).not.toBeInTheDocument();
  });

  test("shows why it failed", async () => {
    const user = userEvent.setup();
    render(<ResultsGrid result={result} onExport={async () => Promise.reject("disk full")} />);

    await user.click(screen.getByRole("button", { name: /Export/ }));
    await user.click(await screen.findByText("CSV"));

    expect(await screen.findByText("disk full")).toBeInTheDocument();
  });

  test("waits for the rows to finish arriving", () => {
    render(<ResultsGrid result={{ ...result, rowsAffected: null }} onExport={async () => null} />);

    expect(screen.getByRole("button", { name: /Export/ })).toBeDisabled();
  });
});

describe("right-clicking a column with related rows", () => {
  const field = (name: string) => ({ name, data_type: "integer", nullable: false, has_default: false });
  const people: ResultSet = { ...result, source: { state: "editable", schema: "public", table: "people", columns: [field("id"), field("name")], key: ["id"] } };
  const catalog = [
    { schema: "public", name: "people", kind: "table" as const, columns: [], foreign_keys: [] },
    { schema: "public", name: "pets", kind: "table" as const, columns: [], foreign_keys: [{ columns: ["owner_id"], references_schema: "public", references_table: "people", references_columns: ["id"] }] },
  ];
  const pets = (ids: string) => `select * from public.pets where owner_id in (${ids});`;

  const setupRelated = () => {
    const onOpenQuery = vi.fn();
    const user = userEvent.setup();
    render(<ResultsGrid result={people} catalog={catalog} onOpenQuery={onOpenQuery} />);
    return { user, onOpenQuery };
  };

  async function openFrom(user: ReturnType<typeof userEvent.setup>, target: HTMLElement) {
    fireEvent.contextMenu(target);
    await user.click(await screen.findByText("pets (owner_id → id)"));
  }

  test("on the header, it opens them for every row when none are picked", async () => {
    const { user, onOpenQuery } = setupRelated();

    await openFrom(user, header("id"));

    expect(onOpenQuery).toHaveBeenCalledWith(pets("'1', '2', '3', '4'"));
  });

  test("on a cell, it opens them for that row alone", async () => {
    const { user, onOpenQuery } = setupRelated();

    await openFrom(user, cellAt(3, 0));

    expect(onOpenQuery).toHaveBeenCalledWith(pets("'3'"));
  });

  test("on a cell among the rows picked, it opens them for all of those rows", async () => {
    const { user, onOpenQuery } = setupRelated();
    await user.click(counter(1));
    await clickWith(user, "Meta", counter(2));

    await openFrom(user, cellAt(2, 0));

    expect(onOpenQuery).toHaveBeenCalledWith(pets("'1', '2'"));
  });

  test("on a cell outside the rows picked, it opens them for that row alone", async () => {
    const { user, onOpenQuery } = setupRelated();
    await user.click(counter(1));

    await openFrom(user, cellAt(4, 0));

    expect(onOpenQuery).toHaveBeenCalledWith(pets("'4'"));
  });

  test("a column with nothing related keeps the usual menu", () => {
    setupRelated();

    expect(fireEvent.contextMenu(cell("ada"))).toBe(true);
    expect(screen.queryByText("pets (owner_id → id)")).not.toBeInTheDocument();
  });
});

describe("showing the selection as a graph", () => {
  const field = (name: string) => ({ name, data_type: "integer", nullable: false, has_default: false });
  const people: ResultSet = { ...result, source: { state: "editable", schema: "public", table: "people", columns: [field("id"), field("name")], key: ["id"] } };
  const catalog = [{ schema: "public", name: "people", kind: "table" as const, columns: [], foreign_keys: [] }];

  const setupGraph = () => {
    const onShowGraph = vi.fn();
    render(<ResultsGrid result={people} catalog={catalog} onShowGraph={onShowGraph} />);
    return { user: userEvent.setup(), onShowGraph };
  };

  test("with nothing selected, it starts from every row and column", async () => {
    const { user, onShowGraph } = setupGraph();

    await user.click(screen.getByRole("button", { name: "Show as a graph" }));

    expect(onShowGraph).toHaveBeenCalledWith({ rows: null, columns: null });
  });

  test("selected rows are the rows it starts from", async () => {
    const { user, onShowGraph } = setupGraph();
    await user.click(counter(2));
    await user.keyboard("{Meta>}");
    await user.click(counter(4));
    await user.keyboard("{/Meta}");

    await user.click(screen.getByRole("button", { name: "Show as a graph" }));

    expect(onShowGraph).toHaveBeenLastCalledWith({ rows: [1, 3], columns: null });
  });

  test("selected columns are the fields its cards show", async () => {
    const { user, onShowGraph } = setupGraph();
    await user.click(header("name"));

    await user.click(screen.getByRole("button", { name: "Show as a graph" }));

    expect(onShowGraph).toHaveBeenLastCalledWith({ rows: null, columns: ["name"] });
  });
});

describe("hiding rows and columns", () => {
  const hideButton = () => screen.getByRole("button", { name: "Hide" });

  test("picked rows are hidden by H, numbers and all, until shown again", async () => {
    const { user } = setup();
    await user.click(counter(2));
    await clickWith(user, "Meta", counter(3));

    await user.keyboard("h");

    expect(screen.queryByRole("rowheader", { name: "2" })).not.toBeInTheDocument();
    expect(screen.queryByRole("rowheader", { name: "3" })).not.toBeInTheDocument();
    expect(counter(4)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "2 rows hidden · Show" }));
    expect(counter(2)).toBeInTheDocument();
    expect(counter(3)).toBeInTheDocument();
  });

  test("a picked column is hidden by the Hide button, which says H is its key", async () => {
    const { user } = setup();
    expect(hideButton()).toBeDisabled();
    await user.click(header("name"));
    expect(hideButton()).toHaveAttribute("aria-keyshortcuts", "H");

    await user.click(hideButton());

    expect(screen.queryByRole("columnheader", { name: "name" })).not.toBeInTheDocument();
    expect(screen.queryByText("grace")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1 column hidden · Show" })).toBeInTheDocument();
  });

  test("a block of cells cannot be hidden, being neither rows nor columns", async () => {
    const { user } = setup();

    await user.click(cellAt(1, 0));

    expect(hideButton()).toBeDisabled();
  });

  test("a range of rows across a hidden one copies only the rows in view", async () => {
    const { user } = setup();
    await user.click(counter(2));
    await user.keyboard("h");

    await user.click(counter(1));
    await clickWith(user, "Shift", counter(3));
    expect(screen.getByText("Rows selected: 2")).toBeInTheDocument();
    await user.keyboard("{Meta>}c{/Meta}");

    expect(await navigator.clipboard.readText()).toBe("1\tada\n3\tgrace");
  });

  test("H typed into a cell is a letter, not a hide", async () => {
    const source: ResultSource = { state: "editable", schema: "public", table: "people", columns: [{ name: "id", data_type: "integer", nullable: false, has_default: true }, { name: "name", data_type: "text", nullable: true, has_default: false }], key: ["id"] };
    const user = userEvent.setup();
    render(<ResultsGrid result={{ ...result, source }} onSave={vi.fn(async () => {})} />);
    await user.click(counter(1));

    await user.dblClick(cellAt(1, 1));
    await user.keyboard("{Control>}a{/Control}hi");

    expect(counter(1)).toBeInTheDocument();
    expect(screen.getByDisplayValue(/hi/)).toBeInTheDocument();
  });
});

describe("readable dates", () => {
  const events: ResultSet = {
    columns: ["id", "created_at", "note"],
    rows: [["1", "2026-09-28 12:44:08.659515+00", "2026-09-28 12:44:08.659515+00"]],
    rowsAffected: 1,
    source: {
      state: "editable",
      schema: "public",
      table: "events",
      columns: [
        { name: "id", data_type: "integer", nullable: false, has_default: true },
        { name: "created_at", data_type: "timestamp with time zone", nullable: false, has_default: true },
        { name: "note", data_type: "text", nullable: true, has_default: false },
      ],
      key: ["id"],
    },
  };
  const toggle = () => screen.getByRole("button", { name: "Readable dates" });

  beforeEach(() => localStorage.clear());

  test("the toggle shows the dates of date columns readably, and only those, and shows the value again when off", async () => {
    const user = userEvent.setup();
    render(<ResultsGrid result={events} onSave={vi.fn(async () => {})} />);
    expect(cellAt(1, 1)).toHaveTextContent("2026-09-28 12:44:08.659515+00");

    await user.click(toggle());

    expect(cellAt(1, 1)).not.toHaveTextContent("2026-09-28 12:44:08.659515+00");
    expect(cellAt(1, 1)).toHaveTextContent(/Sep 28, 2026/);
    expect(cellAt(1, 2)).toHaveTextContent("2026-09-28 12:44:08.659515+00");

    await user.click(toggle());
    expect(cellAt(1, 1)).toHaveTextContent("2026-09-28 12:44:08.659515+00");
  });

  test("editing a date shows its value, not the readable form", async () => {
    const user = userEvent.setup();
    render(<ResultsGrid result={events} onSave={vi.fn(async () => {})} />);
    await user.click(toggle());

    await user.dblClick(cellAt(1, 1));

    expect(screen.getByRole("textbox")).toHaveValue("2026-09-28 12:44:08.659515+00");
  });
});
