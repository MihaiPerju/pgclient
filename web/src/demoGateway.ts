import type { ColumnInfo, Gateway, Metrics, QueryEvent, SavedServer, Session, TableInfo } from "./gateway";
import analyzedPlan from "./samples/analyzedPlan.json?raw";
import plan from "./samples/plan.json?raw";

/** Sample data for running the screens in a plain browser, where there is no database to ask. */
const SERVERS: SavedServer[] = [
  { id: "demo-local", name: "Local", host: "localhost", port: 5432, user: "postgres", database: "app", group: "local", source: "file" },
  { id: "demo-staging", name: "Staging - orders", host: "localhost", port: 15432, user: "orders", database: "orders", group: "staging", source: "file" },
  { id: "demo-prod", name: "Prod - orders", host: "localhost", port: 15434, user: "orders", database: "orders", group: "prod", source: "file" },
];

const TABLES: TableInfo[] = [
  { schema: "public", name: "customers", kind: "table" },
  { schema: "public", name: "products", kind: "table" },
  { schema: "public", name: "order_events", kind: "table" },
  { schema: "public", name: "order_items", kind: "table" },
  { schema: "public", name: "invoices", kind: "table" },
  { schema: "public", name: "shipments", kind: "table" },
  { schema: "public", name: "recent_orders", kind: "view" },
  { schema: "public", name: "tags", kind: "table" },
  { schema: "audit", name: "log", kind: "table" },
];

const COLUMNS: ColumnInfo[] = [
  { name: "id", data_type: "uuid", nullable: false, primary_key: true },
  { name: "customer_id", data_type: "uuid", nullable: false, primary_key: false },
  { name: "product_name", data_type: "character varying(255)", nullable: false, primary_key: false },
  { name: "label", data_type: "text", nullable: true, primary_key: false },
  { name: "created_at", data_type: "timestamp with time zone", nullable: false, primary_key: false },
];

const NAMES = ["widget", "gadget", "gizmo", "sprocket", "flange", "bracket"];

function sampleRows(count: number): (string | null)[][] {
  return Array.from({ length: count }, (_, i) => [
    `0b7c${(0x11f8e + i * 977).toString(16)}-4000-72c1-9d5e-${(0xabc000 + i * 31).toString(16)}`,
    "7d3f0a52-91c4-4b8e-a6d1-3c5e2f8b0a14",
    `${NAMES[i % NAMES.length]}-${2026100 + (i % 9)}`,
    i % 4 === 0 ? null : NAMES[(i + 2) % NAMES.length],
    `2026-10-${String(1 + (i % 14)).padStart(2, "0")} 1${i % 10}:2${i % 6}:11+00`,
  ]);
}

/** A database that is busy but healthy, moving a little with every look, so the screens have something to draw. */
let transactions = 4_200_000;
let looks = 0;
let commits = 3_900_000;
let rolledBack = 16_000;
let inserted = 800_000;
let updated = 1_900_000;
let deleted = 120_000;
let fetched = 90_000_000;
let returned = 410_000_000;
let walRecords = 2_300_000_000;
let blocksHit = 981_000_000;
let blocksRead = 3_100_000;

function demoMetrics(server: string, database: string): Metrics {
  looks += 1;
  transactions += 520 + Math.round(Math.sin(looks / 2) * 140 + Math.random() * 60);
  // The demo prod server is busy and, like a real application user, cannot see other people's sessions.
  const busy = server === "demo-prod";
  const wave = Math.sin(looks / 2);
  commits += 480 + Math.round(wave * 130 + Math.random() * 60);
  rolledBack += Math.round(Math.random() * 12 + (looks % 9 === 0 ? 60 : 0));
  inserted += Math.round(300 + Math.random() * 200 + wave * 90);
  updated += Math.round(900 + Math.random() * 400 + wave * 200);
  deleted += Math.round(Math.random() * 120);
  fetched += Math.round(40_000 + Math.random() * 20_000 + wave * 9_000);
  returned += Math.round(180_000 + Math.random() * 80_000 + wave * 40_000);
  walRecords += Math.round(2_400 + Math.random() * 900 + wave * 600);
  blocksHit += Math.round(220_000 + Math.random() * 60_000 + wave * 90_000);
  blocksRead += Math.round(900 + Math.random() * 500 + (looks % 11 === 0 ? 40_000 : 0));
  const connections = (busy ? 84 : 38) + Math.round(Math.sin(looks / 3) * 5 + Math.random() * 3);
  return {
    database,
    connections,
    active: 2 + Math.round(Math.random() * 3),
    idle: connections - 5,
    idle_in_transaction: looks % 7 < 2 ? 1 + (looks % 3) : 0,
    max_connections: 100,
    longest_active_seconds: 1 + Math.random() * 9,
    longest_transaction_seconds: 20 + Math.random() * 60,
    blocked: 0,
    transactions,
    rollbacks: Math.round(transactions * 0.004),
    deadlocks: 0,
    blocks_hit: blocksHit,
    blocks_read: blocksRead,
    commits,
    database_rollbacks: rolledBack,
    tuples_inserted: inserted,
    tuples_updated: updated,
    tuples_deleted: deleted,
    tuples_fetched: fetched,
    tuples_returned: returned,
    wal_records: walRecords,
    sampled_at: Date.now() / 1000,
    full_view: !busy,
  };
}

