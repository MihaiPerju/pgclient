import { ApartmentOutlined, CheckOutlined, ClockCircleOutlined, DeleteOutlined, EyeInvisibleOutlined, LoadingOutlined, PushpinFilled, PushpinOutlined, SaveOutlined, TableOutlined, UndoOutlined } from "@ant-design/icons";
import { Alert, Button, Dropdown, Flex, Typography, theme, type MenuProps } from "antd";
import { useEffect, useRef, useState, type PointerEvent } from "react";

import type { CatalogTable, Cell } from "./gateway";
import { addRelated, cardHeight, collapse, edgePath, extent, layout, NODE_WIDTH, cardsBetween, cardsIn, nodeId, relationKey, startGraph, type Graph, type GraphNode, type Projection } from "./graph";
import { defaultFields, loadFields, saveFields, togglePinned } from "./graphFields";
import type { RowToDelete } from "./graphDeletes";
import { Kbd } from "./Kbd";
import { MagnifyButton, type Magnify } from "./Magnified";
import { ResizeHandle, usePaneSize } from "./resize";
import { isDateType, readable, useReadableDates } from "./readableDates";
import { useTheme } from "./theme";
import { relatedKeys, relatedQuery, relationLabel, tableRelations, type Relation } from "./related";
import type { ResultSet } from "./results";

const MARGIN = 24;
const ALL_LINKS = "\u0000all";
const DETAILS_WIDTH = 280;
const MIN_DETAILS_WIDTH = 220;
/** How much of the graph stays in view however wide the row at the side is dragged. */
const MIN_CANVAS_WIDTH = 240;
/** One hue for each table, the same wherever it is drawn: indigo, teal, amber, rose, violet, cyan, coral, sage. */
const TABLE_HUES = [228, 165, 38, 340, 265, 192, 12, 95];

/** A table's colours, muted so a graph of many tables stays calm: the text of its name, the stripe down its cards, and the tint behind their headers. */
export function colorOf(schema: string, table: string, dark: boolean): { text: string; stripe: string; tint: string } {
  let hash = 0;
  for (const char of `${schema}.${table}`) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  const hue = TABLE_HUES[Math.abs(hash) % TABLE_HUES.length];
  return dark
    ? { text: `hsl(${hue} 32% 70%)`, stripe: `hsl(${hue} 28% 52%)`, tint: `hsl(${hue} 30% 60% / 0.08)` }
    : { text: `hsl(${hue} 30% 38%)`, stripe: `hsl(${hue} 32% 66%)`, tint: `hsl(${hue} 40% 55% / 0.07)` };
}

const shown = (value: Cell) => (value === null ? "NULL" : value);
const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** Values longer than this, or of more lines, are folded to `FOLDED_LINES` until unfolded. */
const FOLD_CHARACTERS = 200;
const FOLDED_LINES = 3;

export const isLong = (value: Cell) => value !== null && (value.length > FOLD_CHARACTERS || value.split("\n").length > FOLDED_LINES);

/** A value of the row shown at the side: a long one, such as a whole HTML document, is folded to a few lines, with a link that says how long it is. */
function LongValue({ value, text = shown(value), unfolded, onUnfold }: { value: Cell; text?: string; unfolded: boolean; onUnfold: (open: boolean) => void }) {
  const { token } = theme.useToken();
  const long = isLong(value);
  const folded = long && !unfolded;
  return (
    <dd style={{ margin: 0 }}>
      <div
        style={{
          wordBreak: "break-all",
          whiteSpace: "pre-wrap",
          color: value === null ? token.colorTextTertiary : undefined,
          ...(folded ? { display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: FOLDED_LINES, overflow: "hidden" } : {}),
        }}
      >
        {text}
      </div>
      {long && (
        <Button size="small" type="link" style={{ padding: 0, height: "auto", fontSize: 11, fontFamily: "inherit" }} onClick={() => onUnfold(folded)}>
          {folded ? `Show all · ${value!.length.toLocaleString()} characters` : "Show less"}
        </Button>
      )}
    </dd>
  );
}

export type FetchRows = (sql: string) => Promise<{ columns: string[]; rows: Cell[][] }>;

