import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { readPlan } from "./plan";
import { PlanView } from "./PlanView";
import analyzed from "./samples/analyzedPlan.json?raw";
import plain from "./samples/plan.json?raw";

const step = (name: RegExp) => within(screen.getByRole("group", { name: "Steps" })).getByRole("button", { name });
const details = () => screen.getByRole("complementary", { name: "Step" });

test("draws every step as a bar, the first one across the whole width", () => {
  render(<PlanView plan={readPlan(plain)} />);

  const plan = screen.getByRole("region", { name: "Plan" });
  expect(within(plan).getAllByRole("button", { name: /^(Sort|Aggregate|Hash Join|Hash|Seq Scan)/ })).toHaveLength(6);
  expect(step(/^Sort/)).toHaveStyle({ left: "0%", width: "100%" });
});

test("says when the numbers are only the planner's guesses", () => {
  render(<PlanView plan={readPlan(plain)} />);

  expect(screen.getByText(/Not run: costs are the planner's estimates/)).toBeInTheDocument();
});

test("once run, says how long it took", () => {
  render(<PlanView plan={readPlan(analyzed)} />);

  expect(screen.getByText(/^Ran in \d/)).toBeInTheDocument();
});

test("starts on the step that took most of its own, and clicking another shows that one", async () => {
  render(<PlanView plan={readPlan(plain)} />);
  expect(within(details()).getByText("Seq Scan on job_runs r")).toBeInTheDocument();

  await userEvent.click(step(/^Hash Join/));

  expect(step(/^Hash Join/)).toHaveAttribute("aria-pressed", "true");
  expect(within(details()).getByText("Hash Join")).toBeInTheDocument();
  expect(within(details()).getByText("(r.job_id = c.id)")).toBeInTheDocument();
});

test("lists what may be wrong, and each leads to its step", async () => {
  render(<PlanView plan={readPlan(analyzed)} />);
  await userEvent.click(step(/^Sort/));

  const found = screen.getByRole("list", { name: "Worth a look" });
  await userEvent.click(within(found).getByRole("button", { name: /Read 50,000 rows to keep 1,000/ }));

  expect(step(/^Seq Scan on job_runs r/)).toHaveAttribute("aria-pressed", "true");
  expect(within(details()).getByText(/Read 50,000 rows to keep 1,000/)).toBeInTheDocument();
});

test("a step with something wrong says so in its name", () => {
  render(<PlanView plan={readPlan(analyzed)} />);

  expect(step(/^Seq Scan on job_runs r, 1 thing worth a look/)).toBeInTheDocument();
});

test("a new plan starts again on its own busiest step", async () => {
  const { rerender } = render(<PlanView plan={readPlan(plain)} />);
  await userEvent.click(step(/^Aggregate/));

  rerender(<PlanView plan={readPlan(analyzed)} />);

  expect(step(/^Hash Join/)).toHaveAttribute("aria-pressed", "false");
  expect(step(/^Seq Scan on job_runs r/)).toHaveAttribute("aria-pressed", "true");
});

test("the step's counters that stayed at nothing are folded away, and can be shown", async () => {
  render(<PlanView plan={readPlan(analyzed)} />);
  await userEvent.click(step(/^Hash Join/));
  expect(within(details()).queryByText("Temp Read Blocks")).not.toBeInTheDocument();

  await userEvent.click(within(details()).getByRole("button", { name: /^Show \d+ that are 0 or off$/ }));

  expect(within(details()).getByText("Temp Read Blocks")).toBeInTheDocument();
});
