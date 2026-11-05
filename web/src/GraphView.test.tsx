import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

import type { CatalogTable } from "./gateway";
import { GraphView } from "./GraphView";
import type { ResultSet } from "./results";

const field = (name: string) => ({ name, data_type: "integer", nullable: false, has_default: false });
const people: ResultSet = {
  columns: ["id", "name"],
  rows: [["1", "ada"], ["2", "grace"]],
  rowsAffected: 2,
  source: { state: "editable", schema: "public", table: "people", columns: [field("id"), field("name")], key: ["id"] },
};
const catalog: CatalogTable[] = [
  { schema: "public", name: "people", kind: "table", columns: [], foreign_keys: [] },
  { schema: "public", name: "pets", kind: "table", columns: [], foreign_keys: [{ columns: ["owner_id"], references_schema: "public", references_table: "people", references_columns: ["id"] }] },
];

function setup(fetchRows = vi.fn(async () => ({ columns: ["id", "owner_id", "name"], rows: [["10", "2", "rex"]] }))) {
  const onBack = vi.fn();
  render(<GraphView result={people} catalog={catalog} fetchRows={fetchRows} onBack={onBack} />);
  return { user: userEvent.setup(), fetchRows, onBack };
}

const card = (name: string) => screen.getByRole("group", { name });
/** Opens a card's links menu and picks one link in it. */
async function pick(user: ReturnType<typeof userEvent.setup>, name: string, link: string | RegExp) {
  if (!screen.queryByRole("menu")) await user.click(screen.getByRole("button", { name: `Links of ${name}` }));
  await user.click(await screen.findByRole("menuitem", { name: link }));
}

test("each row of the result is a card, named by its table and first value", () => {
  setup();

  expect(card("people 1")).toBeInTheDocument();
  expect(card("people 2")).toBeInTheDocument();
});

test("clicking a card shows its whole row at the side, and opens nothing", async () => {
  const { user, fetchRows } = setup();

  await user.click(card("people 2"));

  expect(within(screen.getByRole("complementary", { name: "Row details" })).getByText("grace")).toBeInTheDocument();
  expect(card("people 2")).toHaveAttribute("aria-current", "true");
  expect(fetchRows).not.toHaveBeenCalled();
});

test("a card's graph button lists its links, and picking one reads its rows and draws them beside it", async () => {
  const { user, fetchRows } = setup();

  await pick(user, "people 2", /pets \(owner_id → id\)/);

  expect(fetchRows).toHaveBeenCalledWith("select * from public.pets where owner_id in ('2');");
  expect(await screen.findByRole("group", { name: "pets 10" })).toBeInTheDocument();
  await waitFor(() => expect(card("people 2")).toHaveAttribute("data-state", "open"));
});

test("only the links picked are read: one table and not another", async () => {
  const withToys: CatalogTable[] = [...catalog, { schema: "public", name: "toys", kind: "table", columns: [], foreign_keys: [{ columns: ["owner_id"], references_schema: "public", references_table: "people", references_columns: ["id"] }] }];
  const fetchRows = vi.fn(async () => ({ columns: ["id", "owner_id"], rows: [["7", "2"]] }));
  const user = userEvent.setup();
  render(<GraphView result={people} catalog={withToys} fetchRows={fetchRows} onBack={vi.fn()} />);

  await user.click(screen.getByRole("button", { name: "Links of people 2" }));
  expect(await screen.findByRole("menuitem", { name: /pets \(owner_id → id\)/ })).toBeInTheDocument();
  await user.click(screen.getByRole("menuitem", { name: /toys \(owner_id → id\)/ }));

  expect(fetchRows).toHaveBeenCalledTimes(1);
  expect(fetchRows).toHaveBeenCalledWith("select * from public.toys where owner_id in ('2');");
  expect(await screen.findByRole("group", { name: "toys 7" })).toBeInTheDocument();
});

test("picking an open link again closes it, taking away what it drew", async () => {
  const { user, fetchRows } = setup();
  await pick(user, "people 2", /pets \(owner_id → id\)/);
  await screen.findByRole("group", { name: "pets 10" });

  await pick(user, "people 2", /pets \(owner_id → id\)/);

  expect(screen.queryByRole("group", { name: "pets 10" })).not.toBeInTheDocument();
  expect(card("people 2")).toHaveAttribute("data-state", "closed");
  expect(fetchRows).toHaveBeenCalledTimes(1);
});

