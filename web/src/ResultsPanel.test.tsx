import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

import type { CatalogTable } from "./gateway";
import type { ResultSet, RunState } from "./results";
import { ResultsPanel } from "./ResultsPanel";
import planText from "./samples/plan.json?raw";

const field = (name: string) => ({ name, data_type: "integer", nullable: false, has_default: false });
const people: ResultSet = {
  columns: ["id", "name"],
  rows: [["1", "ada"], ["2", "grace"]],
  rowsAffected: 2,
  source: { state: "editable", schema: "public", table: "people", columns: [field("id"), field("name")], key: ["id"] },
};
const state: RunState = { status: "done", results: [people], error: null, elapsedMs: 1 };
const catalog: CatalogTable[] = [{ schema: "public", name: "people", kind: "table", columns: [], foreign_keys: [] }];

function setup() {
  render(<ResultsPanel state={state} catalog={catalog} onOpenQuery={vi.fn()} fetchRows={vi.fn()} />);
  return userEvent.setup();
}

const big = () => screen.queryByRole("dialog", { name: "Results" });

test("a pinch on the table grows it over the window, as on the graph", async () => {
  setup();

  fireEvent.wheel(screen.getByRole("table"), { ctrlKey: true, deltaY: -20 });

  expect(big()).toBeInTheDocument();
  expect(screen.getByRole("table")).toBeInTheDocument();
});

test("the table has the full screen button too", async () => {
  const user = setup();

  await user.click(screen.getByRole("button", { name: "Full screen" }));

  expect(big()).toBeInTheDocument();
});

test("switching between table and graph while big keeps it big", async () => {
  const user = setup();
  await user.click(screen.getByRole("button", { name: "Full screen" }));

  await user.click(screen.getByRole("button", { name: "Show as a graph" }));
  expect(big()).toBeInTheDocument();
  expect(screen.getByRole("figure", { name: "Graph of related rows" })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Table" }));
  expect(big()).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
});

test("a plan is not counted as rows at the foot, only the time it took", () => {
  const plan: ResultSet = { columns: ["QUERY PLAN"], rows: [[planText]], rowsAffected: 1 };
  render(<ResultsPanel state={{ status: "done", results: [plan], error: null, elapsedMs: 2 }} />);

  expect(screen.getByText("Plan · 2 ms")).toBeInTheDocument();
  expect(screen.queryByText(/1 row/)).not.toBeInTheDocument();
});
