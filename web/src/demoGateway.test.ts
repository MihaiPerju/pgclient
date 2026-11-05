import type { QueryEvent } from "./gateway";
import { demoGateway } from "./demoGateway";

test("it has a few servers, with databases and tables to browse", async () => {
  const { servers } = await demoGateway.listServers();
  const databases = await demoGateway.listDatabases(servers[0].id);
  const tables = await demoGateway.listTables(servers[0].id, databases[0]);

  expect(servers.length).toBeGreaterThan(1);
  expect(databases.length).toBeGreaterThan(0);
  expect(tables.some((table) => table.kind === "view")).toBe(true);
  expect((await demoGateway.listColumns(servers[0].id, databases[0], tables[0].schema, tables[0].name)).length).toBeGreaterThan(0);
});

test("a query answers like the real thing: columns, rows, then the end", async () => {
  const events: QueryEvent[] = [];

  await demoGateway.runQuery("demo-local", "app", "select * from products", (event) => events.push(event));
  await new Promise((resolve) => setTimeout(resolve, 50));

  expect(events[0]).toMatchObject({ type: "result_started" });
  expect(events.some((event) => event.type === "rows")).toBe(true);
  expect(events.at(-1)).toMatchObject({ type: "finished" });
});

test("a query it cannot answer fails the way a mistake would", async () => {
  const events: QueryEvent[] = [];

  await demoGateway.runQuery("demo-local", "app", "select nope", (event) => events.push(event));
  await new Promise((resolve) => setTimeout(resolve, 50));

  expect(events.at(-1)).toMatchObject({ type: "failed" });
});

test("it reports how a database is doing, with counters that only go up so rates can be worked out", async () => {
  const first = await demoGateway.metrics("demo-staging", "orders");
  await new Promise((resolve) => setTimeout(resolve, 20));
  const second = await demoGateway.metrics("demo-staging", "orders");

  expect(first.database).toBe("orders");
  expect(first.max_connections).toBeGreaterThan(first.connections);
  expect(second.transactions).toBeGreaterThan(first.transactions);
  expect(second.sampled_at).toBeGreaterThan(first.sampled_at);
});

test("explaining gives a plan, from a sample run when it is analyzed", async () => {
  const plans: string[] = [];
  const collect = (event: QueryEvent) => event.type === "rows" && plans.push(event.rows[0][0] as string);

  await demoGateway.runQuery("demo-local", "app", "explain (format json) select * from products", collect);
  await demoGateway.runQuery("demo-local", "app", "begin;\nexplain (analyze, buffers, format json) select * from products;\nrollback;", collect);
  await new Promise((resolve) => setTimeout(resolve, 50));

  expect(plans.map((plan) => "Execution Time" in JSON.parse(plan)[0])).toEqual([false, true]);
});

test("it has sessions to look at, one holding up another", async () => {
  const sessions = await demoGateway.sessions("demo-local", "app");

  expect(sessions.some((session) => session.blocked_by.length > 0)).toBe(true);
  expect(sessions.some((session) => session.state === "idle")).toBe(true);
  expect(await demoGateway.stopSession("demo-local", "app", sessions[0].pid, "cancel")).toBe(true);
});
