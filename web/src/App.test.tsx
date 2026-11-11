import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

import { App } from "./App";
import { ThemeProvider } from "./theme";
import { fakeGateway, local, sessionOf } from "./test/fakeGateway";
import plainPlan from "./samples/plan.json?raw";

vi.mock("./SqlEditor", () => ({
  SqlEditor: ({ value, dark, catalog, onChange }: { value: string; dark: boolean; catalog?: { schema: string; name: string }[] | null; onChange: (value: string, selection: string) => void }) => (
    <textarea aria-label="SQL" data-dark={String(dark)} data-tables={(catalog ?? []).map((table) => `${table.schema}.${table.name}`).join(" ")} value={value} onChange={(event) => onChange(event.target.value, "")} />
  ),
}));

const server = () => screen.getByRole("combobox", { name: "Server" });
const database = () => screen.getByRole("combobox", { name: "Database" });
const run = () => screen.getByRole("button", { name: /Run/ });

async function pick(box: HTMLElement, option: string) {
  await userEvent.click(box);
  await userEvent.click(await screen.findByTitle(option));
}

async function ready(gateway = fakeGateway()) {
  render(<App gateway={gateway.gateway} />);
  await waitFor(() => expect(gateway.gateway.listServers).toHaveBeenCalled());
  await pick(server(), "Local");
  await waitFor(() => expect(gateway.gateway.listDatabases).toHaveBeenCalledWith("s1"));
  await pick(database(), "app");
  return gateway;
}

test("with no saved servers it asks for one", async () => {
  const fake = fakeGateway([]);
  render(<App gateway={fake.gateway} />);

  expect(await screen.findByText("No servers yet")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Add server/ })).toBeInTheDocument();
});

test("choosing a server loads its databases, and nothing runs until one is chosen", async () => {
  const fake = fakeGateway();
  render(<App gateway={fake.gateway} />);
  await screen.findByRole("combobox", { name: "Server" });

  expect(run()).toBeDisabled();
  await pick(server(), "Local");

  await waitFor(() => expect(fake.gateway.listDatabases).toHaveBeenCalledWith("s1"));
  expect(run()).toBeDisabled();
  await pick(database(), "app");
  await userEvent.type(screen.getByLabelText("SQL"), "select 1");
  expect(run()).toBeEnabled();
});

test("running sends what is in the editor to the chosen server and database", async () => {
  const fake = await ready();
  await userEvent.type(screen.getByLabelText("SQL"), "select 1");

  await userEvent.click(run());

  expect(fake.gateway.runQuery).toHaveBeenCalledWith("s1", "app", "select 1", expect.any(Function));
});

test("pointing a tab at another database keeps what was written and drops the results, which belong to the one they came from", async () => {
  const fake = await ready();
  await userEvent.type(screen.getByLabelText("SQL"), "select 1");
  await userEvent.click(run());
  act(() =>
    fake.send(
      { type: "result_started", columns: ["id"] },
      { type: "rows", rows: [["1"]] },
      { type: "result_finished", rows_affected: 1 },
      { type: "finished", elapsed_ms: 3 },
    ),
  );
  await screen.findByRole("table");

  await pick(database(), "postgres");

  expect(screen.getByLabelText("SQL")).toHaveValue("select 1");
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
});

test("rows appear as they arrive, with NULL shown for a missing value and a line of totals", async () => {
  const fake = await ready();
  await userEvent.type(screen.getByLabelText("SQL"), "select 1");
  await userEvent.click(run());

  act(() =>
    fake.send(
      { type: "result_started", columns: ["id", "name"] },
      { type: "rows", rows: [["1", "ada"], ["2", null]] },
      { type: "result_finished", rows_affected: 2 },
      { type: "finished", elapsed_ms: 12 },
    ),
  );

  const grid = await screen.findByRole("table");
  expect(within(grid).getByRole("columnheader", { name: "name" })).toBeInTheDocument();
  expect(within(grid).getByText("ada")).toBeInTheDocument();
  expect(within(grid).getByText("NULL")).toBeInTheDocument();
  expect(screen.getByText("2 rows · 12 ms")).toBeInTheDocument();
});

test("the rows pointing at a column open in a new tab on the same database, and run there", async () => {
  const column = (name: string) => ({ name, data_type: "integer", nullable: false, has_default: false });
  const fake = fakeGateway(undefined, undefined, { source: { state: "editable", schema: "public", table: "people", columns: [column("id"), column("name")], key: ["id"] } });
  fake.gateway.catalog.mockResolvedValue([
    { schema: "public", name: "people", kind: "table", columns: [], foreign_keys: [] },
    { schema: "public", name: "pets", kind: "table", columns: [], foreign_keys: [{ columns: ["owner_id"], references_schema: "public", references_table: "people", references_columns: ["id"] }] },
  ]);
  await ready(fake);
  await userEvent.type(screen.getByLabelText("SQL"), "select * from people");
  await userEvent.click(run());
  act(() =>
    fake.send(
      { type: "result_started", columns: ["id", "name"] },
      { type: "rows", rows: [["1", "ada"], ["2", "grace"], ["2", "again"]] },
      { type: "result_finished", rows_affected: 3 },
      { type: "finished", elapsed_ms: 1 },
    ),
  );

  await screen.findByLabelText("id has related rows");
  fireEvent.contextMenu(screen.getByRole("columnheader", { name: "id" }));
  await userEvent.click(await screen.findByText("pets (owner_id → id)"));

  const related = "select * from public.pets where owner_id in ('1', '2');";
  await waitFor(() => expect(fake.gateway.runQuery).toHaveBeenLastCalledWith("s1", "app", related, expect.any(Function)));
  expect(screen.getByLabelText("SQL")).toHaveValue(related);
  expect(screen.getAllByRole("tab")).toHaveLength(2);
});

