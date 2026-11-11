export type Cell = string | null;

export type QueryEvent =
  | { type: "result_started"; columns: string[] }
  | { type: "rows"; rows: Cell[][] }
  | { type: "result_finished"; rows_affected: number }
  | { type: "failed"; message: string }
  | { type: "finished"; elapsed_ms: number };

/** Where a server sits on the way to production. Shown beside its name, and the editor's text is tinted by it. */
export type Environment = "local" | "dev" | "staging" | "prod";

export const ENVIRONMENTS: Environment[] = ["local", "dev", "staging", "prod"];

export interface SavedServer {
  id: string;
  name: string;
  host: string;
  port: number;
  user: string;
  /** Opened first when the server is chosen, if it is one of its databases. */
  database?: string | null;
  group?: string | null;
  environment?: Environment | null;
  /** Where it was set up: in the app, or in the servers file, where it is also changed. */
  source?: "app" | "file";
}

/** Everything to choose from, and what went wrong reading it, so a typo in the file never makes servers vanish silently. */
export interface ServerList {
  servers: SavedServer[];
  problems: string[];
  /** The servers file being read, if there is one. */
  file: string | null;
}

/** How a database is doing at one moment. The counters only go up, so a rate is the change between two of these over the time between them. */
export interface Metrics {
  database: string;
  connections: number;
  active: number;
  idle: number;
  idle_in_transaction: number;
  max_connections: number;
  longest_active_seconds: number | null;
  /** How long the oldest open transaction has been open, running or idle, or null when none is. */
  longest_transaction_seconds: number | null;
  blocked: number;
  transactions: number;
  rollbacks: number;
  deadlocks: number;
  blocks_hit: number;
  blocks_read: number;
  /** What happened in this database alone, as counters that only go up. */
  commits: number;
  database_rollbacks: number;
  tuples_inserted: number;
  tuples_updated: number;
  tuples_deleted: number;
  tuples_fetched: number;
  tuples_returned: number;
  /** Records written to the write-ahead log by the whole server, or null before Postgres 14, which does not count them. */
  wal_records: number | null;
  /** Seconds since 1970 by the server's clock. */
  sampled_at: number;
  /** False when the user can only see their own sessions, so what others are doing is left out of the counts. */
  full_view: boolean;
}

/** A connection to the database and what it is doing now, as `pg_stat_activity` has it. Times are seconds until now. */
export interface Session {
  pid: number;
  user: string | null;
  application: string;
  client: string | null;
  /** active, idle, idle in transaction, … or null when the user may not see it. */
  state: string | null;
  wait_event_type: string | null;
  wait_event: string | null;
  /** What it runs, or last ran when idle. */
  query: string | null;
  transaction_seconds: number | null;
  query_seconds: number | null;
  state_seconds: number | null;
  connected_seconds: number | null;
  /** The sessions holding a lock it waits for. */
  blocked_by: number[];
}

/** Stopping a session: its query only, or the whole connection. */
export type Stop = "cancel" | "terminate";

/** A column of the table a result was read from. */
export interface SourceColumn {
  name: string;
  data_type: string;
  nullable: boolean;
  /** Whether the database fills the column in when a row is added without a value for it, as for a serial number or `now()`. */
  has_default: boolean;
}

/** Whether the rows of a result can be changed in the table they came from: they must all come from one table, with its whole primary key among them. */
export type ResultSource =
  | {
      state: "editable";
      schema: string;
      table: string;
      /** For each column of the result, the table's column it shows, or nothing for one that is worked out and so cannot be changed. */
      columns: (SourceColumn | null)[];
      /** The primary key, by which a row is found again. */
      key: string[];
    }
  | { state: "read_only"; reason: string };

/** A row of a table to remove or change, found by its primary key, and with the new values by column name. */
export type Change =
  | { kind: "delete"; key: Record<string, Cell> }
  | { kind: "update"; key: Record<string, Cell>; set: Record<string, Cell> }
  /** A new row: only the columns given are set, and the database fills in the rest. */
  | { kind: "insert"; values: Record<string, Cell> };

export type TableKind = "table" | "view" | "materialized_view" | "foreign_table";

export interface TableInfo {
  schema: string;
  name: string;
  kind: TableKind;
}

export interface ColumnInfo {
  name: string;
  /** As Postgres writes it, such as "character varying(20)". */
  data_type: string;
  nullable: boolean;
  primary_key: boolean;
}

/** A table with all its columns, as the catalog gives it for suggestions while typing. */
export interface CatalogTable {
  schema: string;
  name: string;
  kind: TableKind;
  columns: { name: string; data_type: string }[];
  /** What its columns point at, in the order they pair up, from which a join's condition can be suggested. */
  foreign_keys: { columns: string[]; references_schema: string; references_table: string; references_columns: string[] }[];
}

export interface ImportReport {
  added: number;
  updated: number;
  /** Why each entry that could not be read was left out. */
  skipped: string[];
}

/** What the form holds. Without an id it is a new server, and without a password an edit keeps the old one. */
export interface ServerDraft {
  id: string | null;
  name: string;
  host: string;
  port: number;
  user: string;
  database: string | null;
  group: string | null;
  environment: Environment | null;
  password: string | null;
}

/** The only thing the screens know about whatever runs the queries: the desktop shell today, a web server if there is ever one. */
export interface Gateway {
  listServers(): Promise<ServerList>;
  saveServer(draft: ServerDraft): Promise<SavedServer>;
  removeServer(id: string): Promise<void>;
  /** The servers as a file that can be imported again anywhere. */
  exportServers(includePasswords: boolean): Promise<string>;
  /** Asks where to save, and writes `contents` there. Resolves with the path, or null if the person changed their mind. */
  saveFile(fileName: string, contents: string): Promise<string | null>;
  /** Takes a servers file, or a list of postgres:// addresses. */
  importServers(text: string): Promise<ImportReport>;
  listDatabases(serverId: string): Promise<string[]>;
  listTables(serverId: string, database: string): Promise<TableInfo[]>;
  metrics(serverId: string, database: string): Promise<Metrics>;
  /** Who is connected to the database and what each is doing, leaving out the connections that only watch it. */
  sessions(serverId: string, database: string): Promise<Session[]>;
  /** Resolves with whether the session was there to stop, or rejects with why the user may not. */
  stopSession(serverId: string, database: string, pid: number, how: Stop): Promise<boolean>;
  listColumns(serverId: string, database: string, schema: string, table: string): Promise<ColumnInfo[]>;
  /** Every table and its columns at once, for suggestions while typing. */
  catalog(serverId: string, database: string): Promise<CatalogTable[]>;
  /** Resolves with the id of the run once it has started, while the events keep coming. */
  runQuery(serverId: string, database: string, sql: string, onEvent: (event: QueryEvent) => void): Promise<number>;
  cancelQuery(id: number): Promise<void>;
  /** What was last written in the editor of each server and database, by the key the app made for it, kept between runs. */
  loadQueries(): Promise<Record<string, string>>;
  /** Keeps the text of one editor, or forgets it if it is empty. */
  saveQuery(key: string, text: string): Promise<void>;
  /** Where the rows `sql` gives come from, and so whether they can be changed. Reads nothing: the database only describes the statement. */
  describeResult(serverId: string, database: string, sql: string): Promise<ResultSource>;
  /** Deletes and changes the rows all together or not at all. Rejects with why it could not, and then nothing is changed. */
  applyChanges(serverId: string, database: string, schema: string, table: string, changes: Change[]): Promise<{ deleted: number; updated: number; inserted: number }>;
}
