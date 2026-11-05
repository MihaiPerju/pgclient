import { vi } from "vitest";

import type { CatalogTable, Change, ColumnInfo, Gateway, ImportReport, Metrics, QueryEvent, ResultSource, SavedServer, ServerDraft, ServerList, Session, Stop, TableInfo } from "../gateway";

export const local: SavedServer = { id: "s1", name: "Local", host: "localhost", port: 5432, user: "postgres" };
export const people: TableInfo = { schema: "public", name: "people", kind: "table" };
export const adults: TableInfo = { schema: "public", name: "adults", kind: "view" };
export const audit: TableInfo = { schema: "audit", name: "log", kind: "table" };

export const peopleColumns: ColumnInfo[] = [
  { name: "id", data_type: "integer", nullable: false, primary_key: true },
  { name: "name", data_type: "text", nullable: true, primary_key: false },
];

/** A database at rest: a few connections, nothing running, everything healthy. Tests change what they care about. */
export const metricsSnapshot = (overrides: Partial<Metrics> = {}): Metrics => ({
  database: "app",
  connections: 12,
  active: 2,
  idle: 9,
  idle_in_transaction: 0,
  max_connections: 100,
  longest_active_seconds: 1.5,
  blocked: 0,
  transactions: 100_000,
  rollbacks: 100,
  deadlocks: 0,
  blocks_hit: 990_000,
  blocks_read: 1_000,
  commits: 90_000,
  database_rollbacks: 100,
  tuples_inserted: 1_000,
  tuples_updated: 2_000,
  tuples_deleted: 300,
  tuples_fetched: 50_000,
  tuples_returned: 400_000,
  wal_records: 5_000_000,
  sampled_at: 1_000_000,
  full_view: true,
  ...overrides,
});

/** A session as `pg_stat_activity` has it: idle, and nothing worth pointing out. Tests change what they care about. */
export const sessionOf = (pid: number, overrides: Partial<Session> = {}): Session => ({
  pid,
  user: "app",
  application: "api",
  client: "10.0.0.1",
  state: "idle",
  wait_event_type: null,
  wait_event: null,
  query: "select 1",
  transaction_seconds: null,
  query_seconds: 1,
  state_seconds: 1,
  connected_seconds: 100,
  blocked_by: [],
  ...overrides,
});

export const staging: SavedServer = { id: "s2", name: "Staging", host: "db.staging", port: 5432, user: "app" };

/** A gateway that answers from memory, and lets a test decide when the database says what. */
export function fakeGateway(
  servers: SavedServer[] = [local, staging],
  databases: Record<string, string[]> = { s1: ["app", "postgres"], s2: ["staging"] },
  extras: { problems?: string[]; file?: string | null; source?: ResultSource; refuseChanges?: string; queries?: Record<string, string>; sessions?: Session[] } = {},
) {
  let emit: (event: QueryEvent) => void = () => {};
  let samples = 0;
  const gateway = {
    listServers: vi.fn(async (): Promise<ServerList> => ({ servers, problems: extras.problems ?? [], file: extras.file ?? null })),
    saveServer: vi.fn(async (draft: ServerDraft): Promise<SavedServer> => {
      const saved = { id: draft.id ?? "new", name: draft.name, host: draft.host, port: draft.port, user: draft.user, database: draft.database, group: draft.group };
      servers = [...servers.filter((s) => s.id !== saved.id), saved];
      return saved;
    }),
    removeServer: vi.fn(async (id: string) => {
      servers = servers.filter((s) => s.id !== id);
    }),
    saveFile: vi.fn(async (_fileName: string, _contents: string): Promise<string | null> => "/tmp/result"),
    exportServers: vi.fn(async (includePasswords: boolean) => JSON.stringify({ version: 1, servers: [{ name: "Local", passwords: includePasswords }] })),
    importServers: vi.fn(async (): Promise<ImportReport> => ({ added: 1, updated: 0, skipped: [] })),
    metrics: vi.fn(async (): Promise<Metrics> => {
      samples += 1;
      // Five seconds go by between samples, and 600 transactions happen in them: 120 a second.
      return metricsSnapshot({ transactions: 100_000 + samples * 600, sampled_at: 1_000_000 + samples * 5 });
    }),
    sessions: vi.fn(async (_server: string, _database: string): Promise<Session[]> => extras.sessions ?? []),
    stopSession: vi.fn(async (_server: string, _database: string, _pid: number, _how: Stop): Promise<boolean> => true),
    listTables: vi.fn(async (): Promise<TableInfo[]> => [adults, people, audit]),
    listColumns: vi.fn(async (): Promise<ColumnInfo[]> => peopleColumns),
    catalog: vi.fn(async (): Promise<CatalogTable[]> => [
      { ...people, columns: peopleColumns.map(({ name, data_type }) => ({ name, data_type })), foreign_keys: [] },
      { ...audit, columns: [{ name: "at", data_type: "timestamp with time zone" }], foreign_keys: [] },
    ]),
    listDatabases: vi.fn(async (serverId: string) => databases[serverId] ?? []),
    runQuery: vi.fn(async (_server: string, _database: string, _sql: string, onEvent: (event: QueryEvent) => void) => {
      emit = onEvent;
      return 7;
    }),
    cancelQuery: vi.fn(async () => {}),
    loadQueries: vi.fn(async (): Promise<Record<string, string>> => extras.queries ?? {}),
    saveQuery: vi.fn(async (_key: string, _text: string) => {}),
    describeResult: vi.fn(async (_server: string, _database: string, _sql: string): Promise<ResultSource> => extras.source ?? { state: "read_only", reason: "Only a single query can be edited" }),
    applyChanges: vi.fn(async (_server: string, _database: string, _schema: string, _table: string, changes: Change[]) => {
      if (extras.refuseChanges) throw extras.refuseChanges;
      return { deleted: changes.filter((change) => change.kind === "delete").length, updated: changes.filter((change) => change.kind === "update").length, inserted: changes.filter((change) => change.kind === "insert").length };
    }),
  } satisfies Gateway;
  return { gateway, send: (...events: QueryEvent[]) => events.forEach((event) => emit(event)) };
}