const ALL: Projection = { rows: null, columns: null };

/** The rows of a result read from one table as cards. Clicking one reads the rows it links to, both ways, and draws them in the next column, joined to it.
 * `only` narrows it to the rows and columns selected in the table, until all are asked for. */
export function GraphView({ result, only = ALL, catalog, fetchRows, onBack, magnify, onDeleteRows }: { result: ResultSet; only?: Projection; catalog: CatalogTable[]; fetchRows: FetchRows; onBack: () => void; magnify?: Magnify; onDeleteRows?: (rows: RowToDelete[]) => Promise<void> }) {
  const { token } = theme.useToken();
  const { dark } = useTheme();
  const source = result.source?.state === "editable" ? result.source : null;
  const readableDates = useReadableDates();
  const [scope, setScope] = useState(only);
  const begin = (from: Projection): Graph => (source ? startGraph(source.schema, source.table, result.columns, from.rows ? from.rows.map((at) => result.rows[at]) : result.rows) : { nodes: [], edges: [] });
  const [graph, setGraph] = useState<Graph>(() => begin(only));
  // The card whose row is shown at the side, the cards picked to act on together, and the cards hidden from view.
  const [selected, setSelected] = useState<string | null>(null);
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  // The cards crossed out to be deleted, which they are only once saved.
  const [doomed, setDoomed] = useState<ReadonlySet<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const rowsBefore = useRef(result.rows);
  // Where cards were dragged to, by card, in the graph's own coordinates.
  const [placed, setPlaced] = useState<ReadonlyMap<string, { x: number; y: number }>>(new Map());
  const [problem, setProblem] = useState<string | null>(null);
  const row = useRef<HTMLDivElement>(null);
  // The width the row at the side was dragged to, kept for next time.
  const details = usePaneSize("pgclient.graphDetailsWidth");
  // Fields chosen for each table's cards this session, null once reset; tables not in it read what was remembered.
  const [chosen, setChosen] = useState<Record<string, string[] | null>>({});

  const storedFields = (schema: string, table: string) => {
    const key = `${schema}.${table}`;
    return key in chosen ? chosen[key] : loadFields(schema, table);
  };
  // The columns selected show on the cards of the table they were selected in, without being remembered, until fields are pinned.
  const projected = (node: GraphNode) => (scope.columns && source && node.schema === source.schema && node.table === source.table && !(`${node.schema}.${node.table}` in chosen) ? scope.columns : null);
  const fieldsOf = (node: GraphNode) => {
    const stored = (projected(node) ?? storedFields(node.schema, node.table))?.filter((name) => node.columns.includes(name));
    return stored?.length
      ? stored
      : defaultFields(
          node.columns,
          catalog.find((table) => table.schema === node.schema && table.name === node.table),
        );
  };
  const display = (node: GraphNode, name: string, value: Cell) => {
    if (!readableDates.on || value === null) return shown(value);
    const type = catalog.find((table) => table.schema === node.schema && table.name === node.table)?.columns.find((column) => column.name === name)?.data_type;
    return type !== undefined && isDateType(type) ? readable(value) : value;
  };
  const setFields = (node: GraphNode, fields: string[] | null) => {
    saveFields(node.schema, node.table, fields);
    setChosen((now) => ({ ...now, [`${node.schema}.${node.table}`]: fields }));
  };

  useEffect(() => {
    // Rows that only went, as after cards were deleted, leave the graph as it is, with the cards that were opened.
    const before = rowsBefore.current;
    rowsBefore.current = result.rows;
    if (result.rows.length < before.length && result.rows.every((row) => before.includes(row))) return;
    setDoomed(new Set());
    setGraph(begin(scope));
    setSelected(null);
    setSelection(new Set());
    setHidden(new Set());
    setPlaced(new Map());
  }, [source?.schema, source?.table, result.columns, result.rows, scope]); // eslint-disable-line react-hooks/exhaustive-deps

  // The links being read, by node and link, so each shows its own spinner.
  const [loading, setLoading] = useState<ReadonlySet<string>>(new Set());
  const loadingKey = (node: GraphNode, key: string) => `${node.id}\u0002${key}`;
  const isLoading = (node: GraphNode) => [...loading].some((at) => at.startsWith(`${node.id}\u0002`));
  // The card whose links menu is open, and where its button is.
  const [menuFor, setMenuFor] = useState<{ id: string; x: number; y: number } | null>(null);
  const linksOf = (node: GraphNode) => tableRelations(catalog, node.schema, node.table, node.columns);

  /** Reads and draws the rows of each link, each as it arrives. */
  async function openLinks(node: GraphNode, relations: Relation[]) {
    setProblem(null);
    await Promise.all(
      relations.map(async (relation) => {
        const at = loadingKey(node, relationKey(relation));
        const keys = relatedKeys(relation, [node.row]);
        if (keys.length === 0) return;
        setLoading((now) => new Set(now).add(at));
        try {
          const { columns, rows } = await fetchRows(relatedQuery(relation, keys));
          setGraph((now) => addRelated(now, node.id, [{ relation, columns, rows }]));
          // Opening a link is asking to see its rows, hidden or not.
          setHidden((now) => {
            if (now.size === 0) return now;
            const next = new Set(now);
            for (const one of rows) next.delete(nodeId(relation.schema, relation.table, one));
            return next;
          });
        } catch (failure) {
          setProblem(String(failure));
        } finally {
          setLoading((now) => {
            const next = new Set(now);
            next.delete(at);
            return next;
          });
        }
      }),
    );
  }

  function pickLink(node: GraphNode, choice: string) {
    const relations = linksOf(node);
    if (choice === ALL_LINKS) {
      const shut = relations.filter((relation) => !node.opened.includes(relationKey(relation)) && !loading.has(loadingKey(node, relationKey(relation))));
      if (shut.length === 0) setGraph((now) => collapse(now, node.id));
      else void openLinks(node, shut);
      return;
    }
    const relation = relations.find((one) => relationKey(one) === choice);
    if (!relation || loading.has(loadingKey(node, choice))) return;
    if (node.opened.includes(choice)) setGraph((now) => collapse(now, node.id, choice));
    else void openLinks(node, [relation]);
  }

  /** What the links menu of a card lists: all of them at once, then each, by which way it points, ticked when open. */
  function linkItems(node: GraphNode): MenuProps["items"] {
    const relations = linksOf(node);
    const readable = relations.filter((relation) => relatedKeys(relation, [node.row]).length > 0);
    const allOpen = readable.length > 0 && readable.every((relation) => node.opened.includes(relationKey(relation)));
    const mark = (relation: Relation) => {
      const key = relationKey(relation);
      if (loading.has(loadingKey(node, key))) return <LoadingOutlined aria-hidden />;
      if (node.opened.includes(key)) return <CheckOutlined aria-hidden style={{ color: token.colorPrimary }} />;
      return <span aria-hidden style={{ display: "inline-block", width: 14 }} />;
    };
    return [
      { key: ALL_LINKS, label: allOpen ? "Close all" : "Open all", disabled: readable.length === 0 },
      { type: "divider" },
      ...(["references", "referenced_by"] as const)
        .map((direction) => ({ direction, links: relations.filter((relation) => relation.direction === direction) }))
        .filter(({ links }) => links.length > 0)
        .map(({ direction, links }) => ({
          type: "group" as const,
          key: direction,
          label: direction === "references" ? "Points to" : "Points here",
          children: links.map((relation) => {
            const empty = relatedKeys(relation, [node.row]).length === 0;
            return { key: relationKey(relation), icon: mark(relation), disabled: empty, label: empty ? `${relationLabel(relation, node.columns)} · no value` : relationLabel(relation, node.columns) };
          }),
        })),
    ];
  }

  // Long values of the row shown at the side are folded; the columns unfolded stay so for every row of their table.
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(new Set());
  const unfold = (key: string, open: boolean) =>
    setUnfolded((now) => {
      const next = new Set(now);
      if (open) next.add(key);
      else next.delete(key);
      return next;
    });

  const menuNode = menuFor ? graph.nodes.find((node) => node.id === menuFor.id) : undefined;

  /** A click picks one card; with Command, Control or Shift it adds the card to those picked, or takes it out. The row at the side is the last clicked. */
  // The card a shift-click picks from: the last one clicked without Shift.
  const anchor = useRef<string | null>(null);

  /** A click picks one card; with Command or Control it adds the card to those picked, or takes it out; with Shift it picks every card from
   * the one clicked before to this one, so a long run is picked with two clicks. The row at the side is the last clicked. */
  function clickCard(node: GraphNode, how: "one" | "toggle" | "range") {
    setSelected(node.id);
    if (how === "range" && anchor.current) return setSelection(new Set(cardsBetween(boxes, anchor.current, node.id)));
    anchor.current = node.id;
    setSelection((now) => {
      if (how === "one" || how === "range") return new Set([node.id]);
      const next = new Set(now);
      if (next.has(node.id)) next.delete(node.id);
      else next.add(node.id);
      return next;
    });
  }
  const clickKind = (event: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }) => (event.shiftKey ? "range" : event.metaKey || event.ctrlKey ? "toggle" : "one");

  // A box dragged across empty canvas picks the cards it touches, added to those already picked when Command, Control or Shift is held.
  const figure = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const [band, setBand] = useState<{ from: { x: number; y: number }; to: { x: number; y: number }; base: ReadonlySet<string> } | null>(null);
  const canvasPoint = (event: PointerEvent) => {
    const at = canvas.current!.getBoundingClientRect();
    return { x: event.clientX - at.left, y: event.clientY - at.top };
  };

  function startBand(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !canvas.current || (event.target as HTMLElement).closest("[role=group]")) return;
    event.preventDefault();
    figure.current?.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const point = canvasPoint(event);
    setBand({ from: point, to: point, base: event.metaKey || event.ctrlKey || event.shiftKey ? selection : new Set() });
  }

  function moveBand(event: PointerEvent<HTMLDivElement>) {
    if (!band) return;
    const to = canvasPoint(event);
    setBand({ ...band, to });
    const area = { left: Math.min(band.from.x, to.x) - MARGIN, right: Math.max(band.from.x, to.x) - MARGIN, top: Math.min(band.from.y, to.y) - MARGIN, bottom: Math.max(band.from.y, to.y) - MARGIN };
    setSelection(new Set([...band.base, ...cardsIn(boxes, area)]));
  }

  // A press that did not move is a click on empty canvas, which lets go of the picked cards.
  function endBand() {
    if (!band) return;
    if (Math.hypot(band.to.x - band.from.x, band.to.y - band.from.y) < 4) setSelection(band.base);
    setBand(null);
  }

  /** Takes the picked cards out of view, and their edges with them, until they are shown again. */
  function hide() {
    if (selection.size === 0) return;
    figure.current?.focus({ preventScroll: true });
    setHidden((now) => new Set([...now, ...selection]));
    if (selected && selection.has(selected)) setSelected(null);
    if (menuFor && selection.has(menuFor.id)) setMenuFor(null);
    setSelection(new Set());
  }

  /** Crosses out the picked cards, or lets them go again when every one of them was crossed out already. */
  function markDeleting() {
    if (!onDeleteRows || saving || selection.size === 0) return;
    const ids = [...selection];
    setDoomed((now) => (ids.every((id) => now.has(id)) ? new Set([...now].filter((id) => !ids.includes(id))) : new Set([...now, ...ids])));
  }

  async function saveDeletes() {
    if (!onDeleteRows || doomed.size === 0) return;
    setSaving(true);
    setProblem(null);
    try {
      await onDeleteRows(graph.nodes.filter((node) => doomed.has(node.id)).map(({ schema, table, columns, row }) => ({ schema, table, columns, row })));
      setGraph((now) => ({ nodes: now.nodes.filter((node) => !doomed.has(node.id)), edges: now.edges.filter((edge) => !doomed.has(edge.from) && !doomed.has(edge.to)) }));
      if (selected && doomed.has(selected)) setSelected(null);
      setSelection(new Set());
      setDoomed(new Set());
    } catch (failure) {
      setProblem(String(failure));
    } finally {
      setSaving(false);
    }
  }

  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const visible: Graph = hidden.size === 0 ? graph : { nodes: graph.nodes.filter((node) => !hidden.has(node.id)), edges: graph.edges.filter((edge) => !hidden.has(edge.from) && !hidden.has(edge.to)) };
  const boxes = layout(visible, (node) => cardHeight(fieldsOf(node).length), placed);

  // A card dragged moves, with the others picked when it is one of them. A press that barely moves is a click.
  const moving = useRef<{ from: { x: number; y: number }; start: Map<string, { x: number; y: number }>; moved: boolean } | null>(null);
  const justMoved = useRef(false);

  function startMove(event: PointerEvent<HTMLDivElement>, node: GraphNode) {
    justMoved.current = false;
    if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
    const ids = selection.has(node.id) ? [...selection] : [node.id];
    const start = new Map(ids.flatMap((id) => (boxes.has(id) ? [[id, { x: boxes.get(id)!.x, y: boxes.get(id)!.y }] as const] : [])));
    moving.current = { from: { x: event.clientX, y: event.clientY }, start, moved: false };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function move(event: PointerEvent<HTMLDivElement>, node: GraphNode) {
    const now = moving.current;
    if (!now) return;
    const dx = event.clientX - now.from.x;
    const dy = event.clientY - now.from.y;
    if (!now.moved) {
      if (Math.hypot(dx, dy) < 4) return;
      now.moved = true;
      if (!selection.has(node.id)) setSelection(new Set([node.id]));
      setSelected(node.id);
    }
    setPlaced((before) => {
      const next = new Map(before);
      for (const [id, at] of now.start) next.set(id, { x: Math.max(0, at.x + dx), y: Math.max(0, at.y + dy) });
      return next;
    });
  }

  function endMove() {
    if (moving.current?.moved) justMoved.current = true;
    moving.current = null;
  }
  const size = extent(boxes.values(), MARGIN);
  const picked = selected ? byId.get(selected) : undefined;
  const pinned = picked ? fieldsOf(picked) : [];
  const line = `1px solid ${token.colorBorderSecondary}`;

  return (
    <div style={{ height: "100%", minHeight: 0 }}>
      <Flex
        vertical
        // A press anywhere in the graph but on a links button closes the links menu. The canvas keeps its presses from the page, so the menu
        // would not hear of them.
        onPointerDownCapture={(event) => menuFor && !(event.target as HTMLElement).closest("[aria-haspopup=menu]") && setMenuFor(null)}
        onKeyDown={(event) => {
          // H hides what is picked, while the graph has the keyboard and nothing is being typed.
          const typing = event.target instanceof HTMLElement && (event.target.isContentEditable || ["INPUT", "TEXTAREA"].includes(event.target.tagName));
          if (event.metaKey || event.ctrlKey || event.altKey || typing) return;
          if (event.key === "Backspace" || event.key === "Delete") {
            if (!onDeleteRows) return;
            event.preventDefault();
            markDeleting();
          } else if (event.key.toLowerCase() === "h") {
            event.preventDefault();
            hide();
          }
        }}
        style={{ height: "100%", minHeight: 0 }}
      >
        <Flex gap={8} align="center" style={{ padding: "3px 8px", borderBottom: line }}>
          <Button size="small" type="text" icon={<TableOutlined aria-hidden />} onClick={onBack}>
            Table
          </Button>
          <Button
            size="small"
            type="text"
            aria-label="Hide"
            aria-keyshortcuts="H"
            title={selection.size === 0 ? "Pick cards to hide: click one, ⌘-click more" : `Hide the ${plural(selection.size, "picked card")} (H)`}
            icon={<EyeInvisibleOutlined aria-hidden />}
            disabled={selection.size === 0}
            onClick={hide}
          >
            Hide
            <Kbd>H</Kbd>
          </Button>
          <Button
            size="small"
            type={readableDates.on ? "default" : "text"}
            aria-pressed={readableDates.on}
            title="Show dates and timestamps in a form that is easy to read"
            icon={<ClockCircleOutlined aria-hidden />}
            onClick={readableDates.toggle}
          >
            Readable dates
          </Button>
          {onDeleteRows && (
            <Button
              size="small"
              type="text"
              danger
              icon={<DeleteOutlined aria-hidden />}
              disabled={selection.size === 0 || saving}
              title={selection.size === 0 ? "Pick cards to delete" : `Cross out the ${plural(selection.size, "picked card")} to delete; nothing is deleted until Save`}
              onClick={markDeleting}
            >
              Delete
            </Button>
          )}
          {doomed.size > 0 && (
            <>
              <Button size="small" type="primary" icon={<SaveOutlined aria-hidden />} loading={saving} onClick={() => void saveDeletes()}>
                Save
              </Button>
              <Button size="small" type="text" icon={<UndoOutlined aria-hidden />} disabled={saving} onClick={() => setDoomed(new Set())}>
                Discard
              </Button>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {plural(doomed.size, "card")} to delete · not saved yet
              </Typography.Text>
            </>
          )}
          {placed.size > 0 && (
            <Button size="small" type="link" style={{ padding: 0, fontSize: 12 }} title="Put the cards that were dragged back where the graph had them" onClick={() => setPlaced(new Map())}>
              Tidy up
            </Button>
          )}
          {hidden.size > 0 && (
            <Button size="small" type="link" style={{ padding: 0, fontSize: 12 }} onClick={() => setHidden(new Set())}>
              {hidden.size} hidden · Show
            </Button>
          )}
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Click a card to see its row · ⌘-click to pick several, ⇧-click a run
          </Typography.Text>
          {(scope.rows || scope.columns) && (
            <Flex gap={6} align="center" style={{ marginLeft: "auto", fontSize: 12 }}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {[
                  scope.rows && `${plural(scope.rows.length, "row")} of ${result.rows.length}`,
                  scope.columns && plural(scope.columns.length, "column"),
                ]
                  .filter(Boolean)
                  .join(" · ")}{" "}
                selected
              </Typography.Text>
              <Button size="small" type="link" style={{ padding: 0, fontSize: 12 }} onClick={() => setScope(ALL)}>
                Show all
              </Button>
            </Flex>
          )}
          {magnify && <MagnifyButton magnify={magnify} style={{ marginLeft: scope.rows || scope.columns ? undefined : "auto" }} />}
        </Flex>
        {problem && <Alert type="error" showIcon closable={{ "aria-label": "Close" }} title={problem} style={{ margin: 8, whiteSpace: "pre-wrap" }} onClose={() => setProblem(null)} />}
        <Flex ref={row} style={{ flex: 1, minHeight: 0 }}>
          <div
            ref={figure}
            role="figure"
            aria-label="Graph of related rows"
            // Focusable from code only, so the keyboard stays with the graph when the card that had it is hidden.
            tabIndex={-1}
            onPointerDown={startBand}
            onPointerMove={moveBand}
            onPointerUp={endBand}
            onPointerCancel={endBand}
            // A links menu belongs to where its card was; once the canvas scrolls, it no longer points at it.
            onScroll={() => menuFor && setMenuFor(null)}
            style={{
              flex: 1,
              minWidth: 0,
              overflow: "auto",
              outline: "none",
              background: token.colorBgLayout,
              userSelect: band ? "none" : undefined,
            }}
          >
            <div
              ref={canvas}
              style={{
                position: "relative",
                width: size.width,
                height: size.height,
                minWidth: "100%",
                minHeight: "100%",
              }}
            >
              {band && (
                <div
                  aria-hidden
                  style={{
                    position: "absolute",
                    left: Math.min(band.from.x, band.to.x),
                    top: Math.min(band.from.y, band.to.y),
                    width: Math.abs(band.to.x - band.from.x),
                    height: Math.abs(band.to.y - band.from.y),
                    zIndex: 2,
                    pointerEvents: "none",
                    border: `1px solid ${token.colorPrimary}`,
                    borderRadius: 2,
                    background: `color-mix(in srgb, ${token.colorPrimary} 12%, transparent)`,
                  }}
                />
              )}
              <svg
                width={size.width}
                height={size.height}
                style={{
                  position: "absolute",
                  inset: 0,
                  pointerEvents: "none",
                }}
                aria-hidden
              >
                <g transform={`translate(${MARGIN} ${MARGIN})`}>
                  {visible.edges.map((edge) => {
                    const from = boxes.get(edge.from);
                    const to = boxes.get(edge.to);
                    if (!from || !to) return null;
                    const { d, mid } = edgePath(from, to);
                    return (
                      <g key={edge.id} data-edge={edge.label}>
                        <path d={d} fill="none" stroke={token.colorBorder} strokeWidth={1.5} />
                        <text x={mid.x} y={mid.y - 4} textAnchor="middle" fontSize={10} fill={token.colorTextTertiary} style={{ fontFamily: "var(--pg-mono)" }}>
                          {edge.label}
                        </text>
                      </g>
                    );
                  })}
                </g>
              </svg>
              {visible.nodes.map((node) => {
                const box = boxes.get(node.id)!;
                const color = colorOf(node.schema, node.table, dark);
                const isPicked = selection.has(node.id);
                const name = `${node.table} ${shown(node.row[0] ?? null)}`;
                // Clicking a card shows its whole row at the side; its graph button opens what it links to.
                return (
                  <div
                    key={node.id}
                    role="group"
                    tabIndex={0}
                    aria-label={name}
                    aria-current={isPicked || undefined}
                    data-deleting={doomed.has(node.id) || undefined}
                    data-state={isLoading(node) ? "opening" : node.opened.length > 0 ? "open" : "closed"}
                    onPointerDown={(event) => startMove(event, node)}
                    onPointerMove={(event) => move(event, node)}
                    onPointerUp={endMove}
                    onPointerCancel={endMove}
                    onClick={(event) => {
                      // The click that ends a drag is not a click on the card.
                      if (justMoved.current) return void (justMoved.current = false);
                      clickCard(node, clickKind(event));
                    }}
                    onKeyDown={(event) => {
                      if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
                      event.preventDefault();
                      clickCard(node, clickKind(event));
                    }}
                    style={{
                      position: "absolute",
                      left: box.x + MARGIN,
                      top: box.y + MARGIN,
                      width: NODE_WIDTH,
                      height: box.height,
                      boxSizing: "border-box",
                      overflow: "hidden",
                      cursor: "pointer",
                      zIndex: isPicked ? 1 : undefined,
                      touchAction: "none",
                      borderRadius: 6,
                      border: `1px solid ${doomed.has(node.id) ? token.colorError : isPicked ? token.colorPrimary : token.colorBorderSecondary}`,
                      opacity: doomed.has(node.id) ? 0.6 : undefined,
                      textDecoration: doomed.has(node.id) ? "line-through" : undefined,
                      borderLeft: `3px solid ${color.stripe}`,
                      background: token.colorBgContainer,
                      boxShadow: isPicked ? `0 0 0 2px ${token.colorPrimaryBorder}` : undefined,
                      fontSize: 11,
                    }}
                  >
                    <Flex
                      justify="space-between"
                      align="center"
                      style={{
                        padding: "4px 8px",
                        lineHeight: "18px",
                        borderBottom: line,
                        background: color.tint,
                        color: color.text,
                        fontWeight: 600,
                      }}
                    >
                      <span>{node.table}</span>
                      <Button
                        size="small"
                        type="text"
                        aria-label={`Links of ${name}`}
                        aria-haspopup="menu"
                        aria-expanded={menuFor?.id === node.id}
                        disabled={linksOf(node).length === 0}
                        title={linksOf(node).length === 0 ? "Nothing links to or from this table" : "Choose what to open"}
                        loading={isLoading(node)}
                        icon={<ApartmentOutlined aria-hidden style={{ color: node.opened.length > 0 ? token.colorPrimary : token.colorTextTertiary }} />}
                        style={{ height: 18, width: 22, minWidth: 0, padding: 0 }}
                        onClick={(event) => {
                          event.stopPropagation();
                          const at = event.currentTarget.getBoundingClientRect();
                          setMenuFor(menuFor?.id === node.id ? null : { id: node.id, x: at.left, y: at.bottom });
                        }}
                      />
                    </Flex>
                    <div
                      style={{
                        padding: "4px 8px",
                        fontFamily: "var(--pg-mono)",
                      }}
                    >
                      {fieldsOf(node).map((name) => {
                        const value = node.row[node.columns.indexOf(name)] ?? null;
                        return (
                          <div
                            key={name}
                            style={{
                              display: "flex",
                              gap: 6,
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              lineHeight: "18px",
                            }}
                          >
                            <span
                              style={{
                                color: token.colorTextTertiary,
                                flex: "none",
                              }}
                            >
                              {name}
                            </span>
                            <span
                              style={{
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                color: value === null ? token.colorTextTertiary : token.colorText,
                              }}
                            >
                              {display(node, name, value)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          {picked && (
            <ResizeHandle
              orientation="vertical"
              label="Resize row details"
              after
              size={() => details.size ?? DETAILS_WIDTH}
              min={MIN_DETAILS_WIDTH}
              max={() => Math.max(MIN_DETAILS_WIDTH, (row.current?.clientWidth ?? 0) - MIN_CANVAS_WIDTH)}
              onResize={details.setSize}
              onReset={details.reset}
            />
          )}
          {picked && (
            <aside
              aria-label="Row details"
              style={{
                width: details.size ?? DETAILS_WIDTH,
                flex: "none",
                overflow: "auto",
                padding: "8px 12px",
                fontSize: 12,
              }}
            >
              <Typography.Text strong style={{ color: colorOf(picked.schema, picked.table, dark).text }}>
                {picked.schema}.{picked.table}
              </Typography.Text>
              <Flex justify="space-between" align="center" style={{ marginTop: 4, fontSize: 11 }}>
                <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                  {pinned.length} of {picked.columns.length} fields on {picked.table} cards
                </Typography.Text>
                {storedFields(picked.schema, picked.table) && (
                  <Button size="small" type="link" style={{ padding: 0, height: "auto", fontSize: 11 }} onClick={() => setFields(picked, null)}>
                    Reset
                  </Button>
                )}
              </Flex>
              <dl style={{ margin: "8px 0 0", fontFamily: "var(--pg-mono)" }}>
                {picked.columns.map((name, at) => {
                  const isPinned = pinned.includes(name);
                  return (
                    <div
                      key={name}
                      style={{
                        display: "flex",
                        gap: 4,
                        alignItems: "flex-start",
                        marginBottom: 6,
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <dt
                          style={{
                            color: colorOf(picked.schema, picked.table, dark).text,
                            opacity: isPinned ? 1 : 0.55,
                            fontWeight: 600,
                            fontSize: 11,
                          }}
                        >
                          {name}
                        </dt>
                        <LongValue value={picked.row[at] ?? null} text={display(picked, name, picked.row[at] ?? null)} unfolded={unfolded.has(`${picked.schema}.${picked.table}.${name}`)} onUnfold={(open) => unfold(`${picked.schema}.${picked.table}.${name}`, open)} />
                      </div>
                      <Button
                        size="small"
                        type="text"
                        aria-label={`Show ${name} on cards`}
                        aria-pressed={isPinned}
                        title={isPinned ? `Stop showing ${name} on ${picked.table} cards` : `Show ${name} on ${picked.table} cards`}
                        icon={isPinned ? <PushpinFilled aria-hidden style={{ color: token.colorPrimary }} /> : <PushpinOutlined aria-hidden style={{ color: token.colorTextTertiary }} />}
                        onClick={() => {
                          const next = togglePinned(pinned, name);
                          setFields(picked, next.length > 0 ? next : null);
                        }}
                      />
                    </div>
                  );
                })}
              </dl>
            </aside>
          )}
        </Flex>
      </Flex>
      {menuNode && menuFor && (
        // One menu for every card, anchored under the button that opened it; it stays open while links are picked, so several can be.
        <Dropdown
          open
          trigger={["click"]}
          onOpenChange={(open, info) => !open && info.source === "trigger" && setMenuFor(null)}
          menu={{ items: linkItems(menuNode), onClick: ({ key }) => pickLink(menuNode, key) }}
        >
          <div aria-hidden style={{ position: "fixed", left: menuFor.x, top: menuFor.y, width: 1, height: 1 }} />
        </Dropdown>
      )}
    </div>
  );
}