test("a link that cannot be read says why, and the card can be tried again", async () => {
  const fetchRows = vi.fn().mockRejectedValueOnce(new Error("permission denied for table pets"));
  const { user } = setup(fetchRows);

  await pick(user, "people 1", "Open all");

  expect(await screen.findByText(/permission denied for table pets/)).toBeInTheDocument();
  expect(card("people 1")).toHaveAttribute("data-state", "closed");
});

test("the fields on a table's cards are chosen with the pins beside a row, remembered, and can be reset", async () => {
  localStorage.clear();
  const { user } = setup();
  const grace = () => card("people 2");
  expect(within(grace()).getByText("grace")).toBeInTheDocument();

  await user.click(card("people 1"));
  const details = screen.getByRole("complementary", { name: "Row details" });
  await user.click(within(details).getByRole("button", { name: "Show name on cards" }));

  expect(within(grace()).queryByText("grace")).not.toBeInTheDocument();
  expect(within(details).getByRole("button", { name: "Show name on cards" })).toHaveAttribute("aria-pressed", "false");

  cleanup();
  setup();
  expect(within(grace()).queryByText("grace")).not.toBeInTheDocument();

  await user.click(card("people 1"));
  await user.click(within(screen.getByRole("complementary", { name: "Row details" })).getByRole("button", { name: "Reset" }));
  expect(within(grace()).getByText("grace")).toBeInTheDocument();
});

test("it starts from the rows and columns selected in the table, until all are asked for", async () => {
  localStorage.clear();
  const user = userEvent.setup();
  render(<GraphView result={people} only={{ rows: [1], columns: ["id"] }} catalog={catalog} fetchRows={vi.fn()} onBack={vi.fn()} />);

  expect(screen.queryByRole("group", { name: "people 1" })).not.toBeInTheDocument();
  expect(within(card("people 2")).queryByText("grace")).not.toBeInTheDocument();
  expect(screen.getByText(/1 row of 2 · 1 column selected/)).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Show all" }));

  expect(card("people 1")).toBeInTheDocument();
  expect(within(card("people 2")).getByText("grace")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Show all" })).not.toBeInTheDocument();
});

test("a long value at the side is folded, says how long it is, and unfolds for every row of its table", async () => {
  const html = "<html>" + "x".repeat(994);
  const pages: ResultSet = { ...people, columns: ["id", "name", "html"], rows: [["1", "ada", html], ["2", "grace", html]] };
  const user = userEvent.setup();
  render(<GraphView result={pages} catalog={catalog} fetchRows={vi.fn()} onBack={vi.fn()} />);
  await user.click(card("people 1"));
  const details = () => screen.getByRole("complementary", { name: "Row details" });

  await user.click(within(details()).getByRole("button", { name: "Show all · 1,000 characters" }));
  expect(within(details()).getByRole("button", { name: "Show less" })).toBeInTheDocument();

  await user.click(card("people 2"));
  expect(within(details()).getByRole("button", { name: "Show less" })).toBeInTheDocument();
  expect(within(details()).queryByRole("button", { name: /Show all/ })).not.toBeInTheDocument();
  expect(within(details()).getByText("grace")).toBeInTheDocument();
});

test("the row at the side can be made wider, and keeps its width next time", async () => {
  localStorage.clear();
  // The test page has no layout, so the graph is given a width to leave room in.
  const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1200);
  const { user } = setup();
  await user.click(card("people 1"));

  fireEvent.keyDown(screen.getByRole("separator", { name: "Resize row details" }), { key: "ArrowLeft", shiftKey: true });
  width.mockRestore();

  expect(screen.getByRole("complementary", { name: "Row details" })).toHaveStyle({ width: "344px" });
  expect(localStorage.getItem("pgclient.graphDetailsWidth")).toBe("344");
});

