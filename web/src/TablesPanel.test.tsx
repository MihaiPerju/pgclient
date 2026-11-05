import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

import { TablesPanel } from "./TablesPanel";
import { adults, audit, fakeGateway, people, peopleColumns } from "./test/fakeGateway";

function show(fake = fakeGateway(), database: string | null = "app", onInsert = vi.fn()) {
  render(<TablesPanel gateway={fake.gateway} serverId="s1" database={database} onInsert={onInsert} />);
  return { fake, onInsert };
}

test("with no database chosen it says what to do", () => {
  show(fakeGateway(), null);

  expect(screen.getByText("Choose a database to see its tables.")).toBeInTheDocument();
});

test("the tables of the chosen database are listed under their schemas", async () => {
  const { fake } = show();

  expect(await screen.findByRole("button", { name: /people/ })).toBeInTheDocument();
  expect(fake.gateway.listTables).toHaveBeenCalledWith("s1", "app");
  expect(screen.getByRole("button", { name: /adults/ })).toBeInTheDocument();
  expect(screen.getByText("public")).toBeInTheDocument();
  expect(screen.getByText("audit")).toBeInTheDocument();
});

test("a view is told apart from a table", async () => {
  show();

  expect(await screen.findByLabelText("view adults")).toBeInTheDocument();
  expect(screen.getByLabelText("table people")).toBeInTheDocument();
});

test("a schema can be folded away and opened again", async () => {
  show();
  await screen.findByRole("button", { name: /people/ });

  await userEvent.click(screen.getByRole("button", { name: "public" }));
  expect(screen.queryByRole("button", { name: /people/ })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /log/ })).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "public" }));
  expect(screen.getByRole("button", { name: /people/ })).toBeInTheDocument();
});

test("opening a table shows its columns, their types and its key, loaded only then", async () => {
  const { fake } = show();
  await screen.findByRole("button", { name: /people/ });
  expect(fake.gateway.listColumns).not.toHaveBeenCalled();

  await userEvent.click(screen.getByRole("button", { name: /people/ }));

  expect(await screen.findByText("integer")).toBeInTheDocument();
  expect(fake.gateway.listColumns).toHaveBeenCalledWith("s1", "app", "public", "people");
  expect(screen.getByText("id")).toBeInTheDocument();
  expect(screen.getByText("text")).toBeInTheDocument();
  expect(screen.getByLabelText("primary key")).toBeInTheDocument();
  expect(peopleColumns).toHaveLength(2);
});

test("a table can be closed again without asking for its columns twice", async () => {
  const { fake } = show();
  const row = await screen.findByRole("button", { name: /people/ });

  await userEvent.click(row);
  await screen.findByText("integer");
  await userEvent.click(row);
  expect(screen.queryByText("integer")).not.toBeInTheDocument();
  await userEvent.click(row);

  expect(await screen.findByText("integer")).toBeInTheDocument();
  expect(fake.gateway.listColumns).toHaveBeenCalledTimes(1);
});

test("double-clicking a table offers a query that looks at it", async () => {
  const { onInsert } = show();

  await userEvent.dblClick(await screen.findByRole("button", { name: /people/ }));

  expect(onInsert).toHaveBeenCalledWith("select * from public.people limit 100;");
});

test("typing narrows the list to the tables that match, and schemas with none disappear", async () => {
  show();
  await screen.findByRole("button", { name: /people/ });

  await userEvent.type(screen.getByRole("searchbox", { name: "Search tables" }), "LOG");

  expect(screen.getByRole("button", { name: /log/ })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /people/ })).not.toBeInTheDocument();
  expect(screen.queryByText("public")).not.toBeInTheDocument();
});

test("a search that matches nothing says so", async () => {
  show();
  await screen.findByRole("button", { name: /people/ });

  await userEvent.type(screen.getByRole("searchbox", { name: "Search tables" }), "zzz");

  expect(screen.getByText("No tables match")).toBeInTheDocument();
});

test("a database with no tables says so", async () => {
  const fake = fakeGateway();
  fake.gateway.listTables.mockResolvedValue([]);
  show(fake);

  expect(await screen.findByText("No tables")).toBeInTheDocument();
});

test("a failure to read the tables is shown, and refreshing tries again", async () => {
  const fake = fakeGateway();
  fake.gateway.listTables.mockRejectedValueOnce("FATAL: password authentication failed");
  show(fake);

  expect(await screen.findByRole("alert")).toHaveTextContent("password authentication failed");
  await userEvent.click(screen.getByRole("button", { name: "Refresh tables" }));

  expect(await screen.findByRole("button", { name: /people/ })).toBeInTheDocument();
  expect(fake.gateway.listTables).toHaveBeenCalledTimes(2);
});

