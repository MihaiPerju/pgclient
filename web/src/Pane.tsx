import { DownOutlined, EditOutlined, NodeIndexOutlined, PlayCircleOutlined, PlusOutlined, StopOutlined } from "@ant-design/icons";
import { Button, Dropdown, Flex, Segmented, Select, Space, Typography, theme } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";

import { useCatalog } from "./catalog";
import { applied, buildChanges, editableSource, type Pending } from "./changes";
import { deleteChanges, withoutRows, type RowToDelete } from "./graphDeletes";
import { exportAs, exportFileName, type ExportFormat } from "./exportResult";
import type { Cell, Gateway, SavedServer } from "./gateway";
import { MetricsBar } from "./MetricsBar";
import { MetricsPage } from "./MetricsPage";
import { SessionsPage } from "./SessionsPage";
import { displayName } from "./palette";
import { explainQuery } from "./plan";
import { ResizeHandle, usePaneSize } from "./resize";
import { ResultsPanel } from "./ResultsPanel";
import { applyEvent, idle, starting, type ResultSet, type RunState } from "./results";
import { SqlEditor } from "./SqlEditor";
import { TabBar, type TabView } from "./TabBar";
import { useTheme } from "./theme";
import { textKey, type Tab } from "./tabs";
import { useMetrics } from "./useMetrics";

/** What the editors and the results are never squeezed below, so neither can be dragged out of sight. */
const MIN_EDITOR_HEIGHT = 80;
const MIN_RESULTS_HEIGHT = 120;
/** The line between the editor and the results takes a pixel of the room itself. */
const DIVIDER = 1;
/** A statement that may change what tables there are, after which the suggestions are asked for again. */
const CHANGES_TABLES = /\b(create|alter|drop|rename)\b/i;

/** What the editor holds and the results show in one tab, kept while another is looked at. */
export interface Workspace {
  text: string;
  run: RunState;
}

export const emptyWorkspace: Workspace = { text: "", run: idle };

interface Props {
  gateway: Gateway;
  servers: SavedServer[];
  databasesOf: Record<string, string[]>;
  connecting: boolean;
  /** The tabs of this pane, and the one in front. */
  tabs: Tab[];
  tabViews: TabView[];
  activeId: string;
  /** Every tab's editor and results, which a tab keeps while it is not in front, or not in this pane. */
  workspaces: Record<string, Workspace>;
  /** Whether this is the pane that is being worked in, which the tables panel and the colour of the window follow. */
  focused: boolean;
  /** Whether it is one of two, and so can be closed and not split again. */
  split: boolean;
  /** Called by the pane whenever the tab in front is about to be used, so the window can follow it. */
  onFocus: () => void;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  onSplit: () => void;
  onMove: (id: string) => void;
  onPoint: (change: Partial<Pick<Tab, "serverId" | "database">>) => void;
  onChooseServer: (id: string) => void;
  onChooseDatabase: (name: string) => void;
  onWorkspace: (id: string, change: (workspace: Workspace) => Workspace) => void;
  onRemember: (key: string, text: string) => void;
  onEditServer: (server: SavedServer) => void;
  onAddServer: () => void;
  /** Hands the editor to whoever inserts a table's query: the pane being worked in. */
  registerInsert: (insert: (sql: string) => void) => void;
  onCatalogChanged: () => void;
  catalogReload: number;
  /** Opens a tab beside this one on the same database, holding `sql`, and says which, so it can be run there. */
  onOpenQuery: (sql: string) => string | null;
}