test("a result read from one table can be shown as a graph, whose cards read what they link to on the same database, and shown as a table again", async () => {
  const column = (name: string) => ({ name, data_type: "integer", nullable: false, has_default: false });
  const fake = fakeGateway(undefined, undefined, { source: { state: "editable", schema: "public", table: "people", columns: [column("id"), column("name")], key: ["id"] } });
  fake.gateway.catalog.mockResolvedValue([
    { schema: "public", name: "people", kind: "table", columns: [], foreign_keys: [] },
    { schema: "public", name: "pets", kind: "table", columns: [], foreign_keys: [{ columns: ["owner_id"], references_schema: "public", references_table: "people", references_columns: ["id"] }] },
  ]);
  await ready(fake);
  await userEvent.type(screen.getByLabelText("SQL"), "select * from people");
  await userEvent.click(run());
  act(() => fake.send({ type: "result_started", columns: ["id", "name"] }, { type: "rows", rows: [["1", "ada"]] }, { type: "result_finished", rows_affected: 1 }, { type: "finished", elapsed_ms: 1 }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Show as a graph" })).toBeEnabled());

  await userEvent.click(screen.getByRole("button", { name: "Show as a graph" }));
  await userEvent.click(screen.getByRole("button", { name: "Links of people 1" }));
  await userEvent.click(await screen.findByRole("menuitem", { name: /pets \(owner_id → id\)/ }));

  await waitFor(() => expect(fake.gateway.runQuery).toHaveBeenLastCalledWith("s1", "app", "select * from public.pets where owner_id in ('1');", expect.any(Function)));
  act(() => fake.send({ type: "result_started", columns: ["id", "owner_id"] }, { type: "rows", rows: [["10", "1"]] }, { type: "result_finished", rows_affected: 1 }, { type: "finished", elapsed_ms: 1 }));
  expect(await screen.findByRole("group", { name: "pets 10" })).toBeInTheDocument();
  expect(screen.getAllByRole("tab")).toHaveLength(1);

  await userEvent.click(screen.getByRole("button", { name: "Table" }));
  expect(screen.getByRole("table")).toBeInTheDocument();
});

test("cards of the graph, of any table it reached, are deleted by Backspace and Save, and what they came from loses the rows", async () => {
  const column = (name: string) => ({ name, data_type: "integer", nullable: false, has_default: false });
  const fake = fakeGateway(undefined, undefined, { source: { state: "editable", schema: "public", table: "people", columns: [column("id"), column("name")], key: ["id"] } });
  fake.gateway.catalog.mockResolvedValue([
    { schema: "public", name: "people", kind: "table", columns: [], foreign_keys: [] },
    { schema: "public", name: "pets", kind: "table", columns: [], foreign_keys: [{ columns: ["owner_id"], references_schema: "public", references_table: "people", references_columns: ["id"] }] },
  ]);
  await ready(fake);
  await userEvent.type(screen.getByLabelText("SQL"), "select * from people");
  await userEvent.click(run());
  act(() => fake.send({ type: "result_started", columns: ["id", "name"] }, { type: "rows", rows: [["1", "ada"], ["2", "grace"]] }, { type: "result_finished", rows_affected: 2 }, { type: "finished", elapsed_ms: 1 }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Show as a graph" })).toBeEnabled());
  await userEvent.click(screen.getByRole("button", { name: "Show as a graph" }));
  await userEvent.click(screen.getByRole("button", { name: "Links of people 1" }));
  await userEvent.click(await screen.findByRole("menuitem", { name: /pets \(owner_id → id\)/ }));
  await waitFor(() => expect(fake.gateway.runQuery).toHaveBeenCalledTimes(2));
  act(() => fake.send({ type: "result_started", columns: ["id", "owner_id"] }, { type: "rows", rows: [["10", "1"]] }, { type: "result_finished", rows_affected: 1 }, { type: "finished", elapsed_ms: 1 }));

  await userEvent.click(await screen.findByRole("group", { name: "pets 10" }));
  await userEvent.keyboard("{Backspace}");
  await userEvent.click(screen.getByRole("group", { name: "people 1" }));
  await userEvent.keyboard("{Backspace}");
  expect(fake.gateway.applyChanges).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(fake.gateway.applyChanges).toHaveBeenCalledTimes(2));
  expect(fake.gateway.applyChanges).toHaveBeenCalledWith("s1", "app", "public", "pets", [{ kind: "delete", key: { id: "10" } }]);
  expect(fake.gateway.applyChanges).toHaveBeenCalledWith("s1", "app", "public", "people", [{ kind: "delete", key: { id: "1" } }]);
  await waitFor(() => expect(screen.queryByRole("group", { name: "pets 10" })).not.toBeInTheDocument());
  expect(screen.getByRole("group", { name: "people 2" })).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Table" }));
  expect(screen.queryByText("ada")).not.toBeInTheDocument();
  expect(screen.getByText("grace")).toBeInTheDocument();
});

test("a statement that returns no rows says how many it changed", async () => {
  const fake = await ready();
  await userEvent.type(screen.getByLabelText("SQL"), "delete from t");
  await userEvent.click(run());

  act(() => fake.send({ type: "result_finished", rows_affected: 3 }, { type: "finished", elapsed_ms: 5 }));

  expect(await screen.findByText("3 rows affected")).toBeInTheDocument();
});

test("a mistake in the SQL is shown with the database's own words", async () => {
  const fake = await ready();
  await userEvent.type(screen.getByLabelText("SQL"), "select nope");
  await userEvent.click(run());

  act(() => fake.send({ type: "failed", message: 'ERROR: column "nope" does not exist' }));

  expect(await screen.findByRole("alert")).toHaveTextContent('ERROR: column "nope" does not exist');
});

test("while a query runs it can be cancelled, and Run waits", async () => {
  const fake = await ready();
  await userEvent.type(screen.getByLabelText("SQL"), "select pg_sleep(30)");
  await userEvent.click(run());

  expect(run()).toBeDisabled();
  await userEvent.click(await screen.findByRole("button", { name: /Cancel/ }));

  expect(fake.gateway.cancelQuery).toHaveBeenCalledWith(7);
});

test("a second run starts clean, without the rows of the first", async () => {
  const fake = await ready();
  await userEvent.type(screen.getByLabelText("SQL"), "select 1");
  await userEvent.click(run());
  act(() => fake.send({ type: "result_started", columns: ["a"] }, { type: "rows", rows: [["first"]] }, { type: "finished", elapsed_ms: 1 }));
  await screen.findByText("first");

  await userEvent.click(run());

  await waitFor(() => expect(screen.queryByText("first")).not.toBeInTheDocument());
});

test("a server can be added from the form, and is chosen straight away", async () => {
  const fake = fakeGateway([]);
  render(<App gateway={fake.gateway} />);

  await userEvent.click(await screen.findByRole("button", { name: /Add server/ }));
  const form = await screen.findByRole("dialog");
  await userEvent.type(within(form).getByLabelText("Name"), "Docker");
  await userEvent.clear(within(form).getByLabelText("Host"));
  await userEvent.type(within(form).getByLabelText("Host"), "localhost");
  await userEvent.clear(within(form).getByLabelText("Port"));
  await userEvent.type(within(form).getByLabelText("Port"), "5435");
  await userEvent.clear(within(form).getByLabelText("User"));
  await userEvent.type(within(form).getByLabelText("User"), "pgclient");
  await userEvent.type(within(form).getByLabelText("Password"), "pgclient");
  await userEvent.click(within(form).getByRole("button", { name: "Save" }));

  await waitFor(() =>
    expect(fake.gateway.saveServer).toHaveBeenCalledWith({ id: null, name: "Docker", host: "localhost", port: 5435, user: "pgclient", database: null, group: null, environment: null, password: "pgclient" }),
  );
  await waitFor(() => expect(fake.gateway.listDatabases).toHaveBeenCalledWith("new"));
});

test("the server last used and its database are chosen again next time", async () => {
  await ready();
  cleanup();
  const again = fakeGateway();

  render(<App gateway={again.gateway} />);

  await waitFor(() => expect(again.gateway.listDatabases).toHaveBeenCalledWith(local.id));
  expect(await screen.findByTitle("Local")).toBeInTheDocument();
  expect(await screen.findByTitle("app")).toBeInTheDocument();
});

test("a database and a group can be given in the form", async () => {
  const fake = fakeGateway([]);
  render(<App gateway={fake.gateway} />);
  await userEvent.click(await screen.findByRole("button", { name: /Add server/ }));
  const form = await screen.findByRole("dialog");
  await userEvent.type(within(form).getByLabelText("Name"), "Docker");
  await userEvent.type(within(form).getByLabelText("Database"), "appdb");
  await userEvent.type(within(form).getByLabelText("Group"), "staging");

  await userEvent.click(within(form).getByRole("button", { name: "Save" }));

  await waitFor(() => expect(fake.gateway.saveServer).toHaveBeenCalledWith(expect.objectContaining({ database: "appdb", group: "staging" })));
});

test("a server's own database is opened first, unless one was used last time", async () => {
  const fake = fakeGateway([{ ...local, database: "postgres" }]);
  render(<App gateway={fake.gateway} />);
  await screen.findByRole("combobox", { name: "Server" });
  await pick(server(), "Local");

  expect(await screen.findByTitle("postgres")).toBeInTheDocument();
});

const share = () => screen.getByRole("button", { name: /Import \/ export/ });

async function openShare(fake = fakeGateway()) {
  render(<App gateway={fake.gateway} />);
  await screen.findByRole("combobox", { name: "Server" });
  await userEvent.click(share());
  return { fake, dialog: await screen.findByRole("dialog") };
}

test("pasted addresses are imported, the list of servers is refreshed, and the outcome is said", async () => {
  const { fake, dialog } = await openShare();
  const before = fake.gateway.listServers.mock.calls.length;

  await userEvent.click(within(dialog).getByRole("textbox", { name: "Servers to import" }));
  await userEvent.paste("postgres://app:pw@localhost:5433/appdb#staging");
  await userEvent.click(within(dialog).getByRole("button", { name: "Import" }));

  expect(fake.gateway.importServers).toHaveBeenCalledWith("postgres://app:pw@localhost:5433/appdb#staging");
  expect(await within(dialog).findByText("Added 1, updated 0")).toBeInTheDocument();
  await waitFor(() => expect(fake.gateway.listServers.mock.calls.length).toBeGreaterThan(before));
});

test("what could not be read is listed, not dropped", async () => {
  const fake = fakeGateway();
  fake.gateway.importServers.mockResolvedValue({ added: 0, updated: 0, skipped: ["line 2: mysql:// is not a postgres address"] });
  const { dialog } = await openShare(fake);

  await userEvent.click(within(dialog).getByRole("textbox", { name: "Servers to import" }));
  await userEvent.paste("mysql://x");
  await userEvent.click(within(dialog).getByRole("button", { name: "Import" }));

  expect(await within(dialog).findByText("line 2: mysql:// is not a postgres address")).toBeInTheDocument();
});

test("a file chosen from disk is read into the box", async () => {
  const { dialog } = await openShare();
  const file = new File(['{"version":1,"servers":[]}'], "servers.json", { type: "application/json" });

  await userEvent.upload(within(dialog).getByLabelText("Choose a file"), file);

  await waitFor(() => expect(within(dialog).getByRole("textbox", { name: "Servers to import" })).toHaveValue('{"version":1,"servers":[]}'));
});

test("an import the server refuses says why", async () => {
  const fake = fakeGateway();
  fake.gateway.importServers.mockRejectedValue("This file is version 2, and this app reads version 1");
  const { dialog } = await openShare(fake);

  await userEvent.click(within(dialog).getByRole("textbox", { name: "Servers to import" }));
  await userEvent.paste("{}");
  await userEvent.click(within(dialog).getByRole("button", { name: "Import" }));

  expect(await within(dialog).findByRole("alert")).toHaveTextContent("version 2");
});

test("the export is shown without passwords, and with them only when asked", async () => {
  const { fake, dialog } = await openShare();
  await userEvent.click(within(dialog).getByRole("tab", { name: "Export" }));

  expect(await within(dialog).findByDisplayValue(/"passwords":false/)).toBeInTheDocument();
  expect(fake.gateway.exportServers).toHaveBeenLastCalledWith(false);

  await userEvent.click(within(dialog).getByRole("checkbox", { name: "Include passwords" }));

  expect(await within(dialog).findByDisplayValue(/"passwords":true/)).toBeInTheDocument();
  expect(fake.gateway.exportServers).toHaveBeenLastCalledWith(true);
});

test("the export can be copied", async () => {
  const user = userEvent.setup();
  const fake = fakeGateway();
  render(<App gateway={fake.gateway} />);
  await screen.findByRole("combobox", { name: "Server" });
  await user.click(share());
  const dialog = await screen.findByRole("dialog");
  await user.click(within(dialog).getByRole("tab", { name: "Export" }));
  await within(dialog).findByDisplayValue(/passwords/);

  await user.click(within(dialog).getByRole("button", { name: /Copy/ }));

  expect(await navigator.clipboard.readText()).toContain('"version":1');
});

test("with no servers it still offers to import some, and says where the servers file is read from", async () => {
  const fake = fakeGateway([], {}, { file: "/Users/me/.pgclient/servers.json" });
  render(<App gateway={fake.gateway} />);

  expect(await screen.findByText(/\/Users\/me\/\.pgclient\/servers\.json/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /Import \/ export/ }));

  expect(await screen.findByRole("dialog")).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Servers to import" })).toBeInTheDocument();
});

test("what is wrong with the servers file is shown, and the servers that did load are still there", async () => {
  const fake = fakeGateway([local], { s1: ["app"] }, { problems: ["/Users/me/.pgclient/servers.json: entry 2 \"oops\": no host"] });
  render(<App gateway={fake.gateway} />);

  expect(await screen.findByText(/entry 2 "oops": no host/)).toBeInTheDocument();
  expect(screen.getByRole("combobox", { name: "Server" })).toBeInTheDocument();
});

test("a server from the file cannot be edited in the app", async () => {
  const fake = fakeGateway([{ ...local, source: "file" }]);
  render(<App gateway={fake.gateway} />);
  await screen.findByRole("combobox", { name: "Server" });
  await pick(server(), "Local");

  expect(screen.getByRole("button", { name: /Edit server/ })).toBeDisabled();
});

test("the servers are read again when the window comes back into focus, so an edit to the file shows up", async () => {
  const fake = fakeGateway();
  render(<App gateway={fake.gateway} />);
  await screen.findByRole("combobox", { name: "Server" });
  const before = fake.gateway.listServers.mock.calls.length;

  act(() => {
    window.dispatchEvent(new Event("focus"));
  });

  await waitFor(() => expect(fake.gateway.listServers.mock.calls.length).toBeGreaterThan(before));
});

test("while a server is being reached, which can mean starting a tunnel, it says so", async () => {
  const fake = fakeGateway();
  let arrive: (databases: string[]) => void = () => {};
  fake.gateway.listDatabases.mockImplementation(() => new Promise((resolve) => (arrive = resolve)));
  render(<App gateway={fake.gateway} />);
  await screen.findByRole("combobox", { name: "Server" });

  await pick(server(), "Local");

  expect(await screen.findByText("Connecting…")).toBeInTheDocument();
  act(() => arrive(["app"]));
  await waitFor(() => expect(screen.queryByText("Connecting…")).not.toBeInTheDocument());
});

test("a server that cannot be reached says why, in the words of whatever failed", async () => {
  const fake = fakeGateway();
  fake.gateway.listDatabases.mockRejectedValue("The tunnel command stopped (exit status: 1): error: context \"x\" does not exist");
  render(<App gateway={fake.gateway} />);
  await screen.findByRole("combobox", { name: "Server" });

  await pick(server(), "Local");

  expect(await screen.findByRole("alert")).toHaveTextContent('context "x" does not exist');
  expect(screen.queryByText("Connecting…")).not.toBeInTheDocument();
});

const toggle = () => screen.getByRole("button", { name: /Toggle tables panel/ });
const panel = () => screen.queryByRole("navigation", { name: "Tables" });

test("the tables of the chosen database are in a panel at the side, open from the start", async () => {
  const fake = await ready();

  expect(await screen.findByRole("button", { name: /people/ })).toBeInTheDocument();
  expect(fake.gateway.listTables).toHaveBeenCalledWith("s1", "app");
});

test("the panel is closed from the toolbar, stays closed next time, and the tables are not fetched while it is", async () => {
  const fake = await ready();
  await screen.findByRole("button", { name: /people/ });
  fake.gateway.listTables.mockClear();

  await userEvent.click(toggle());

  expect(panel()).not.toBeInTheDocument();
  expect(localStorage.getItem("pgclient.tables")).toBe("closed");
  cleanup();
  const again = fakeGateway();
  render(<App gateway={again.gateway} />);
  await waitFor(() => expect(again.gateway.listDatabases).toHaveBeenCalledWith("s1"));
  expect(await screen.findByTitle("app")).toBeInTheDocument();
  expect(panel()).not.toBeInTheDocument();
  expect(again.gateway.listTables).not.toHaveBeenCalled();
  expect(fake.gateway.listTables).not.toHaveBeenCalled();
});

test("command-B opens and closes the panel", async () => {
  await ready();
  await screen.findByRole("navigation", { name: "Tables" });

  await userEvent.keyboard("{Meta>}b{/Meta}");
  expect(panel()).not.toBeInTheDocument();

  await userEvent.keyboard("{Meta>}b{/Meta}");
  expect(await screen.findByRole("navigation", { name: "Tables" })).toBeInTheDocument();
});

test("double-clicking a table puts a query for it in the editor", async () => {
  await ready();

  await userEvent.dblClick(await screen.findByRole("button", { name: /people/ }));

  expect(screen.getByLabelText("SQL")).toHaveValue("select * from public.people limit 100;");
});

test("a query already in the editor is kept, and the new one goes below it", async () => {
  await ready();
  await userEvent.type(screen.getByLabelText("SQL"), "select 1;");

  await userEvent.dblClick(await screen.findByRole("button", { name: /people/ }));

  expect(screen.getByLabelText("SQL")).toHaveValue("select 1;\n\nselect * from public.people limit 100;");
});

test("the theme switch is in the toolbar, and the editor takes on the theme that is chosen", async () => {
  const fake = fakeGateway();
  render(
    <ThemeProvider>
      <App gateway={fake.gateway} />
    </ThemeProvider>,
  );
  await screen.findByRole("combobox", { name: "Server" });
  expect(screen.getByLabelText("SQL")).toHaveAttribute("data-dark", "false");

  await userEvent.click(screen.getByRole("radio", { name: "Dark" }).closest("label")!);

  expect(screen.getByLabelText("SQL")).toHaveAttribute("data-dark", "true");
});

describe("the panes can be resized", () => {
  const sidebarHandle = () => screen.getByRole("separator", { name: "Resize tables panel" });
  const editorHandle = () => screen.getByRole("separator", { name: "Resize editor" });
  const aside = () => screen.getByRole("navigation", { name: "Tables" }).closest("aside") as HTMLElement;

  test("the side bar and the editor each have a divider", async () => {
    await ready();

    expect(sidebarHandle()).toBeInTheDocument();
    expect(editorHandle()).toBeInTheDocument();
  });

  test("the side bar starts at its usual width and the arrow keys change it, which is remembered", async () => {
    await ready();
    expect(aside().style.width).toBe("280px");

    fireEvent.keyDown(sidebarHandle(), { key: "ArrowRight" });

    expect(aside().style.width).toBe("296px");
    expect(localStorage.getItem("pgclient.sidebarWidth")).toBe("296");
  });

  test("a width chosen before is used from the start", async () => {
    localStorage.setItem("pgclient.sidebarWidth", "340");

    await ready();

    expect(aside().style.width).toBe("340px");
  });

  test("a double click on the divider puts the side bar back", async () => {
    localStorage.setItem("pgclient.sidebarWidth", "340");
    await ready();

    fireEvent.doubleClick(sidebarHandle());

    expect(aside().style.width).toBe("280px");
    expect(localStorage.getItem("pgclient.sidebarWidth")).toBeNull();
  });

  test("the editor can be made taller or shorter, which is remembered, and the results take what is left", async () => {
    await ready();
    const pane = () => screen.getByLabelText("SQL").closest("[data-pane='editor']") as HTMLElement;

    fireEvent.keyDown(editorHandle(), { key: "ArrowDown" });

    expect(pane().style.height).toMatch(/px$/);
    expect(Number(localStorage.getItem("pgclient.editorHeight"))).toBeGreaterThanOrEqual(80);
  });

  test("with the tables panel closed its divider goes too, and the editor's stays", async () => {
    await ready();

    await userEvent.click(toggle());

    expect(screen.queryByRole("separator", { name: "Resize tables panel" })).not.toBeInTheDocument();
    expect(editorHandle()).toBeInTheDocument();
  });

  test("the side bar keeps its width when it is closed and opened again", async () => {
    await ready();
    fireEvent.keyDown(sidebarHandle(), { key: "ArrowRight", shiftKey: true });
    expect(aside().style.width).toBe("344px");

    await userEvent.click(toggle());
    await userEvent.click(toggle());

    expect(aside().style.width).toBe("344px");
  });
});

describe("the metrics in the top bar", () => {
  const bar = () => screen.queryByRole("group", { name: "Database metrics" });

  test("there is nothing to watch until a database is chosen", async () => {
    const fake = fakeGateway();
    render(<App gateway={fake.gateway} />);
    await screen.findByRole("combobox", { name: "Server" });

    expect(bar()).not.toBeInTheDocument();
    expect(fake.gateway.metrics).not.toHaveBeenCalled();
  });

  test("once one is, its numbers appear in the bar at the top", async () => {
    const fake = await ready();

    expect(await screen.findByLabelText("Connections: 12 of 100")).toBeInTheDocument();
    expect(fake.gateway.metrics).toHaveBeenCalledWith("s1", "app");
    expect(bar()!.closest('[role="region"]')).not.toBeNull();
  });

  test("choosing another database watches that one instead", async () => {
    const fake = await ready();
    await screen.findByLabelText(/Connections/);
    fake.gateway.metrics.mockClear();

    await pick(database(), "postgres");

    await waitFor(() => expect(fake.gateway.metrics).toHaveBeenCalledWith("s1", "postgres"));
  });

  test("when the numbers cannot be had the rest of the app carries on as it was", async () => {
    const fake = fakeGateway();
    fake.gateway.metrics.mockRejectedValue("permission denied for view pg_stat_activity");
    render(<App gateway={fake.gateway} />);
    await screen.findByRole("combobox", { name: "Server" });
    await pick(server(), "Local");
    await pick(database(), "app");
    await userEvent.type(screen.getByLabelText("SQL"), "select 1");

    expect(await screen.findByLabelText("Metrics unavailable")).toBeInTheDocument();
    expect(run()).toBeEnabled();
  });
});

describe("suggestions in the editor", () => {
  const tablesInEditor = () => screen.getByRole("textbox", { name: "SQL" }).dataset.tables;

  test("the database's tables are loaded as soon as it is chosen, and handed to the editor", async () => {
    const fake = await ready();

    await waitFor(() => expect(tablesInEditor()).toBe("public.people audit.log"));
    expect(fake.gateway.catalog).toHaveBeenCalledWith("s1", "app");
  });

  test("going back to a database uses what was loaded before, without asking again", async () => {
    const fake = await ready();
    await waitFor(() => expect(tablesInEditor()).not.toBe(""));

    await pick(database(), "postgres");
    await pick(database(), "app");

    await waitFor(() => expect(tablesInEditor()).toBe("public.people audit.log"));
    expect(fake.gateway.catalog.mock.calls.filter((call) => (call as unknown[])[1] === "app")).toHaveLength(1);
  });

  test("refreshing the tables asks the database again", async () => {
    const fake = await ready();
    await waitFor(() => expect(fake.gateway.catalog).toHaveBeenCalledTimes(1));

    await userEvent.click(screen.getByRole("button", { name: "Refresh tables" }));

    await waitFor(() => expect(fake.gateway.catalog).toHaveBeenCalledTimes(2));
  });

  test("a statement that changes the tables asks again once it has finished, and a select does not", async () => {
    const fake = await ready();
    await waitFor(() => expect(fake.gateway.catalog).toHaveBeenCalledTimes(1));
    const editor = screen.getByRole("textbox", { name: "SQL" });

    fireEvent.change(editor, { target: { value: "select * from people" } });
    await userEvent.click(run());
    act(() => fake.send({ type: "finished", elapsed_ms: 1 }));
    fireEvent.change(editor, { target: { value: "create table pets (id int)" } });
    await userEvent.click(run());
    act(() => fake.send({ type: "finished", elapsed_ms: 1 }));

    await waitFor(() => expect(fake.gateway.catalog).toHaveBeenCalledTimes(2));
  });
});

describe("deleting and editing the rows of a result", () => {
  const source = {
    state: "editable" as const,
    schema: "public",
    table: "people",
    columns: [
      { name: "id", data_type: "integer", nullable: false, has_default: true },
      { name: "name", data_type: "text", nullable: true, has_default: false },
    ],
    key: ["id"],
  };

  async function selected(extras: Parameters<typeof fakeGateway>[2] = { source }) {
    const fake = await ready(fakeGateway(undefined, undefined, extras));
    await userEvent.type(screen.getByLabelText("SQL"), "select id, name from people");
    await userEvent.click(run());
    act(() =>
      fake.send(
        { type: "result_started", columns: ["id", "name"] },
        { type: "rows", rows: [["1", "ada"], ["2", "grace"], ["3", "alan"]] },
        { type: "result_finished", rows_affected: 3 },
        { type: "finished", elapsed_ms: 4 },
      ),
    );
    await screen.findByRole("table");
    return fake;
  }

  test("once a statement finishes, the database is asked where its rows come from", async () => {
    const fake = await selected();

    await waitFor(() => expect(fake.gateway.describeResult).toHaveBeenCalledWith("s1", "app", "select id, name from people"));
  });

  test("a statement of several results is not asked about, and has no Delete", async () => {
    const fake = await ready();
    await userEvent.type(screen.getByLabelText("SQL"), "select 1; select 2");
    await userEvent.click(run());

    act(() =>
      fake.send(
        { type: "result_started", columns: ["a"] },
        { type: "rows", rows: [["1"]] },
        { type: "result_finished", rows_affected: 1 },
        { type: "result_started", columns: ["b"] },
        { type: "rows", rows: [["2"]] },
        { type: "result_finished", rows_affected: 1 },
        { type: "finished", elapsed_ms: 2 },
      ),
    );

    await screen.findAllByRole("table");
    expect(fake.gateway.describeResult).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  test("a result the database says cannot be edited keeps Delete off, with the reason", async () => {
    await selected({ source: { state: "read_only", reason: "people has no primary key" } });

    await waitFor(() => expect(screen.getByRole("button", { name: "Delete" })).toHaveAttribute("title", "people has no primary key"));
  });

  test("deleting rows and saving sends their keys to the table, and the rows are gone after", async () => {
    const fake = await selected();
    await waitFor(() => expect(screen.getByRole("button", { name: "Delete" })).toHaveAttribute("title", "Select rows to delete"));

    await userEvent.click(screen.getByRole("rowheader", { name: "1" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(fake.gateway.applyChanges).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /Save/ }));

    expect(fake.gateway.applyChanges).toHaveBeenCalledWith("s1", "app", "public", "people", [{ kind: "delete", key: { id: "1" } }]);
    await waitFor(() => expect(screen.queryByText("ada")).not.toBeInTheDocument());
    expect(screen.getByText("grace")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Save/ })).not.toBeInTheDocument();
  });

  test("when the database refuses, the rows stay, still marked, and its words are shown", async () => {
    await selected({ source, refuseChanges: "1 rows changed where one was expected" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Delete" })).toHaveAttribute("title", "Select rows to delete"));

    await userEvent.click(screen.getByRole("rowheader", { name: "2" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await userEvent.click(screen.getByRole("button", { name: /Save/ }));

    expect(await screen.findByText("1 rows changed where one was expected")).toBeInTheDocument();
    expect(screen.getByText("grace")).toBeInTheDocument();
  });

  test("an edit is written with the key the row was read with", async () => {
    const fake = await selected();
    await waitFor(() => expect(screen.getByRole("button", { name: "Delete" })).toHaveAttribute("title", "Select rows to delete"));

    await userEvent.dblClick(screen.getByText("alan"));
    await userEvent.keyboard("Alan T{Enter}");
    await userEvent.click(await screen.findByRole("button", { name: /Save/ }));

    expect(fake.gateway.applyChanges).toHaveBeenCalledWith("s1", "app", "public", "people", [{ kind: "update", key: { id: "3" }, set: { name: "Alan T" } }]);
    expect(await within(screen.getByRole("table")).findByText("Alan T")).toBeInTheDocument();
  });
});

describe("the text of each editor, kept in a file between runs", () => {
  test("what was written for a server and database comes back when it is chosen", async () => {
    await ready(fakeGateway(undefined, undefined, { queries: { "s1\u0000app": "select 42" } }));

    expect(await screen.findByDisplayValue("select 42")).toBeInTheDocument();
  });

  test("text kept before there were tabs goes to the first tab pointed at that server and database, once", async () => {
    await ready(fakeGateway(undefined, undefined, { queries: { "s1\u0000app": "select 1", "s1\u0000postgres": "select 2" } }));
    expect(await screen.findByDisplayValue("select 1")).toBeInTheDocument();

    await pick(database(), "postgres");

    // The tab already has text, so it keeps it.
    expect(screen.getByLabelText("SQL")).toHaveValue("select 1");
  });

  test("what is typed is written to the file once typing pauses, under the tab it was typed in", async () => {
    const fake = await ready();

    await userEvent.type(screen.getByLabelText("SQL"), "select 1");

    await waitFor(() => expect(fake.gateway.saveQuery).toHaveBeenCalledWith(expect.stringMatching(/^tab:/), "select 1"));
    expect(fake.gateway.saveQuery.mock.calls.filter(([key]) => key.startsWith("tab:"))).toHaveLength(1);
  });

  test("nothing is shown until what was kept has been read, so it cannot be typed over", async () => {
    const fake = fakeGateway(undefined, undefined, { queries: {} });
    let release: (queries: Record<string, string>) => void = () => {};
    fake.gateway.loadQueries.mockImplementation(() => new Promise((resolve) => (release = resolve)));
    render(<App gateway={fake.gateway} />);
    await waitFor(() => expect(fake.gateway.listServers).toHaveBeenCalled());

    expect(screen.queryByLabelText("SQL")).not.toBeInTheDocument();
    await act(async () => release({}));

    expect(await screen.findByLabelText("SQL")).toBeInTheDocument();
  });

  test("a file that cannot be read leaves an empty editor and no error", async () => {
    const fake = fakeGateway();
    fake.gateway.loadQueries.mockRejectedValue("not json");
    await ready(fake);

    expect(screen.getByLabelText("SQL")).toHaveValue("");
  });

  test("a failed save is not shown as an error, since the text is still in the editor", async () => {
    const fake = await ready();
    fake.gateway.saveQuery.mockRejectedValue("disk full");

    await userEvent.type(screen.getByLabelText("SQL"), "x");

    await waitFor(() => expect(fake.gateway.saveQuery).toHaveBeenCalled());
    expect(screen.queryByText("disk full")).not.toBeInTheDocument();
    expect(screen.getByLabelText("SQL")).toHaveValue("x");
  });
});


describe("tabs, one for each database that is open", () => {
  const tabs = () => screen.getAllByRole("tab");
  const tab = (name: RegExp) => screen.getByRole("tab", { name });
  const withLayout = (layout: unknown, texts: Record<string, string> = {}) => ({ tabs: JSON.stringify(layout), ...texts });
  const finish = (fake: ReturnType<typeof fakeGateway>, rows: string[][]) =>
    act(() => fake.send({ type: "result_started", columns: ["n"] }, { type: "rows", rows }, { type: "result_finished", rows_affected: rows.length }, { type: "finished", elapsed_ms: 1 }));

  test("it starts with one tab, named for its database, with nothing to close", async () => {
    await ready();

    expect(tabs()).toHaveLength(1);
    expect(tab(/^app/)).toHaveAttribute("aria-selected", "true");
    expect(tab(/^app/)).toHaveAttribute("title", "app on Local");
    expect(screen.queryByRole("button", { name: /^Close/ })).not.toBeInTheDocument();
  });

  test("a new tab opens on the same database, empty, and the first keeps its text and results", async () => {
    const fake = await ready();
    await userEvent.type(screen.getByLabelText("SQL"), "select 1");
    await userEvent.click(run());
    finish(fake, [["1"]]);
    await screen.findByRole("table");

    await userEvent.click(screen.getByRole("button", { name: "New tab" }));

    expect(tabs()).toHaveLength(2);
    expect(tabs()[1]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("SQL")).toHaveValue("");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(tabs()[1]).toHaveAttribute("title", "app on Local");

    await userEvent.click(tabs()[0]);

    expect(screen.getByLabelText("SQL")).toHaveValue("select 1");
    expect(await screen.findByRole("table")).toBeInTheDocument();
  });

  test("each tab can be on another database, and the tab says which", async () => {
    await ready();
    await userEvent.click(screen.getByRole("button", { name: "New tab" }));

    await pick(database(), "postgres");

    expect(tabs().map((one) => one.getAttribute("title"))).toEqual(["app on Local", "postgres on Local"]);
  });

  test("what runs in one tab lands in that tab even while another is in front", async () => {
    const fake = await ready();
    await userEvent.type(screen.getByLabelText("SQL"), "select 1");
    await userEvent.click(run());
    await userEvent.click(screen.getByRole("button", { name: "New tab" }));
    expect(tabs()[0].querySelector('[aria-label="Running"]')).not.toBeNull();

    finish(fake, [["only in the first"]]);

    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    await userEvent.click(tabs()[0]);
    expect(await screen.findByText("only in the first")).toBeInTheDocument();
    expect(tabs()[0].querySelector('[aria-label="Running"]')).toBeNull();
  });

  test("closing a tab takes its text from the file, and the tab next to it comes to the front", async () => {
    const fake = await ready();
    await userEvent.click(screen.getByRole("button", { name: "New tab" }));
    await userEvent.type(screen.getByLabelText("SQL"), "second");

    await userEvent.click(within(tabs()[1]).getByRole("button", { name: /^Close/ }));

    expect(tabs()).toHaveLength(1);
    expect(tabs()[0]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("SQL")).toHaveValue("");
    await waitFor(() => expect(fake.gateway.saveQuery).toHaveBeenCalledWith(expect.stringMatching(/^tab:/), ""));
  });

  test("the last tab cannot be closed, and a middle click on it does nothing", async () => {
    await ready();

    fireEvent(tabs()[0], new MouseEvent("auxclick", { bubbles: true, button: 1 }));

    expect(tabs()).toHaveLength(1);
  });

  test("a middle click closes a tab", async () => {
    await ready();
    await userEvent.click(screen.getByRole("button", { name: "New tab" }));

    fireEvent(tabs()[1], new MouseEvent("auxclick", { bubbles: true, button: 1 }));

    expect(tabs()).toHaveLength(1);
  });

  test("the arrow keys move between tabs", async () => {
    await ready();
    await userEvent.click(screen.getByRole("button", { name: "New tab" }));

    fireEvent.keyDown(tabs()[1], { key: "ArrowLeft" });

    expect(tabs()[0]).toHaveAttribute("aria-selected", "true");
  });

  test("the tabs and what was in them come back after a reload, with the same one in front", async () => {
    const layout = { tabs: [{ id: "t1", serverId: "s1", database: "app" }, { id: "t2", serverId: "s1", database: "postgres" }], active: "t2" };
    render(<App gateway={fakeGateway(undefined, undefined, { queries: withLayout(layout, { "tab:t1": "select 1", "tab:t2": "select 2" }) }).gateway} />);
    await screen.findByLabelText("SQL");

    expect(tabs().map((one) => one.getAttribute("title"))).toEqual(["app on Local", "postgres on Local"]);
    expect(tabs()[1]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("SQL")).toHaveValue("select 2");

    await userEvent.click(tabs()[0]);

    expect(screen.getByLabelText("SQL")).toHaveValue("select 1");
  });

  test("the tabs that are open are written to the file as they change", async () => {
    const fake = await ready();

    await userEvent.click(screen.getByRole("button", { name: "New tab" }));

    await waitFor(() => {
      const layouts = fake.gateway.saveQuery.mock.calls.filter(([key]) => key === "tabs").map(([, text]) => JSON.parse(text));
      expect(layouts.at(-1).panes[0].tabs).toHaveLength(2);
    });
  });

  test("a tab on a server that is no longer listed is kept, with no target", async () => {
    const layout = { tabs: [{ id: "t1", serverId: "gone", database: "app" }], active: "t1" };
    render(<App gateway={fakeGateway(undefined, undefined, { queries: withLayout(layout, { "tab:t1": "keep me" }) }).gateway} />);

    expect(await screen.findByLabelText("SQL")).toHaveValue("keep me");
    expect(tab(/^New tab/)).toBeInTheDocument();
  });

  test("the metrics are those of the database the tab in front is on", async () => {
    const fake = await ready();
    await userEvent.click(screen.getByRole("button", { name: "New tab" }));
    await pick(database(), "postgres");

    await waitFor(() => expect(fake.gateway.metrics).toHaveBeenCalledWith("s1", "postgres"));
  });
});

describe("two panes side by side", () => {
  const panes = () => screen.getAllByRole("region");
  const inPane = (index: number) => within(panes()[index]);
  /** The app open on its first server and database, as it is for someone who used it last time. */
  const fresh = async (queries: Record<string, string> = {}) => {
    localStorage.setItem("pgclient.server", "s1");
    localStorage.setItem("pgclient.database.s1", "app");
    const fake = fakeGateway(undefined, undefined, { queries });
    render(<App gateway={fake.gateway} />);
    await screen.findAllByLabelText("SQL");
    await waitFor(() => expect(screen.getAllByRole("tab")[0]).toHaveAttribute("title", "app on Local"));
    return fake;
  };
  const finish = (fake: ReturnType<typeof fakeGateway>, rows: string[][]) =>
    act(() => fake.send({ type: "result_started", columns: ["n"] }, { type: "rows", rows }, { type: "result_finished", rows_affected: rows.length }, { type: "finished", elapsed_ms: 1 }));

  test("there is one pane, with a Split button and no way to move a tab", async () => {
    await fresh();

    expect(panes()).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Split" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Move tab to the other side" })).not.toBeInTheDocument();
  });

  test("Split opens the same database again in a second pane, with an editor of its own", async () => {
    await fresh({ "tabs": JSON.stringify({ tabs: [{ id: "t1", serverId: "s1", database: "app" }], active: "t1" }), "tab:t1": "select 1" });

    await userEvent.click(screen.getByRole("button", { name: "Split" }));

    expect(panes()).toHaveLength(2);
    const editors = screen.getAllByLabelText("SQL");
    expect(editors[0]).toHaveValue("select 1");
    expect(editors[1]).toHaveValue("");
    expect(inPane(1).getAllByRole("tab")[0]).toHaveAttribute("title", "app on Local");
    expect(screen.queryByRole("button", { name: "Split" })).not.toBeInTheDocument();
  });

  test("each pane runs on its own database, and what comes back lands in the pane that asked", async () => {
    const fake = await fresh();
    await userEvent.click(screen.getByRole("button", { name: "Split" }));
    await pick(within(panes()[1]).getByRole("combobox", { name: "Database" }), "postgres");
    await userEvent.type(screen.getAllByLabelText("SQL")[1], "select 2");

    await userEvent.click(inPane(1).getByRole("button", { name: /Run/ }));

    expect(fake.gateway.runQuery).toHaveBeenCalledWith("s1", "postgres", "select 2", expect.any(Function));
    finish(fake, [["from the right"]]);
    expect(await inPane(1).findByText("from the right")).toBeInTheDocument();
    expect(inPane(0).queryByRole("table")).not.toBeInTheDocument();
  });

  test("each pane shows the health of its own database", async () => {
    const fake = await fresh();
    await userEvent.click(screen.getByRole("button", { name: "Split" }));
    await pick(within(panes()[1]).getByRole("combobox", { name: "Database" }), "postgres");

    await waitFor(() => {
      expect(fake.gateway.metrics).toHaveBeenCalledWith("s1", "app");
      expect(fake.gateway.metrics).toHaveBeenCalledWith("s1", "postgres");
    });
    expect(inPane(0).getByLabelText(/Connections/)).toBeInTheDocument();
    expect(inPane(1).getByLabelText(/Connections/)).toBeInTheDocument();
  });

  test("the pane that is clicked in is the one being worked in, and a new tab opens there", async () => {
    await fresh();
    await userEvent.click(screen.getByRole("button", { name: "Split" }));

    await userEvent.click(screen.getAllByLabelText("SQL")[0]);
    await userEvent.click(inPane(0).getByRole("button", { name: "New tab" }));

    expect(inPane(0).getAllByRole("tab")).toHaveLength(2);
    expect(inPane(1).getAllByRole("tab")).toHaveLength(1);
  });

  test("a table's query goes into the editor of the pane being worked in", async () => {
    await fresh({ tabs: JSON.stringify({ tabs: [{ id: "t1", serverId: "s1", database: "app" }], active: "t1" }) });
    await userEvent.click(screen.getByRole("button", { name: "Split" }));
    await userEvent.click(screen.getAllByLabelText("SQL")[0]);

    await userEvent.dblClick(await screen.findByRole("button", { name: /^people/ }));

    expect(screen.getAllByLabelText("SQL")[0].getAttribute("value") ?? (screen.getAllByLabelText("SQL")[0] as HTMLTextAreaElement).value).toContain("people");
    expect((screen.getAllByLabelText("SQL")[1] as HTMLTextAreaElement).value).toBe("");
  });

  test("a tab can be moved to the other pane, and the pane it left keeps the tab beside it", async () => {
    await fresh({ tabs: JSON.stringify({ panes: [{ tabs: [{ id: "a", serverId: "s1", database: "app" }, { id: "b", serverId: "s1", database: "postgres" }], active: "b" }, { tabs: [{ id: "c", serverId: "s1", database: "app" }], active: "c" }], focus: 0 }) });

    await userEvent.click(inPane(0).getByRole("button", { name: "Move tab to the other side" }));

    expect(inPane(0).getAllByRole("tab")).toHaveLength(1);
    expect(inPane(1).getAllByRole("tab")).toHaveLength(2);
    expect(inPane(1).getAllByRole("tab")[1]).toHaveAttribute("title", "postgres on Local");
  });

  test("closing the last tab of a pane closes the pane, and the window is not split any more", async () => {
    await fresh();
    await userEvent.click(screen.getByRole("button", { name: "Split" }));

    await userEvent.click(inPane(1).getByRole("button", { name: /^Close/ }));

    expect(panes()).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Split" })).toBeInTheDocument();
  });

  test("the last tab of the window has nothing to close, even when it is split off", async () => {
    await fresh();

    expect(screen.queryByRole("button", { name: /^Close/ })).not.toBeInTheDocument();
  });

  test("the panes and what was in them come back after a reload, with the one that was worked in", async () => {
    const layout = { panes: [{ tabs: [{ id: "a", serverId: "s1", database: "app" }], active: "a" }, { tabs: [{ id: "b", serverId: "s1", database: "postgres" }], active: "b" }], focus: 1 };
    await fresh({ tabs: JSON.stringify(layout), "tab:a": "select left", "tab:b": "select right" });

    const editors = screen.getAllByLabelText("SQL") as HTMLTextAreaElement[];
    expect(editors.map((editor) => editor.value)).toEqual(["select left", "select right"]);
    expect(inPane(1).getAllByRole("tab")[0]).toHaveAttribute("title", "postgres on Local");
  });

  describe("the line between the panes", () => {
    const handle = () => screen.getByRole("separator", { name: "Resize panes" });

    test("there is one only when the window is split", async () => {
      await fresh();
      expect(screen.queryByRole("separator", { name: "Resize panes" })).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: "Split" }));

      expect(handle()).toHaveAttribute("aria-orientation", "vertical");
    });

    test("the arrow keys move it, and the width is kept for next time", async () => {
      await fresh();
      await userEvent.click(screen.getByRole("button", { name: "Split" }));

      handle().focus();
      fireEvent.keyDown(handle(), { key: "ArrowRight" });

      expect(Number(localStorage.getItem("pgclient.paneWidth"))).toBeGreaterThan(0);
    });

    test("a double click puts it back in the middle", async () => {
      await fresh();
      await userEvent.click(screen.getByRole("button", { name: "Split" }));
      handle().focus();
      fireEvent.keyDown(handle(), { key: "ArrowRight" });

      fireEvent.doubleClick(handle());

      expect(localStorage.getItem("pgclient.paneWidth")).toBeNull();
    });

    test("it is gone when the window is not split any more", async () => {
      await fresh();
      await userEvent.click(screen.getByRole("button", { name: "Split" }));

      await userEvent.click(within(screen.getAllByRole("region")[1]).getByRole("button", { name: /^Close/ }));

      expect(screen.queryByRole("separator", { name: "Resize panes" })).not.toBeInTheDocument();
    });
  });

  test("the layout is written to the file when the window is split", async () => {
    const fake = await fresh();

    await userEvent.click(screen.getByRole("button", { name: "Split" }));

    await waitFor(() => {
      const layouts = fake.gateway.saveQuery.mock.calls.filter(([key]) => key === "tabs").map(([, text]) => JSON.parse(text));
      expect(layouts.at(-1).panes).toHaveLength(2);
      expect(layouts.at(-1).focus).toBe(1);
    });
  });
});

describe("the page of charts", () => {
  const switchTo = (name: string) => userEvent.click(screen.getByText(name, { selector: ".ant-segmented-item-label" }));

  test("each pane can show its database's metrics instead of the editor, and goes back", async () => {
    await ready();
    expect(screen.getByLabelText("SQL")).toBeInTheDocument();

    await switchTo("Metrics");

    expect(await screen.findByRole("region", { name: "Metrics of app" })).toBeInTheDocument();
    expect(screen.queryByLabelText("SQL")).not.toBeInTheDocument();
    expect(screen.getAllByRole("figure")).toHaveLength(7);

    await switchTo("Query");

    expect(screen.getByLabelText("SQL")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Metrics of app" })).not.toBeInTheDocument();
  });

  test("the editor keeps its text while the charts are shown", async () => {
    await ready();
    await userEvent.type(screen.getByLabelText("SQL"), "select 1");

    await switchTo("Metrics");
    await switchTo("Query");

    expect(screen.getByLabelText("SQL")).toHaveValue("select 1");
  });

  test("each pane can show who is connected to its database and what they run", async () => {
    await ready(fakeGateway(undefined, undefined, { sessions: [sessionOf(42, { state: "active", query: "select pg_sleep(9)" })] }));

    await switchTo("Sessions");

    expect(await screen.findByText("select pg_sleep(9)")).toBeInTheDocument();
    expect(screen.queryByLabelText("SQL")).not.toBeInTheDocument();
  });

  test("there is nothing to switch to before a database is chosen", async () => {
    render(<App gateway={fakeGateway().gateway} />);
    await screen.findByRole("combobox", { name: "Server" });

    expect(screen.queryByText("Metrics", { selector: ".ant-segmented-item-label" })).not.toBeInTheDocument();
  });
});

describe("keyboard shortcuts", () => {
  const key = (init: KeyboardEventInit) => act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })));
  const command = (k: string, init: KeyboardEventInit = {}) => key({ key: k, metaKey: true, ...init });
  const tabs = () => screen.getAllByRole("tab");
  beforeEach(() => Object.defineProperty(navigator, "platform", { configurable: true, value: "MacIntel" }));

  test("command T opens a tab and command W closes the one in front", async () => {
    await ready();

    command("t");
    expect(tabs()).toHaveLength(2);
    expect(tabs()[1]).toHaveAttribute("aria-selected", "true");

    command("w");
    expect(tabs()).toHaveLength(1);
  });

  test("command W on the only tab does nothing, so the window is never left with nowhere to work", async () => {
    await ready();

    command("w");

    expect(tabs()).toHaveLength(1);
    expect(screen.getByLabelText("SQL")).toBeInTheDocument();
  });

  test("a number goes to that tab, and nine to the last", async () => {
    await ready();
    command("t");
    command("t");
    expect(tabs()[2]).toHaveAttribute("aria-selected", "true");

    command("1");
    expect(tabs()[0]).toHaveAttribute("aria-selected", "true");

    command("9");
    expect(tabs()[2]).toHaveAttribute("aria-selected", "true");

    command("5");
    expect(tabs()[2]).toHaveAttribute("aria-selected", "true");
  });

  test("control tab goes to the next tab, round to the first, and with shift to the one before", async () => {
    await ready();
    command("t");

    key({ key: "Tab", ctrlKey: true });
    expect(tabs()[0]).toHaveAttribute("aria-selected", "true");

    key({ key: "Tab", ctrlKey: true, shiftKey: true });
    expect(tabs()[1]).toHaveAttribute("aria-selected", "true");
  });

  test("command backslash splits the window, and again puts it back together without losing a tab", async () => {
    await ready();
    command("t");

    command("\\");
    expect(screen.getAllByRole("region")).toHaveLength(2);

    command("\\");
    expect(screen.getAllByRole("region")).toHaveLength(1);
    expect(tabs()).toHaveLength(3);
  });

  test("command option and the arrows move between the panes", async () => {
    await ready();
    command("\\");
    const regions = () => screen.getAllByRole("region");
    expect(regions()[1]).toHaveAccessibleName(/being worked in/);

    command("ArrowLeft", { altKey: true });
    expect(regions()[0]).toHaveAccessibleName(/being worked in/);

    command("ArrowRight", { altKey: true });
    expect(regions()[1]).toHaveAccessibleName(/being worked in/);
  });

  test("the keys the editor and the grid have for themselves are left to them", async () => {
    await ready();
    const copy = new KeyboardEvent("keydown", { key: "c", metaKey: true, bubbles: true, cancelable: true });

    act(() => void window.dispatchEvent(copy));

    expect(copy.defaultPrevented).toBe(false);
  });

  test("a shortcut that is used has its default taken away, so the browser does not also act on it", async () => {
    await ready();
    const open = new KeyboardEvent("keydown", { key: "t", metaKey: true, bubbles: true, cancelable: true });

    act(() => void window.dispatchEvent(open));

    expect(open.defaultPrevented).toBe(true);
  });

  test("control T is not command T on a Mac", async () => {
    await ready();

    key({ key: "t", ctrlKey: true });

    expect(tabs()).toHaveLength(1);
  });
});

