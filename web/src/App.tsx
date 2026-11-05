import { LayoutOutlined, PlusOutlined, SwapOutlined } from "@ant-design/icons";
import { Alert, Button, Empty, Flex, Spin, Typography, theme } from "antd";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";

import type { Gateway, SavedServer, ServerDraft, ServerList } from "./gateway";
import { emptyWorkspace, Pane, type Workspace } from "./Pane";
import { ResizeHandle, usePaneSize } from "./resize";
import { idle } from "./results";
import { ServerModal } from "./ServerModal";
import { ShareModal } from "./ShareModal";
import { TablesPanel } from "./TablesPanel";
import type { TabView } from "./TabBar";
import { commandFor, onMac, tabForNumber, type Command } from "./shortcuts";
import { ThemeSwitch } from "./ThemeSwitch";
import { useTheme } from "./theme";
import { addTab, closeTab, focusedTab, focusPane, LAYOUT_KEY, mergePanes, moveTab, newTabId, parseLayout, selectTab, serializeLayout, splitPane, tabLabel, tabsOf, textKey, type Layout, type Tab } from "./tabs";

const SERVER_KEY = "pgclient.server";
const databaseKey = (serverId: string) => `pgclient.database.${serverId}`;
const TABLES_KEY = "pgclient.tables";
const PANEL_WIDTH = 280;
const MIN_PANEL_WIDTH = 180;
const MAX_PANEL_WIDTH = 640;
/** Room kept for the work area when the panel is dragged wide. */
const MIN_WORK_AREA = 420;
/** What a pane is never squeezed below, so its toolbar and tabs stay usable. */
const MIN_PANE_WIDTH = 320;
/** How long typing pauses before the text is written to the file, so it is not written at every key. */
const SAVE_DELAY_MS = 400;

/** How the text of an editor was kept before there were tabs: by the server and database it was written for. */
const workspaceKey = (serverId: string | null, database: string | null) => `${serverId ?? ""}\u0000${database ?? ""}`;

const alone: Layout = { panes: [], focus: 0 };