test("cards picked with ⌘-click are hidden by H, edges and all, until shown again", async () => {
  const { user } = setup();
  expect(screen.getByRole("button", { name: "Hide" })).toBeDisabled();

  await user.click(card("people 1"));
  await user.keyboard("{Meta>}");
  await user.click(card("people 2"));
  await user.keyboard("{/Meta}");
  expect(card("people 1")).toHaveAttribute("aria-current", "true");
  expect(card("people 2")).toHaveAttribute("aria-current", "true");

  await user.keyboard("h");

  expect(screen.queryByRole("group", { name: "people 1" })).not.toBeInTheDocument();
  expect(screen.queryByRole("group", { name: "people 2" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "2 hidden · Show" }));
  expect(card("people 1")).toBeInTheDocument();
  expect(card("people 2")).toBeInTheDocument();
});

test("the hide button hides the picked card, and says H is its key", async () => {
  const { user } = setup();
  await user.click(card("people 2"));
  const button = screen.getByRole("button", { name: "Hide" });
  expect(button).toHaveAttribute("aria-keyshortcuts", "H");

  await user.click(button);

  expect(screen.queryByRole("group", { name: "people 2" })).not.toBeInTheDocument();
  expect(card("people 1")).toBeInTheDocument();
  expect(screen.queryByRole("complementary", { name: "Row details" })).not.toBeInTheDocument();
});

test("clicking the canvas lets go of the picked cards", async () => {
  const { user } = setup();
  await user.click(card("people 2"));

  await user.click(screen.getByRole("figure", { name: "Graph of related rows" }));

  expect(card("people 2")).not.toHaveAttribute("aria-current");
  expect(screen.getByRole("button", { name: "Hide" })).toBeDisabled();
});

test("opening a link onto a hidden row shows it again", async () => {
  const { user } = setup();
  await pick(user, "people 2", /pets \(owner_id → id\)/);
  await user.keyboard("{Escape}");
  await user.click(await screen.findByRole("group", { name: "pets 10" }));
  await user.keyboard("h");
  expect(screen.queryByRole("group", { name: "pets 10" })).not.toBeInTheDocument();

  await pick(user, "people 2", /pets \(owner_id → id\)/);
  await pick(user, "people 2", /pets \(owner_id → id\)/);

  expect(await screen.findByRole("group", { name: "pets 10" })).toBeInTheDocument();
});

/** A pointer event at a place, which is what a drag is made of. */
const pointer = (element: HTMLElement, type: "pointerdown" | "pointermove" | "pointerup", x: number, y: number, init: MouseEventInit = {}) =>
  fireEvent(element, new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y, ...init }));

test("a box dragged across empty canvas picks the cards it touches, and grows the picked with ⌘", () => {
  setup();
  const figure = screen.getByRole("figure", { name: "Graph of related rows" });

  pointer(figure, "pointerdown", 0, 0);
  pointer(figure, "pointermove", 100, 40);
  expect(card("people 1")).toHaveAttribute("aria-current", "true");
  expect(card("people 2")).not.toHaveAttribute("aria-current");
  pointer(figure, "pointerup", 100, 40);

  pointer(figure, "pointerdown", 0, 300, { metaKey: true });
  pointer(figure, "pointermove", 100, 120, { metaKey: true });
  pointer(figure, "pointerup", 100, 120, { metaKey: true });
  expect(card("people 1")).toHaveAttribute("aria-current", "true");
  expect(card("people 2")).toHaveAttribute("aria-current", "true");

  pointer(figure, "pointerdown", 600, 600);
  pointer(figure, "pointerup", 600, 600);
  expect(card("people 1")).not.toHaveAttribute("aria-current");
});

test("a card can be dragged, and the click that ends the drag picks nothing else", () => {
  setup();
  const ada = card("people 1");
  const left = ada.style.left;

  pointer(ada, "pointerdown", 10, 10);
  pointer(ada, "pointermove", 210, 60);
  pointer(ada, "pointerup", 210, 60);
  fireEvent.click(ada);

  expect(ada.style.left).toBe(`${parseFloat(left) + 200}px`);
  expect(ada).toHaveAttribute("aria-current", "true");
  expect(screen.getByRole("button", { name: "Tidy up" })).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Tidy up" }));
  expect(card("people 1").style.left).toBe(left);
});

