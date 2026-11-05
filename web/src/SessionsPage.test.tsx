import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SessionsPage } from "./SessionsPage";
import { fakeGateway, sessionOf } from "./test/fakeGateway";

const holder = sessionOf(10, { state: "idle in transaction", state_seconds: 400, transaction_seconds: 420, query: "update jobs set status = 'x'" });
const waiter = sessionOf(11, { state: "active", blocked_by: [10], wait_event_type: "Lock", wait_event: "relation", query: "select * from jobs", query_seconds: 30 });
const resting = sessionOf(12, { state: "idle", query: "commit" });

function setup(sessions = [holder, waiter, resting]) {
  const fake = fakeGateway(undefined, undefined, { sessions });
  render(<SessionsPage gateway={fake.gateway} serverId="s1" database="app" />);
  return fake;
}

const row = (pid: number) => screen.getByRole("row", { name: new RegExp(`^${pid}\\b`) });

test("lists the sessions holding others up first, with what is wrong with each, and leaves out the idle", async () => {
  setup();

  await screen.findByText("update jobs set status = 'x'");
  const rows = screen.getAllByRole("row").slice(1);
  expect(rows.map((one) => within(one).getAllByRole("cell")[0].textContent)).toEqual(["10", "11"]);
  expect(within(row(10)).getByText("Blocking 1 session")).toBeInTheDocument();
  expect(within(row(11)).getByText("Waiting for a lock held by 10")).toBeInTheDocument();
  expect(screen.queryByText("commit")).not.toBeInTheDocument();
});

test("the idle can be shown too", async () => {
  setup();
  await userEvent.click(await screen.findByRole("switch", { name: "Show 1 idle" }));

  expect(screen.getByText("commit")).toBeInTheDocument();
});

test("cancelling a query asks the database, and looks again", async () => {
  const fake = setup();
  await screen.findByText("select * from jobs");

  await userEvent.click(within(row(11)).getByRole("button", { name: "Cancel query" }));

  expect(fake.gateway.stopSession).toHaveBeenCalledWith("s1", "app", 11, "cancel");
  await waitFor(() => expect(fake.gateway.sessions).toHaveBeenCalledTimes(2));
});

test("ending a session asks first, as it drops the connection and rolls back its transaction", async () => {
  const fake = setup();
  await screen.findByText("update jobs set status = 'x'");

  await userEvent.click(within(row(10)).getByRole("button", { name: "End session" }));
  expect(fake.gateway.stopSession).not.toHaveBeenCalled();
  await userEvent.click(await screen.findByRole("button", { name: "End it" }));

  expect(fake.gateway.stopSession).toHaveBeenCalledWith("s1", "app", 10, "terminate");
});

test("says so when the database will not let the user stop a session", async () => {
  const fake = setup();
  fake.gateway.stopSession.mockRejectedValue("permission denied to cancel query");
  await screen.findByText("select * from jobs");

  await userEvent.click(within(row(11)).getByRole("button", { name: "Cancel query" }));

  expect(await screen.findByText("permission denied to cancel query")).toBeInTheDocument();
});

test("says when nothing is going on", async () => {
  setup([resting]);

  expect(await screen.findByText("Nothing running. 1 idle session.")).toBeInTheDocument();
});
