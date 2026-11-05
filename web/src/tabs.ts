import type { Environment, SavedServer } from "./gateway";
import { displayName } from "./palette";

/** One place to work in: a database of a server, with its own editor and results, which is found by its id. */
export interface Tab {
  id: string;
  serverId: string | null;
  database: string | null;
}

/** The tabs of one column of the window, and the one that is in front in it. */
export interface PaneLayout {
  tabs: Tab[];
  active: string;
}

/** The columns of the window, side by side, and the one the person is working in, which the pickers and the tables panel follow. */
export interface Layout {
  panes: PaneLayout[];
  focus: number;
}

export const MAX_PANES = 2;
export const LAYOUT_KEY = "tabs";
export const textKey = (id: string) => `tab:${id}`;

export const newTabId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export const tabsOf = (layout: Layout): Tab[] => layout.panes.flatMap((pane) => pane.tabs);
export const paneOf = (layout: Layout, id: string) => layout.panes.findIndex((pane) => pane.tabs.some((tab) => tab.id === id));

/** The tab that is in front in the pane that is being worked in. */
export function focusedTab(layout: Layout): Tab | null {
  const pane = layout.panes[layout.focus];
  return pane?.tabs.find((tab) => tab.id === pane.active) ?? null;
}

function readTabs(raw: unknown, serverIds: string[], seen: Set<string>): Tab[] {
  const tabs: Tab[] = [];
  for (const entry of Array.isArray(raw) ? raw : []) {
    const { id, serverId, database } = (entry ?? {}) as Record<string, unknown>;
    if (typeof id !== "string" || id === "" || seen.has(id)) continue;
    seen.add(id);
    const known = typeof serverId === "string" && serverIds.includes(serverId);
    tabs.push({ id, serverId: known ? serverId : null, database: known && typeof database === "string" ? database : null });
  }
  return tabs;
}

/** What was kept, if it can be used: a tab whose server is gone from the servers list is kept without a target, so the text in it is not lost.
 * What was kept before the window could be split, a list of tabs with one in front, is one pane. */
export function parseLayout(text: string | undefined, serverIds: string[]): Layout | null {
  if (!text) return null;
  let found: unknown;
  try {
    found = JSON.parse(text);
  } catch {
    return null;
  }
  const kept = (found ?? {}) as { panes?: unknown; tabs?: unknown; active?: unknown; focus?: unknown };
  const raw: { tabs?: unknown; active?: unknown }[] = Array.isArray(kept.panes) ? kept.panes : Array.isArray(kept.tabs) ? [{ tabs: kept.tabs, active: kept.active }] : [];
  const seen = new Set<string>();
  const panes: PaneLayout[] = [];
  for (const pane of raw) {
    if (panes.length === MAX_PANES) break;
    const tabs = readTabs(pane?.tabs, serverIds, seen);
    if (tabs.length === 0) continue;
    panes.push({ tabs, active: tabs.some((tab) => tab.id === pane.active) ? (pane.active as string) : tabs[0].id });
  }
  if (panes.length === 0) return null;
  const focus = typeof kept.focus === "number" && Number.isInteger(kept.focus) && kept.focus >= 0 && kept.focus < panes.length ? kept.focus : 0;
  return { panes, focus };
}

export const serializeLayout = (layout: Layout) => JSON.stringify(layout);

/** Brings a tab to the front of its pane, and works in that pane. */
export function selectTab(layout: Layout, id: string): Layout {
  const at = paneOf(layout, id);
  if (at < 0) return layout;
  return { focus: at, panes: layout.panes.map((pane, index) => (index === at ? { ...pane, active: id } : pane)) };
}

export const focusPane = (layout: Layout, index: number): Layout => (layout.focus === index || !layout.panes[index] ? layout : { ...layout, focus: index });

/** A tab at the end of the pane that is being worked in, and in front. */
export function addTab(layout: Layout, tab: Tab): Layout {
  return { focus: layout.focus, panes: layout.panes.map((pane, index) => (index === layout.focus ? { tabs: [...pane.tabs, tab], active: tab.id } : pane)) };
}

/** Takes a tab away, and its pane with it if it was the last there. The last tab of all stays, so there is always somewhere to work. */
export function closeTab(layout: Layout, id: string): Layout {
  if (tabsOf(layout).length <= 1) return layout;
  const at = paneOf(layout, id);
  if (at < 0) return layout;
  const pane = layout.panes[at];
  const position = pane.tabs.findIndex((tab) => tab.id === id);
  const rest = pane.tabs.filter((tab) => tab.id !== id);
  if (rest.length === 0) {
    const panes = layout.panes.filter((_, index) => index !== at);
    return { panes, focus: layout.focus === at ? Math.min(at, panes.length - 1) : layout.focus > at ? layout.focus - 1 : layout.focus };
  }
  const active = pane.active === id ? rest[Math.min(position, rest.length - 1)].id : pane.active;
  return { ...layout, panes: layout.panes.map((one, index) => (index === at ? { tabs: rest, active } : one)) };
}

/** Opens another pane beside the first, holding the tab given, and works in it. */
export function splitPane(layout: Layout, tab: Tab): Layout {
  if (layout.panes.length >= MAX_PANES) return layout;
  return { focus: layout.panes.length, panes: [...layout.panes, { tabs: [tab], active: tab.id }] };
}

/** Puts every tab back in one pane, the ones of the pane worked in first, and loses none of them. */
export function mergePanes(layout: Layout): Layout {
  if (layout.panes.length < 2) return layout;
  const worked = layout.panes[layout.focus];
  const others = layout.panes.filter((_, index) => index !== layout.focus);
  return { focus: 0, panes: [{ tabs: [...worked.tabs, ...others.flatMap((pane) => pane.tabs)], active: worked.active }] };
}

/** Moves a tab to the other pane, or to a pane of its own beside this one when there is only one, which needs another tab left behind. */
export function moveTab(layout: Layout, id: string): Layout {
  const from = paneOf(layout, id);
  if (from < 0) return layout;
  const split = layout.panes.length >= MAX_PANES;
  if (!split && layout.panes[from].tabs.length <= 1) return layout;
  const tab = layout.panes[from].tabs.find((candidate) => candidate.id === id)!;
  const position = layout.panes[from].tabs.indexOf(tab);
  const panes: PaneLayout[] = layout.panes.map((pane, index) => {
    if (index !== from) return pane;
    const rest = pane.tabs.filter((candidate) => candidate.id !== id);
    return { tabs: rest, active: pane.active === id ? (rest[Math.min(position, rest.length - 1)]?.id ?? "") : pane.active };
  });
  if (split) panes[1 - from] = { tabs: [...panes[1 - from].tabs, tab], active: id };
  else panes.push({ tabs: [tab], active: id });
  const kept = panes.filter((pane) => pane.tabs.length > 0);
  return { panes: kept, focus: kept.findIndex((pane) => pane.tabs.some((candidate) => candidate.id === id)) };
}

/** What a tab is called: the database first, since that is what tells tabs apart, then the server it is on. */
export function tabLabel(tab: Tab, servers: Pick<SavedServer, "id" | "name" | "environment">[]): { label: string; title: string; environment: Environment | null } {
  const server = servers.find((candidate) => candidate.id === tab.serverId);
  if (!server) return { label: "New tab", title: "Choose a server and a database", environment: null };
  const name = displayName(server);
  return {
    label: tab.database ?? name,
    title: tab.database ? `${tab.database} on ${name}` : name,
    environment: server.environment ?? null,
  };
}
