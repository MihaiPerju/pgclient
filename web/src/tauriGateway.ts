import { Channel, invoke } from "@tauri-apps/api/core";

import type { Gateway, QueryEvent } from "./gateway";

export const tauriGateway: Gateway = {
  listServers: () => invoke("list_servers"),
  saveServer: (draft) => invoke("save_server", { draft }),
  removeServer: (id) => invoke("remove_server", { id }),
  exportServers: (includePasswords) => invoke("export_servers", { includePasswords }),
  saveFile: (fileName, contents) => invoke("save_file", { fileName, contents }),
  importServers: (text) => invoke("import_servers", { text }),
  metrics: (serverId, database) => invoke("metrics", { serverId, database }),
  sessions: (serverId, database) => invoke("sessions", { serverId, database }),
  stopSession: (serverId, database, pid, how) => invoke("stop_session", { serverId, database, pid, how }),
  listTables: (serverId, database) => invoke("list_tables", { serverId, database }),
  listColumns: (serverId, database, schema, table) => invoke("list_columns", { serverId, database, schema, table }),
  catalog: (serverId, database) => invoke("catalog", { serverId, database }),
  listDatabases: (serverId) => invoke("list_databases", { serverId }),
  runQuery: (serverId, database, sql, onEvent) => {
    const events = new Channel<QueryEvent>();
    events.onmessage = onEvent;
    return invoke("run_query", { serverId, database, sql, onEvent: events });
  },
  cancelQuery: (id) => invoke("cancel_query", { id }),
  loadQueries: () => invoke("load_queries"),
  saveQuery: (key, text) => invoke("save_query", { key, text }),
  describeResult: (serverId, database, sql) => invoke("describe_result", { serverId, database, sql }),
  applyChanges: (serverId, database, schema, table, changes) => invoke("apply_changes", { serverId, database, schema, table, changes }),
};