const demoSession = (pid: number, state: string): Session => ({
  pid,
  user: "app",
  application: "api",
  client: "10.0.0.5",
  state,
  wait_event_type: state === "idle" ? "Client" : null,
  wait_event: state === "idle" ? "ClientRead" : null,
  query: "commit",
  transaction_seconds: null,
  query_seconds: 3,
  state_seconds: 3,
  connected_seconds: 3600,
  blocked_by: [],
});

export const demoGateway: Gateway = {
  listServers: async () => ({ servers: SERVERS, problems: [], file: "~/.pgclient/servers.json" }),
  saveServer: async (draft) => ({ id: "demo-new", name: draft.name, host: draft.host, port: draft.port, user: draft.user }),
  removeServer: async () => {},
  exportServers: async () => JSON.stringify({ version: 1, servers: SERVERS.map(({ name, host, port, user }) => ({ name, host, port, user })) }, null, 2),
  saveFile: async () => null,
  importServers: async () => ({ added: 0, updated: 0, skipped: [] }),
  listDatabases: async () => ["app", "orders", "postgres"],
  listTables: async () => TABLES,
  metrics: async (server, database) => demoMetrics(server, database),
  listColumns: async () => COLUMNS,
  catalog: async () => TABLES.map((table) => ({ ...table, columns: COLUMNS.map(({ name, data_type }) => ({ name, data_type })), foreign_keys: [] })),
  runQuery: async (_server, _database, sql, onEvent) => {
    const emit = (events: QueryEvent[]) => events.forEach((event) => setTimeout(() => onEvent(event), 0));
    // A plan from a sample database, as Postgres gives it, inside the transaction it is analyzed in.
    if (/^(begin;\s*)?explain\b/i.test(sql)) {
      const analyze = /^begin;/i.test(sql);
      const done = (rows_affected: number): QueryEvent[] => (analyze ? [{ type: "result_finished", rows_affected }] : []);
      emit([
        ...done(0),
        { type: "result_started", columns: ["QUERY PLAN"] },
        { type: "rows", rows: [[analyze ? analyzedPlan : plan]] },
        { type: "result_finished", rows_affected: 1 },
        ...done(0),
        { type: "finished", elapsed_ms: analyze ? 4 : 1 },
      ]);
      return 1;
    }
    if (!/\bfrom\b/i.test(sql)) {
      emit([{ type: "failed", message: 'ERROR: column "nope" does not exist' }]);
      return 1;
    }
    const rows = sampleRows(119);
    emit([
      { type: "result_started", columns: COLUMNS.map((column) => column.name) },
      { type: "rows", rows },
      { type: "result_finished", rows_affected: rows.length },
      { type: "finished", elapsed_ms: 80 },
    ]);
    return 1;
  },
  cancelQuery: async () => {},
  sessions: async () => [
    { ...demoSession(4211, "idle in transaction"), application: "worker", query: "update jobs set status = 'SENDING' where id = 7", transaction_seconds: 312, state_seconds: 298 },
    { ...demoSession(4212, "active"), query: "select * from jobs where id = 7 for update", query_seconds: 41, wait_event_type: "Lock", wait_event: "transactionid", blocked_by: [4211] },
    { ...demoSession(4213, "active"), query: "select count(*) from page_views where sent_at > now() - interval '30 days'", query_seconds: 95 },
    demoSession(4214, "idle"),
    demoSession(4215, "idle"),
  ],
  stopSession: async () => true,
  loadQueries: async () => JSON.parse(localStorage.getItem("pgclient.demoQueries") ?? "{}"),
  saveQuery: async (key, text) => {
    const all = JSON.parse(localStorage.getItem("pgclient.demoQueries") ?? "{}");
    if (text.trim() === "") delete all[key];
    else all[key] = text;
    localStorage.setItem("pgclient.demoQueries", JSON.stringify(all));
  },
  describeResult: async () => ({ state: "editable", schema: "public", table: "invoices", columns: COLUMNS.map(({ name, data_type, nullable }) => ({ name, data_type, nullable, has_default: name === "id" || name === "created_at" })), key: ["id"] }),
  applyChanges: async (_server, _database, _schema, _table, changes) => ({ deleted: changes.filter((change) => change.kind === "delete").length, updated: changes.filter((change) => change.kind === "update").length, inserted: changes.filter((change) => change.kind === "insert").length }),
};