test("dragging one of the picked cards moves them all", () => {
  setup();
  const figure = screen.getByRole("figure", { name: "Graph of related rows" });
  pointer(figure, "pointerdown", 0, 0);
  pointer(figure, "pointermove", 100, 400);
  pointer(figure, "pointerup", 100, 400);
  const tops = [card("people 1").style.top, card("people 2").style.top].map(parseFloat);

  pointer(card("people 2"), "pointerdown", 50, 150);
  pointer(card("people 2"), "pointermove", 50, 230);
  pointer(card("people 2"), "pointerup", 50, 230);

  expect([card("people 1").style.top, card("people 2").style.top].map(parseFloat)).toEqual(tops.map((top) => top + 80));
});

test("a press that barely moves is a click, not a drag", () => {
  setup();
  const ada = card("people 1");
  const left = ada.style.left;

  pointer(ada, "pointerdown", 10, 10);
  pointer(ada, "pointermove", 12, 11);
  pointer(ada, "pointerup", 12, 11);

  expect(ada.style.left).toBe(left);
  expect(screen.queryByRole("button", { name: "Tidy up" })).not.toBeInTheDocument();
});

test("scrolling the graph closes a card's links menu", async () => {
  const { user } = setup();
  await user.click(screen.getByRole("button", { name: "Links of people 2" }));
  expect(await screen.findByRole("menu")).toBeInTheDocument();

  fireEvent.scroll(screen.getByRole("figure", { name: "Graph of related rows" }));

  await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
});

test("pressing anywhere else in the graph closes a card's links menu", async () => {
  const { user } = setup();
  await user.click(screen.getByRole("button", { name: "Links of people 2" }));
  expect(await screen.findByRole("menu")).toBeInTheDocument();

  pointer(screen.getByRole("figure", { name: "Graph of related rows" }), "pointerdown", 600, 600);

  await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
});

test("shift-click picks every card from the one clicked before down to it, ready to hide in one go", async () => {
  const many: ResultSet = { ...people, rows: [["1", "ada"], ["2", "grace"], ["3", "alan"], ["4", "linus"]] };
  const user = userEvent.setup();
  render(<GraphView result={many} catalog={catalog} fetchRows={vi.fn()} onBack={vi.fn()} />);

  await user.click(card("people 1"));
  await user.keyboard("{Shift>}");
  await user.click(card("people 3"));
  await user.keyboard("{/Shift}");

  expect(["people 1", "people 2", "people 3"].map((name) => card(name).getAttribute("aria-current"))).toEqual(["true", "true", "true"]);
  expect(card("people 4")).not.toHaveAttribute("aria-current");

  await user.keyboard("{Shift>}");
  await user.click(card("people 2"));
  await user.keyboard("{/Shift}");
  expect(card("people 3")).not.toHaveAttribute("aria-current");

  await user.keyboard("h");
  expect(screen.getByRole("button", { name: "2 hidden · Show" })).toBeInTheDocument();
  expect(card("people 3")).toBeInTheDocument();
});

test("shift-click goes by where the cards are now: one dragged out of the run is not picked, and one dragged into it is", async () => {
  const many: ResultSet = { ...people, rows: [["1", "ada"], ["2", "grace"], ["3", "alan"], ["4", "linus"]] };
  const user = userEvent.setup();
  render(<GraphView result={many} catalog={catalog} fetchRows={vi.fn()} onBack={vi.fn()} />);
  // Grace goes far to the right, out of the run; Linus comes up between Ada and Alan.
  pointer(card("people 2"), "pointerdown", 10, 10);
  pointer(card("people 2"), "pointermove", 810, 10);
  pointer(card("people 2"), "pointerup", 810, 10);
  const rise = parseFloat(card("people 4").style.top) - parseFloat(card("people 2").style.top);
  pointer(card("people 4"), "pointerdown", 10, 10);
  pointer(card("people 4"), "pointermove", 10, 10 - rise);
  pointer(card("people 4"), "pointerup", 10, 10 - rise);

  await user.click(card("people 1"));
  await user.keyboard("{Shift>}");
  await user.click(card("people 3"));
  await user.keyboard("{/Shift}");

  expect(card("people 2")).not.toHaveAttribute("aria-current");
  expect(["people 1", "people 3", "people 4"].map((name) => card(name).getAttribute("aria-current"))).toEqual(["true", "true", "true"]);
});

test("the table button goes back", async () => {
  const { user, onBack } = setup();

  await user.click(screen.getByRole("button", { name: /Table/ }));

  expect(onBack).toHaveBeenCalled();
});