/** One column of the window: its tabs, and for the tab in front, the pickers, the editor, the results and the health of the database. */
export function Pane(props: Props) {
  const { gateway, servers, databasesOf, connecting, tabs, tabViews, activeId, workspaces, focused, split, onWorkspace } = props;
  const { token } = theme.useToken();
  const { dark } = useTheme();
  const active = tabs.find((tab) => tab.id === activeId) ?? null;
  const serverId = active?.serverId ?? null;
  const database = active?.database ?? null;
  const databases = (serverId !== null && databasesOf[serverId]) || [];
  const metrics = useMetrics(gateway, serverId, database);
  const catalog = useCatalog(gateway, serverId, database, props.catalogReload);
  const [selection, setSelection] = useState("");
  /** What the pane shows: the editor and its results, how the database has been doing, or who is connected to it. */
  const [view, setView] = useState<"query" | "metrics" | "sessions">("query");
  const runIds = useRef<Record<string, number>>({});
  /** Counts the runs of each tab, so what is learnt about an earlier run is not put on a later one. */
  const generations = useRef<Record<string, number>>({});
  const mainRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const editorHeight = usePaneSize("pgclient.editorHeight");
  const { text, run } = workspaces[activeId] ?? emptyWorkspace;
  const running = run.status === "running";
  const selected = servers.find((server) => server.id === serverId) ?? null;
  const environment = selected?.environment ?? null;

  useEffect(() => setSelection(""), [activeId]);

  // What is in the editor is read from here and not from the workspace inside the update, which may run more than once.
  const latest = useRef(text);
  latest.current = text;
  const { onRemember } = props;
  const setText = useCallback(
    (value: string | ((current: string) => string)) => {
      const next = typeof value === "function" ? value(latest.current) : value;
      latest.current = next;
      onWorkspace(activeId, (workspace) => ({ ...workspace, text: next }));
      onRemember(textKey(activeId), next);
    },
    [activeId, onWorkspace, onRemember],
  );

  /** A query for a table goes below whatever is in the editor already, which is left alone. */
  const insertQuery = useCallback(
    (sql: string) => {
      setText((current) => (current.trim() === "" ? sql : `${current.replace(/\s+$/, "")}\n\n${sql}`));
      setSelection("");
    },
    [setText],
  );
  const { registerInsert } = props;
  useEffect(() => {
    if (focused) registerInsert(insertQuery);
  }, [focused, insertQuery, registerInsert]);

  async function execute() {
    await runStatement(selection.trim() ? selection : text);
  }

  /** Asks Postgres how it runs the statement, or with `analyze` runs it to see, and shows the plan. */
  async function explain(analyze: boolean) {
    if (!ready || running) return;
    const asked = explainQuery(selection.trim() ? selection : text, analyze);
    if ("problem" in asked) {
      onWorkspace(activeId, (workspace) => ({ ...workspace, run: { ...idle, status: "failed", error: asked.problem } }));
      return;
    }
    await runStatement(asked.sql, activeId, false);
  }

  /** Runs a statement in the tab in front, or in one just opened from it on the same database, and shows what comes back. */
  async function runStatement(sql: string, at = activeId, editable = true) {
    if (!serverId || !database || sql.trim() === "") return;
    const setRun = (change: (state: RunState) => RunState) => onWorkspace(at, (workspace) => ({ ...workspace, run: change(workspace.run) }));
    setRun(() => ({ ...starting, sql }));
    const generation = (generations.current[at] = (generations.current[at] ?? 0) + 1);
    let results = 0;
    try {
      const changesTables = CHANGES_TABLES.test(sql);
      runIds.current[at] = await gateway.runQuery(serverId, database, sql, (event) => {
        setRun((state) => applyEvent(state, event));
        if (event.type === "result_started") results += 1;
        if (event.type === "finished" && changesTables) props.onCatalogChanged();
        if (event.type === "finished" && results === 1 && editable) void learnSource(at, generation, serverId, database, sql);
      });
    } catch (failure) {
      setRun(() => ({ ...idle, status: "failed", error: String(failure) }));
    }
  }

  /** Asks where the rows came from, which says whether they can be deleted and edited. A statement that cannot be described is simply not editable. */
  async function learnSource(at: string, generation: number, server: string, name: string, sql: string) {
    const source = await gateway.describeResult(server, name, sql).catch(() => null);
    if (source === null || generations.current[at] !== generation) return;
    onWorkspace(at, (workspace) => ({
      ...workspace,
      run: workspace.run.results.length === 1 ? { ...workspace.run, results: [{ ...workspace.run.results[0], source }] } : workspace.run,
    }));
  }

  /** Reads the rows of a statement on this tab's database without showing them, as the graph does to follow a link. */
  function fetchRows(sql: string): Promise<{ columns: string[]; rows: Cell[][] }> {
    return new Promise((resolve, reject) => {
      if (!serverId || !database) return reject(new Error("Choose a database first"));
      let columns: string[] = [];
      const rows: Cell[][] = [];
      gateway
        .runQuery(serverId, database, sql, (event) => {
          if (event.type === "result_started") columns = event.columns;
          else if (event.type === "rows") for (const row of event.rows) rows.push(row);
          else if (event.type === "failed") reject(new Error(event.message));
          else if (event.type === "finished") resolve({ columns, rows });
        })
        .catch(reject);
    });
  }

  /** Rows related to the ones shown open in a tab of their own, and are read straight away. */
  function openRelated(sql: string) {
    const id = props.onOpenQuery(sql);
    if (id !== null) void runStatement(sql, id);
  }

  const exportResult = (result: ResultSet, format: ExportFormat) => gateway.saveFile(exportFileName(format), exportAs(format, result));

  async function saveChanges(pending: Pending) {
    const result = run.results[0];
    const source = result && editableSource(result);
    if (!source || !serverId || !database) return;
    await gateway.applyChanges(serverId, database, source.schema, source.table, buildChanges(result, source, pending));
    // Rows that were added have an id and defaults only the database knows, so what is shown is read again. Deletes and edits are known already, and are not worth reading a big result again for.
    if (pending.added.length > 0 && run.sql) {
      await runStatement(run.sql);
      return;
    }
    onWorkspace(activeId, (workspace) => ({ ...workspace, run: { ...workspace.run, results: workspace.run.results.map((shown, index) => (index === 0 ? applied(shown, pending) : shown)) } }));
  }

  /** Deletes the rows of cards, table by table, each found by the primary key the database says it has. What is shown loses the rows that came from its own table. */
  async function deleteGraphRows(rows: RowToDelete[]) {
    const result = run.results[0];
    const source = result && editableSource(result);
    if (!source || !serverId || !database) return;
    const tables = new Map<string, RowToDelete[]>();
    for (const row of rows) tables.set(`${row.schema}.${row.table}`, [...(tables.get(`${row.schema}.${row.table}`) ?? []), row]);
    for (const group of tables.values()) {
      const { schema, table } = group[0];
      const columns = await gateway.listColumns(serverId, database, schema, table);
      const primaryKey = columns.filter((column) => column.primary_key).map((column) => column.name);
      await gateway.applyChanges(serverId, database, schema, table, deleteChanges(group, primaryKey));
    }
    const own = rows.filter((row) => row.schema === source.schema && row.table === source.table).map((row) => row.row);
    onWorkspace(activeId, (workspace) => ({ ...workspace, run: { ...workspace.run, results: workspace.run.results.map((shown, index) => (index === 0 ? withoutRows(shown, own) : shown)) } }));
  }

  function close(id: string) {
    if (id in runIds.current) void gateway.cancelQuery(runIds.current[id]).catch(() => {});
    delete runIds.current[id];
    props.onClose(id);
  }

  const ready = serverId !== null && database !== null && text.trim() !== "";
  const border = `1px solid ${token.colorBorderSecondary}`;

  return (
    <div
      role="region"
      aria-label={split ? (props.focused ? "Pane, being worked in" : "Pane") : "Pane"}
      data-focused={focused}
      className="pg-pane"
      onMouseDownCapture={props.onFocus}
      onFocusCapture={props.onFocus}
      style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, minHeight: 0, background: token.colorBgContainer }}
    >
      <TabBar tabs={tabViews} activeId={activeId} onSelect={props.onSelect} onClose={close} onNew={props.onNew} onSplit={split ? undefined : props.onSplit} onMove={props.onMove} split={split} />
      <Flex gap={8} align="center" wrap style={{ padding: "6px 10px", borderBottom: border, minWidth: 0 }}>
        <Space.Compact>
          <Select
            aria-label="Server"
            placeholder="Server"
            style={{ width: split ? 150 : 200 }}
            value={serverId}
            onChange={props.onChooseServer}
            options={servers.map((server) => ({ value: server.id, label: displayName(server) }))}
          />
          <Button icon={<EditOutlined />} aria-label="Edit server" title={selected?.source === "file" ? "This server comes from the servers file, so it is changed there" : undefined} disabled={selected === null || selected.source === "file"} onClick={() => selected && props.onEditServer(selected)} />
          <Button icon={<PlusOutlined />} aria-label="Add server" onClick={props.onAddServer} />
        </Space.Compact>
        <Select
          aria-label="Database"
          placeholder="Database"
          style={{ width: split ? 130 : 170 }}
          value={database}
          disabled={serverId === null}
          loading={connecting && focused}
          onChange={props.onChooseDatabase}
          options={databases.map((name) => ({ value: name, label: name }))}
        />
        {connecting && focused && <Typography.Text type="secondary">Connecting…</Typography.Text>}
        <Button type="primary" icon={<PlayCircleOutlined />} disabled={!ready || running} onClick={execute}>
          Run
        </Button>
        <Space.Compact>
          <Button icon={<NodeIndexOutlined aria-hidden />} disabled={!ready || running} title="How Postgres would run it, without running it (⌘E)" onClick={() => explain(false)}>
            Explain
          </Button>
          <Dropdown
            trigger={["click"]}
            disabled={!ready || running}
            menu={{
              items: [
                { key: "plan", label: "Explain", extra: "⌘E" },
                { key: "analyze", label: "Explain Analyze: runs it, then rolls back", extra: "⇧⌘E" },
              ],
              onClick: ({ key }) => explain(key === "analyze"),
            }}
          >
            <Button icon={<DownOutlined aria-hidden />} aria-label="More ways to explain" disabled={!ready || running} />
          </Dropdown>
        </Space.Compact>
        {running && (
          <Button danger icon={<StopOutlined />} onClick={() => activeId in runIds.current && gateway.cancelQuery(runIds.current[activeId])}>
            Cancel
          </Button>
        )}
        {serverId !== null && database !== null && (
          <Flex style={{ marginLeft: "auto", minWidth: 0 }}>
            <MetricsBar state={metrics} />
          </Flex>
        )}
      </Flex>
      {serverId !== null && database !== null && (
        <Flex style={{ padding: "4px 10px", borderBottom: border }}>
          <Segmented size="small" aria-label="View" value={view} onChange={(value) => setView(value as typeof view)} options={[{ label: "Query", value: "query" }, { label: "Metrics", value: "metrics" }, { label: "Sessions", value: "sessions" }]} />
        </Flex>
      )}
      {view === "sessions" && serverId !== null && database !== null ? (
        <div style={{ flex: 1, minHeight: 0 }}>
          <SessionsPage gateway={gateway} serverId={serverId} database={database} />
        </div>
      ) : view === "metrics" && serverId !== null && database !== null ? (
        <div style={{ flex: 1, minHeight: 0 }}>
          <MetricsPage state={metrics} database={database} />
        </div>
      ) : (
        <div ref={mainRef} style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
          <div data-pane="editor" ref={editorRef} style={{ height: editorHeight.size ?? "40%", minHeight: MIN_EDITOR_HEIGHT, flexShrink: 0 }}>
            <SqlEditor
              value={text}
              dark={dark}
              environment={environment}
              catalog={catalog}
              onChange={(value, picked) => {
                setText(value);
                setSelection(picked);
              }}
              onRun={execute}
              onExplain={explain}
            />
          </div>
          <ResizeHandle
            orientation="horizontal"
            label="Resize editor"
            size={() => editorHeight.size ?? editorRef.current?.getBoundingClientRect().height ?? 0}
            min={MIN_EDITOR_HEIGHT}
            max={() => Math.max(MIN_EDITOR_HEIGHT, (mainRef.current?.getBoundingClientRect().height ?? 0) - MIN_RESULTS_HEIGHT - DIVIDER)}
            onResize={editorHeight.setSize}
            onReset={editorHeight.reset}
          />
          <div style={{ flex: 1, minHeight: 0 }}>
            <ResultsPanel state={run} onSave={saveChanges} onExport={exportResult} catalog={catalog} onOpenQuery={openRelated} fetchRows={fetchRows} onDeleteRows={deleteGraphRows} />
          </div>
        </div>
      )}
    </div>
  );
}

export type { TabView };