describe("adding rows by pasting", () => {
  const source = {
    state: "editable" as const,
    schema: "public",
    table: "people",
    columns: [
      { name: "id", data_type: "integer", nullable: false, has_default: true },
      { name: "name", data_type: "text", nullable: true, has_default: false },
    ],
    key: ["id"],
  };
  const pasteInto = (table: HTMLElement, text: string) => {
    const event = new Event("paste", { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown };
    event.clipboardData = { getData: (type: string) => (type === "text/plain" ? text : "") };
    fireEvent(table, event);
  };

  async function shown() {
    const fake = await ready(fakeGateway(undefined, undefined, { source }));
    await userEvent.type(screen.getByLabelText("SQL"), "select id, name from people");
    await userEvent.click(run());
    act(() =>
      fake.send(
        { type: "result_started", columns: ["id", "name"] },
        { type: "rows", rows: [["1", "ada"], ["2", "grace"]] },
        { type: "result_finished", rows_affected: 2 },
        { type: "finished", elapsed_ms: 4 },
      ),
    );
    await screen.findByRole("table");
    await waitFor(() => expect(screen.getByRole("button", { name: "Delete" })).toHaveAttribute("title", "Select rows to delete"));
    return fake;
  }

  test("saving a pasted row sends it as an insert, with the columns the database makes left out", async () => {
    const fake = await shown();
    pasteInto(screen.getByRole("table"), "9\tnew person");

    await userEvent.click(screen.getByRole("button", { name: /Save/ }));

    expect(fake.gateway.applyChanges).toHaveBeenCalledWith("s1", "app", "public", "people", [{ kind: "insert", values: { name: "new person" } }]);
  });

  test("once rows have been added the statement is run again, so what is shown is what the table holds", async () => {
    const fake = await shown();
    expect(fake.gateway.runQuery).toHaveBeenCalledTimes(1);
    pasteInto(screen.getByRole("table"), "9\tnew person");

    await userEvent.click(screen.getByRole("button", { name: /Save/ }));

    await waitFor(() => expect(fake.gateway.runQuery).toHaveBeenCalledTimes(2));
    expect(fake.gateway.runQuery).toHaveBeenLastCalledWith("s1", "app", "select id, name from people", expect.any(Function));
  });

  test("a save that only deletes or edits does not run the statement again", async () => {
    const fake = await shown();
    await userEvent.click(screen.getByRole("rowheader", { name: "1" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));

    await userEvent.click(screen.getByRole("button", { name: /Save/ }));

    await waitFor(() => expect(fake.gateway.applyChanges).toHaveBeenCalled());
    expect(fake.gateway.runQuery).toHaveBeenCalledTimes(1);
  });

  test("a refusal leaves the pasted row there with the database's words, and the statement is not run again", async () => {
    const message = 'ERROR: duplicate key value violates unique constraint "people_name_key"\nDETAIL: Key (name)=(ada) already exists.';
    const fake = await ready(fakeGateway(undefined, undefined, { source, refuseChanges: message }));
    await userEvent.type(screen.getByLabelText("SQL"), "select id, name from people");
    await userEvent.click(run());
    act(() => fake.send({ type: "result_started", columns: ["id", "name"] }, { type: "rows", rows: [["1", "ada"]] }, { type: "result_finished", rows_affected: 1 }, { type: "finished", elapsed_ms: 1 }));
    await screen.findByRole("table");
    await waitFor(() => expect(screen.getByRole("button", { name: "Delete" })).toHaveAttribute("title", "Select rows to delete"));
    pasteInto(screen.getByRole("table"), "1\tada");

    await userEvent.click(screen.getByRole("button", { name: /Save/ }));

    expect(await screen.findByText(/duplicate key value violates unique constraint/)).toBeInTheDocument();
    expect(screen.getByText(/Key \(name\)=\(ada\) already exists\./)).toBeInTheDocument();
    expect(fake.gateway.runQuery).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole("row")).toHaveLength(1 + 2);
  });
});

describe("explaining a statement", () => {
  const explain = () => screen.getByRole("button", { name: "Explain" });
  const planned = (sql: string) => expect(screen.getByLabelText("SQL")).toHaveValue(sql);

  test("asks Postgres how it would run what is in the editor, without running it, and draws the plan", async () => {
    const fake = await ready();
    await userEvent.type(screen.getByLabelText("SQL"), "select * from people;");
    planned("select * from people;");

    await userEvent.click(explain());

    expect(fake.gateway.runQuery).toHaveBeenCalledWith("s1", "app", "explain (format json) select * from people", expect.any(Function));
    act(() =>
      fake.send(
        { type: "result_started", columns: ["QUERY PLAN"] },
        { type: "rows", rows: [[plainPlan]] },
        { type: "result_finished", rows_affected: 1 },
        { type: "finished", elapsed_ms: 2 },
      ),
    );
    const plan = await screen.findByRole("region", { name: "Plan" });
    expect(within(plan).getByRole("button", { name: /^Seq Scan on job_runs r/ })).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  test("runs nothing when there is more than one statement, as the rest would really run", async () => {
    const fake = await ready();
    await userEvent.type(screen.getByLabelText("SQL"), "select 1; delete from people");

    await userEvent.click(explain());

    expect(fake.gateway.runQuery).not.toHaveBeenCalled();
    expect(await screen.findByText("Explain takes one statement. Select the one to explain.")).toBeInTheDocument();
  });

  test("with Analyze it really runs, inside a transaction that is rolled back", async () => {
    const fake = await ready();
    await userEvent.type(screen.getByLabelText("SQL"), "delete from people");

    await userEvent.click(screen.getByRole("button", { name: "More ways to explain" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Explain Analyze/ }));

    expect(fake.gateway.runQuery).toHaveBeenCalledWith("s1", "app", "begin;\nexplain (analyze, buffers, format json) delete from people;\nrollback;", expect.any(Function));
  });
});

describe("arranging the charts", () => {
  const switchTo = (name: string) => userEvent.click(screen.getByText(name, { selector: ".ant-segmented-item-label" }));
  const titles = () => screen.getAllByRole("figure").map((figure) => figure.getAttribute("aria-label"));

  beforeEach(() => localStorage.removeItem("pgclient.chartOrder"));

  test("a chart is moved by the arrow keys on its grip, and the order is remembered", async () => {
    await ready();
    await switchTo("Metrics");
    await screen.findByRole("region", { name: "Metrics of app" });
    expect(titles().slice(0, 2)).toEqual(["Transactions per second", "Connections"]);

    screen.getByRole("button", { name: "Move Connections" }).focus();
    await userEvent.keyboard("{ArrowLeft}");

    expect(titles().slice(0, 2)).toEqual(["Connections", "Transactions per second"]);
    expect(JSON.parse(localStorage.getItem("pgclient.chartOrder")!).slice(0, 2)).toEqual(["connections", "transactions"]);
  });

  test("a chart dragged by its grip over another takes its place, and the others make way", async () => {
    await ready();
    await switchTo("Metrics");
    await screen.findByRole("region", { name: "Metrics of app" });
    const tile = (title: string) => screen.getByRole("figure", { name: title }).closest("[data-chart]") as HTMLElement;
    vi.spyOn(tile("Transactions per second"), "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 100, height: 50 } as DOMRect);
    vi.spyOn(tile("WAL records"), "getBoundingClientRect").mockReturnValue({ left: 0, top: 100, width: 100, height: 50 } as DOMRect);
    const grip = screen.getByRole("button", { name: "Move WAL records" });

    fireEvent.pointerDown(grip, { button: 0, clientX: 10, clientY: 110 });
    fireEvent.pointerMove(grip, { clientX: 10, clientY: 20 });
    fireEvent.pointerUp(grip);

    expect(titles()[0]).toBe("WAL records");
    expect(JSON.parse(localStorage.getItem("pgclient.chartOrder")!)[0]).toBe("wal");
  });

  test("each chart can be grown over the window", async () => {
    await ready();
    await switchTo("Metrics");
    await screen.findByRole("region", { name: "Metrics of app" });

    await userEvent.click(within(screen.getByRole("figure", { name: "WAL records" })).getByRole("button", { name: "Full screen" }));

    expect(screen.getByRole("dialog", { name: "WAL records" })).toBeInTheDocument();
  });
});