test("the Readable dates toggle shows the dates of date fields on cards and at the side, and not other fields", async () => {
  localStorage.clear();
  const events: ResultSet = {
    columns: ["id", "created_at", "note"],
    rows: [["1", "2026-09-28 12:44:08.659515+00", "2026-09-28 12:44:08.659515+00"]],
    rowsAffected: 1,
    source: { state: "editable", schema: "public", table: "events", columns: [field("id"), field("created_at"), field("note")], key: ["id"] },
  };
  const tables: CatalogTable[] = [
    { schema: "public", name: "events", kind: "table", foreign_keys: [], columns: [{ name: "id", data_type: "integer" }, { name: "created_at", data_type: "timestamp with time zone" }, { name: "note", data_type: "text" }] },
  ];
  const user = userEvent.setup();
  render(<GraphView result={events} catalog={tables} fetchRows={vi.fn()} onBack={vi.fn()} />);
  const raw = "2026-09-28 12:44:08.659515+00";
  expect(within(card("events 1")).getAllByText(raw)).toHaveLength(2);

  await user.click(screen.getByRole("button", { name: "Readable dates" }));

  expect(within(card("events 1")).getAllByText(raw)).toHaveLength(1);
  expect(within(card("events 1")).getByText(/Sep 28, 2026/)).toBeInTheDocument();
});

describe("deleting cards", () => {
  const rowsOf = (...names: string[]) => names.map((name) => ({ schema: "public", table: "people", columns: ["id", "name"], row: [name === "ada" ? "1" : "2", name] }));

  function setupDeleting(onDeleteRows = vi.fn(async () => {})) {
    render(<GraphView result={people} catalog={catalog} fetchRows={vi.fn()} onBack={vi.fn()} onDeleteRows={onDeleteRows} />);
    return { user: userEvent.setup(), onDeleteRows };
  }

  test("Backspace crosses out the picked cards, and nothing is deleted until Save is clicked", async () => {
    const { user, onDeleteRows } = setupDeleting();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();

    await user.click(card("people 1"));
    await user.keyboard("{Backspace}");

    expect(card("people 1")).toHaveAttribute("data-deleting", "true");
    expect(card("people 2")).not.toHaveAttribute("data-deleting");
    expect(screen.getByText("1 card to delete · not saved yet")).toBeInTheDocument();
    expect(onDeleteRows).not.toHaveBeenCalled();
  });

  test("Backspace on cards that are all crossed out lets them go again", async () => {
    const { user } = setupDeleting();
    await user.click(card("people 1"));
    await user.keyboard("{Backspace}");

    await user.keyboard("{Backspace}");

    expect(card("people 1")).not.toHaveAttribute("data-deleting");
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  test("Save deletes the rows of the crossed out cards, and the cards go", async () => {
    const { user, onDeleteRows } = setupDeleting();
    await user.click(card("people 1"));
    await user.keyboard("{Backspace}");

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onDeleteRows).toHaveBeenCalledWith(rowsOf("ada"));
    await waitFor(() => expect(screen.queryByRole("group", { name: "people 1" })).not.toBeInTheDocument());
    expect(card("people 2")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  test("Discard lets every crossed out card go, and deletes nothing", async () => {
    const { user, onDeleteRows } = setupDeleting();
    await user.click(card("people 1"));
    await user.keyboard("{Backspace}");

    await user.click(screen.getByRole("button", { name: "Discard" }));

    expect(card("people 1")).not.toHaveAttribute("data-deleting");
    expect(onDeleteRows).not.toHaveBeenCalled();
  });

  test("a refused deletion is said, and the cards stay crossed out to be saved again", async () => {
    const { user } = setupDeleting(vi.fn(async () => Promise.reject(new Error("public.people has no primary key"))));
    await user.click(card("people 1"));
    await user.keyboard("{Backspace}");

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText(/has no primary key/)).toBeInTheDocument();
    expect(card("people 1")).toHaveAttribute("data-deleting", "true");
  });

  test("without a way to delete, Backspace does nothing", async () => {
    const { user } = setup();
    await user.click(card("people 1"));

    await user.keyboard("{Backspace}");

    expect(card("people 1")).not.toHaveAttribute("data-deleting");
  });
});