test("choosing another database loads its tables, and a slow answer for the old one is ignored", async () => {
  const fake = fakeGateway();
  let slow: (tables: (typeof people)[]) => void = () => {};
  fake.gateway.listTables.mockImplementationOnce(() => new Promise((resolve) => (slow = resolve)));
  const { rerender } = render(<TablesPanel gateway={fake.gateway} serverId="s1" database="old" onInsert={vi.fn()} />);

  rerender(<TablesPanel gateway={fake.gateway} serverId="s1" database="new" onInsert={vi.fn()} />);
  expect(await screen.findByRole("button", { name: /people/ })).toBeInTheDocument();
  slow([{ schema: "public", name: "stale_table", kind: "table" }]);

  await waitFor(() => expect(screen.queryByRole("button", { name: /stale_table/ })).not.toBeInTheDocument());
  expect(within(screen.getByRole("navigation", { name: "Tables" })).getByRole("button", { name: /adults/ })).toBeInTheDocument();
  expect([adults, audit]).toHaveLength(2);
});

describe("the tree, level by level, the way pgAdmin lays it out", () => {
  test("each kind of thing sits in a group of its own with a count, under its schema", async () => {
    show();
    await screen.findByRole("button", { name: /people/ });

    expect(screen.getAllByRole("button", { name: "Tables (1)" })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Views (1)" })).toBeInTheDocument();
  });

  test("a table is under Tables, and a view under Views", async () => {
    show();
    const tables = await screen.findByRole("button", { name: "Views (1)" });
    const view = screen.getByRole("button", { name: /adults/ });
    const table = screen.getByRole("button", { name: /people/ });

    expect(table.compareDocumentPosition(tables) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tables.compareDocumentPosition(view) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test("every level that can be opened says whether it is: the schema, the group and the table", async () => {
    show();
    const schema = await screen.findByRole("button", { name: "public" });
    const group = screen.getAllByRole("button", { name: "Tables (1)" })[0];
    const table = screen.getByRole("button", { name: /people/ });

    expect(schema).toHaveAttribute("aria-expanded", "true");
    expect(group).toHaveAttribute("aria-expanded", "true");
    expect(table).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(table);

    expect(table).toHaveAttribute("aria-expanded", "true");
  });

  test("a chevron is drawn at each of those levels, and not on a column, which has nothing under it", async () => {
    show();
    await userEvent.click(await screen.findByRole("button", { name: /people/ }));
    await screen.findByText("integer");

    expect(screen.getByRole("button", { name: "public" }).querySelector("[data-chevron]")).not.toBeNull();
    expect(screen.getAllByRole("button", { name: "Tables (1)" })[0].querySelector("[data-chevron]")).not.toBeNull();
    expect(screen.getByRole("button", { name: /people/ }).querySelector("[data-chevron]")).not.toBeNull();
    expect(screen.getByText("id").closest("[data-chevron]")).toBeNull();
    expect(screen.getByText("id").parentElement!.querySelector("[data-chevron]")).toBeNull();
  });

  test("the chevron turns to show when a level is open", async () => {
    show();
    const table = await screen.findByRole("button", { name: /people/ });

    expect(table.querySelector("[data-chevron]")).toHaveAttribute("data-chevron", "closed");
    await userEvent.click(table);

    expect(table.querySelector("[data-chevron]")).toHaveAttribute("data-chevron", "open");
  });

  test("a group can be folded without folding its schema or the other groups", async () => {
    show();
    await screen.findByRole("button", { name: /people/ });

    await userEvent.click(screen.getAllByRole("button", { name: "Tables (1)" })[0]);

    expect(screen.queryByRole("button", { name: /people/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /adults/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /log/ })).toBeInTheDocument();
  });

  test("a search still finds what is inside a folded group", async () => {
    show();
    await screen.findByRole("button", { name: /people/ });
    await userEvent.click(screen.getAllByRole("button", { name: "Tables (1)" })[0]);

    await userEvent.type(screen.getByRole("searchbox", { name: "Search tables" }), "people");

    expect(screen.getByRole("button", { name: /people/ })).toBeInTheDocument();
  });

  test("a level deeper is indented further than the one above it", async () => {
    show();
    await userEvent.click(await screen.findByRole("button", { name: /people/ }));
    await screen.findByText("integer");
    const indent = (element: HTMLElement) => parseInt(getComputedStyle(element).paddingLeft, 10);

    const schema = indent(screen.getByRole("button", { name: "public" }));
    const group = indent(screen.getAllByRole("button", { name: "Tables (1)" })[0]);
    const table = indent(screen.getByRole("button", { name: /people/ }));
    const column = indent(screen.getByText("id").closest("[data-level]") as HTMLElement);

    expect(schema).toBeLessThan(group);
    expect(group).toBeLessThan(table);
    expect(table).toBeLessThan(column);
  });
});