export function App({ gateway }: { gateway: Gateway }) {
  const [list, setList] = useState<ServerList | null>(null);
  const [layout, setLayout] = useState<Layout>(alone);
  /** The databases of each server, asked for once, so going back to a tab does not connect again. */
  const [databasesOf, setDatabasesOf] = useState<Record<string, string[]>>({});
  const [workspaces, setWorkspaces] = useState<Record<string, Workspace>>({});
  const [form, setForm] = useState<{ editing: SavedServer | null } | null>(null);
  const [sharing, setSharing] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [tablesOpen, setTablesOpen] = useState(() => localStorage.getItem(TABLES_KEY) !== "closed");
  const [catalogReload, setCatalogReload] = useState(0);
  const { token } = theme.useToken();
  const { setEnvironment } = useTheme();
  const refreshCatalog = useCallback(() => setCatalogReload((count) => count + 1), []);
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  /** The text kept before there were tabs, handed to the first tab that is pointed at the server and database it was written for. */
  const legacy = useRef<Record<string, string>>({});
  /** Puts a table's query in the editor of the pane being worked in. */
  const insert = useRef<(sql: string) => void>(() => {});
  /** Does what a shortcut asks, with the layout as it is when the key is pressed. */
  const shortcut = useRef<(command: Command) => void>(() => {});
  const registerInsert = useCallback((next: (sql: string) => void) => (insert.current = next), []);
  const asideRef = useRef<HTMLElement>(null);
  const sidebar = usePaneSize("pgclient.sidebarWidth");
  const leftPane = usePaneSize("pgclient.paneWidth");
  const leftRef = useRef<HTMLDivElement>(null);
  const panesRef = useRef<HTMLDivElement>(null);

  const front = focusedTab(layout);
  const serverId = front?.serverId ?? null;
  const database = front?.database ?? null;
  const servers = list?.servers ?? null;

  const updateWorkspace = useCallback((at: string, change: (workspace: Workspace) => Workspace) => {
    setWorkspaces((all) => ({ ...all, [at]: change(all[at] ?? emptyWorkspace) }));
  }, []);
  const updateTab = useCallback((id: string, change: (tab: Tab) => Tab) => {
    setLayout((all) => ({ ...all, panes: all.panes.map((pane) => ({ ...pane, tabs: pane.tabs.map((tab) => (tab.id === id ? change(tab) : tab)) })) }));
  }, []);
  /** What is in each editor, and which tabs are open, is kept in a file, so it is there again after a reload. */
  const remember = useCallback(
    (at: string, value: string) => {
      clearTimeout(saveTimers.current[at]);
      saveTimers.current[at] = setTimeout(() => void gateway.saveQuery(at, value).catch(() => {}), SAVE_DELAY_MS);
    },
    [gateway],
  );
  const reload = useCallback(() => gateway.listServers().then(setList), [gateway]);

  // The servers and what was kept of the tabs are read together, so the tabs that come back are on servers that are there.
  useEffect(() => {
    Promise.all([gateway.listServers(), gateway.loadQueries().catch(() => ({}) as Record<string, string>)]).then(([found, saved]) => {
      let kept = parseLayout(saved[LAYOUT_KEY], found.servers.map((server) => server.id));
      if (!kept) {
        const last = localStorage.getItem(SERVER_KEY);
        const serverOfLast = last && found.servers.some((server) => server.id === last) ? last : null;
        const id = newTabId();
        kept = { panes: [{ tabs: [{ id, serverId: serverOfLast, database: serverOfLast ? localStorage.getItem(databaseKey(serverOfLast)) : null }], active: id }], focus: 0 };
        legacy.current = saved;
      }
      const texts: Record<string, Workspace> = {};
      for (const tab of tabsOf(kept)) texts[tab.id] = { ...emptyWorkspace, text: saved[textKey(tab.id)] ?? "" };
      setList(found);
      setLayout(kept);
      setWorkspaces((all) => ({ ...texts, ...all }));
    });
  }, [gateway]);

  useEffect(() => {
    if (layout.panes.length > 0) remember(LAYOUT_KEY, serializeLayout(layout));
  }, [layout, remember]);

  // A tab pointed at a server and database that had text written for it before there were tabs takes that text, once, if it has none of its own.
  useEffect(() => {
    if (!front || serverId === null || database === null) return;
    const old = legacy.current[workspaceKey(serverId, database)];
    if (old === undefined) return;
    delete legacy.current[workspaceKey(serverId, database)];
    updateWorkspace(front.id, (workspace) => (workspace.text ? workspace : { ...workspace, text: old }));
  }, [front, serverId, database, updateWorkspace]);

  // The servers file is edited outside the app, so what it holds is read again whenever the window comes back.
  useEffect(() => {
    window.addEventListener("focus", reload);
    return () => window.removeEventListener("focus", reload);
  }, [reload]);

  // The front tab of each pane: its server's databases are asked for if they are not known yet, and a tab with no database, or one that is gone, gets the one that was last used.
  const fronts = layout.panes.map((pane) => pane.tabs.find((tab) => tab.id === pane.active)).filter((tab): tab is Tab => !!tab);
  const wanted = fronts.map((tab) => `${tab.id}\u0000${tab.serverId ?? ""}`).join("\n");
  useEffect(() => {
    const cancels: (() => void)[] = [];
    for (const tab of fronts) {
      const id = tab.serverId;
      if (id === null) continue;
      const choose = (found: string[]) => {
        const last = localStorage.getItem(databaseKey(id));
        const own = servers?.find((server) => server.id === id)?.database;
        updateTab(tab.id, (now) => ({ ...now, database: now.database && found.includes(now.database) ? now.database : last && found.includes(last) ? last : own && found.includes(own) ? own : null }));
      };
      if (databasesOf[id]) {
        choose(databasesOf[id]);
        continue;
      }
      let current = true;
      setConnecting(true);
      gateway
        .listDatabases(id)
        .then((found) => {
          if (!current) return;
          setDatabasesOf((all) => ({ ...all, [id]: found }));
          choose(found);
        })
        .catch((failure) => current && updateWorkspace(tab.id, (workspace) => ({ ...workspace, run: { ...idle, status: "failed", error: String(failure) } })))
        .finally(() => current && setConnecting(false));
      cancels.push(() => {
        current = false;
        setConnecting(false);
      });
    }
    return () => cancels.forEach((cancel) => cancel());
  }, [gateway, wanted]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleTables = useCallback(() => {
    setTablesOpen((open) => {
      localStorage.setItem(TABLES_KEY, open ? "closed" : "open");
      return !open;
    });
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") {
        event.preventDefault();
        toggleTables();
        return;
      }
      const wanted = commandFor(event, onMac());
      if (wanted === null) return;
      event.preventDefault();
      shortcut.current(wanted);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleTables]);

  /** What a tab shows belongs to the database it was run on, so pointing it somewhere else leaves the text and drops the results. */
  function pointTab(id: string, change: Partial<Pick<Tab, "serverId" | "database">>) {
    updateTab(id, (tab) => ({ ...tab, ...change }));
    updateWorkspace(id, (workspace) => ({ ...workspace, run: idle }));
  }

  function newTab() {
    setLayout((now) => addTab(now, { id: newTabId(), serverId: focusedTab(now)?.serverId ?? null, database: focusedTab(now)?.database ?? null }));
  }

  function dropTab(id: string) {
    clearTimeout(saveTimers.current[textKey(id)]);
    void gateway.saveQuery(textKey(id), "").catch(() => {});
    setLayout((now) => closeTab(now, id));
    setWorkspaces((all) => Object.fromEntries(Object.entries(all).filter(([at]) => at !== id)));
  }

  /** A tab at the end of a pane, on the database of the tab in front there, holding `sql`. */
  function openQuery(index: number, sql: string): string | null {
    const pane = layout.panes[index];
    const from = pane?.tabs.find((tab) => tab.id === pane.active);
    if (!from) return null;
    const id = newTabId();
    setLayout((now) => addTab(focusPane(now, index), { id, serverId: from.serverId, database: from.database }));
    updateWorkspace(id, () => ({ ...emptyWorkspace, text: sql }));
    remember(textKey(id), sql);
    return id;
  }

  /** Opens the front tab of the pane being worked in a second time, in a pane of its own, so the same database can be looked at in two places. */
  function splitWindow() {
    setLayout((now) => {
      const open = focusedTab(now);
      return splitPane(now, { id: newTabId(), serverId: open?.serverId ?? null, database: open?.database ?? null });
    });
  }

  shortcut.current = (command) => {
    const pane = layout.panes[layout.focus];
    if (!pane) return;
    switch (command.kind) {
      case "new-tab":
        newTab();
        break;
      case "close-tab":
        if (pane.active) dropTab(pane.active);
        break;
      case "go-to-tab": {
        const at = tabForNumber(pane.tabs.length, command.number);
        if (at !== null) setLayout((now) => selectTab(now, pane.tabs[at].id));
        break;
      }
      case "next-tab": {
        const at = pane.tabs.findIndex((tab) => tab.id === pane.active);
        setLayout((now) => selectTab(now, pane.tabs[(at + command.step + pane.tabs.length) % pane.tabs.length].id));
        break;
      }
      case "toggle-split":
        if (layout.panes.length > 1) setLayout((now) => mergePanes(now));
        else splitWindow();
        break;
      case "go-to-pane":
        setLayout((now) => focusPane(now, Math.min(now.panes.length - 1, Math.max(0, now.focus + command.step))));
        break;
    }
  };

  async function saveServer(draft: ServerDraft) {
    const saved = await gateway.saveServer(draft);
    await reload();
    setForm(null);
    localStorage.setItem(SERVER_KEY, saved.id);
    if (front) pointTab(front.id, { serverId: saved.id, database: null });
  }

  const environment = servers?.find((server) => server.id === serverId)?.environment ?? null;
  useEffect(() => setEnvironment(environment), [environment, setEnvironment]);

  if (servers === null || layout.panes.length === 0) {
    return (
      <Flex align="center" justify="center" style={{ height: "100%" }}>
        <Spin />
      </Flex>
    );
  }

  const sharingModal = <ShareModal open={sharing} gateway={gateway} onImported={reload} onClose={() => setSharing(false)} />;

  if (servers.length === 0 && form === null) {
    return (
      <Flex vertical align="center" justify="center" style={{ height: "100%" }}>
        <Empty description="No servers yet">
          <Flex vertical gap="small" align="center">
            <Flex gap="small">
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setForm({ editing: null })}>
                Add server
              </Button>
              <Button icon={<SwapOutlined />} onClick={() => setSharing(true)}>
                Import / export
              </Button>
            </Flex>
            {list?.file && <Typography.Text type="secondary">Or list them in {list.file} and they appear here.</Typography.Text>}
            {list?.problems.map((problem) => (
              <Alert key={problem} type="warning" showIcon title={problem} />
            ))}
          </Flex>
        </Empty>
        {sharingModal}
      </Flex>
    );
  }

  const border = `1px solid ${token.colorBorderSecondary}`;
  const viewOf = (tab: Tab): TabView => ({ id: tab.id, ...tabLabel(tab, servers), busy: workspaces[tab.id]?.run.status === "running" });

  return (
    <Flex vertical style={{ height: "100%", background: token.colorBgLayout }}>
      <Flex component="header" gap={8} align="center" style={{ padding: "6px 12px", borderBottom: border }}>
        <Button
          type={tablesOpen ? "default" : "text"}
          icon={<LayoutOutlined />}
          aria-label="Toggle tables panel"
          aria-pressed={tablesOpen}
          title="Tables (⌘B)"
          onClick={toggleTables}
        />
        <Button type="text" icon={<SwapOutlined />} aria-label="Import / export" title="Import / export servers" onClick={() => setSharing(true)} />
        <Flex style={{ marginLeft: "auto" }}>
          <ThemeSwitch />
        </Flex>
      </Flex>
      {list?.problems.map((problem) => (
        <Alert key={problem} type="warning" showIcon title={problem} style={{ margin: "4px 8px 0" }} />
      ))}
      <Flex style={{ flex: 1, minHeight: 0 }}>
        {tablesOpen && (
          <>
            <aside ref={asideRef} style={{ width: sidebar.size ?? PANEL_WIDTH, flexShrink: 0, minHeight: 0 }}>
              <TablesPanel gateway={gateway} serverId={serverId} database={database} onInsert={(sql) => insert.current(sql)} onRefresh={refreshCatalog} />
            </aside>
            <ResizeHandle
              orientation="vertical"
              label="Resize tables panel"
              size={() => sidebar.size ?? PANEL_WIDTH}
              min={MIN_PANEL_WIDTH}
              max={() => Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, window.innerWidth - MIN_WORK_AREA))}
              onResize={sidebar.setSize}
              onReset={sidebar.reset}
            />
          </>
        )}
        <div ref={panesRef} style={{ display: "flex", flex: 1, minWidth: 0, background: token.colorBgContainer }}>
          {layout.panes.map((pane, index) => {
            const split = layout.panes.length > 1;
            const view = (
              <Pane
                key={index}
                gateway={gateway}
                servers={servers}
                databasesOf={databasesOf}
                connecting={connecting}
                tabs={pane.tabs}
                tabViews={pane.tabs.map(viewOf)}
                activeId={pane.active}
                workspaces={workspaces}
                focused={layout.focus === index}
                split={split}
                onFocus={() => setLayout((now) => focusPane(now, index))}
                onSelect={(id) => setLayout((now) => selectTab(now, id))}
                onClose={dropTab}
                onNew={newTab}
                onSplit={splitWindow}
                onMove={(id) => setLayout((now) => moveTab(now, id))}
                onPoint={(change) => pointTab(pane.active, change)}
                onChooseServer={(id) => {
                  localStorage.setItem(SERVER_KEY, id);
                  pointTab(pane.active, { serverId: id, database: null });
                }}
                onChooseDatabase={(name) => {
                  const at = pane.tabs.find((tab) => tab.id === pane.active)?.serverId;
                  if (at) localStorage.setItem(databaseKey(at), name);
                  pointTab(pane.active, { database: name });
                }}
                onWorkspace={updateWorkspace}
                onRemember={remember}
                onEditServer={(server) => setForm({ editing: server })}
                onAddServer={() => setForm({ editing: null })}
                registerInsert={registerInsert}
                onCatalogChanged={refreshCatalog}
                catalogReload={catalogReload}
                onOpenQuery={(sql) => openQuery(index, sql)}
              />
            );
            // The first of two is as wide as it was dragged to, or half, and the other takes what is left. It is kept inside the room there is, however the window is resized.
            if (!(split && index === 0)) return view;
            return (
              <Fragment key={index}>
                <div
                  ref={leftRef}
                  style={{ display: "flex", flex: leftPane.size === null ? "1 1 0" : "none", width: leftPane.size ?? undefined, minWidth: MIN_PANE_WIDTH, maxWidth: `calc(100% - ${MIN_PANE_WIDTH}px)` }}
                >
                  {view}
                </div>
                <ResizeHandle
                  orientation="vertical"
                  label="Resize panes"
                  size={() => leftPane.size ?? leftRef.current?.getBoundingClientRect().width ?? 0}
                  min={MIN_PANE_WIDTH}
                  max={() => Math.max(MIN_PANE_WIDTH, (panesRef.current?.getBoundingClientRect().width ?? 0) - MIN_PANE_WIDTH - 1)}
                  onResize={leftPane.setSize}
                  onReset={leftPane.reset}
                />
              </Fragment>
            );
          })}
        </div>
      </Flex>
      {sharingModal}
      <ServerModal open={form !== null} editing={form?.editing ?? null} onSave={saveServer} onClose={() => setForm(null)} />
    </Flex>
  );
}
