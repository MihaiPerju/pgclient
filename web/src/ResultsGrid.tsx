import { ApartmentOutlined, CheckOutlined, ClockCircleOutlined, EyeInvisibleOutlined, CopyOutlined, DeleteOutlined, DownloadOutlined, LinkOutlined, SaveOutlined, SearchOutlined, UndoOutlined } from "@ant-design/icons";
import { Alert, Button, Dropdown, Flex, Typography, theme } from "antd";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type MouseEvent } from "react";

import { CellEditor, isJsonValue, type Editing } from "./CellEditor";
import { ColumnFinder } from "./ColumnFinder";
import { matchingColumns, scrollLeftFor, splitMatch, stepMatch } from "./columnSearch";
import { InlineCellEditor } from "./InlineCellEditor";
import { addRows, dropAdded, editableSource, editedCount, isPending, nothingPending, originalOf, setCell, shown, toggleDeleted, type Pending } from "./changes";
import { pastedRows } from "./paste";
import { DEFAULT_WIDTH, MAX_DRAG_WIDTH, MIN_WIDTH, fitWidth } from "./columns";
import { JsonModal } from "./JsonModal";
import type { ExportFormat } from "./exportResult";
import type { Projection } from "./graph";
import { isDateType, readable, useReadableDates } from "./readableDates";
import { canHide, hiddenSummary, hideSelected, inView, nothingHidden, type Hidden } from "./hiding";
import { Kbd } from "./Kbd";
import { MagnifyButton, type Magnify } from "./Magnified";
import type { CatalogTable } from "./gateway";
import { looksLikeJson } from "./json";
import { MAX_RELATED, relatedKeys, relatedQuery, relationLabel, relationsOf, type Relation } from "./related";
import { ResizeHandle } from "./resize";
import type { ResultSet } from "./results";
import { cellCount, cellEdges, cellsFrom, clickColumn, clickCorner, clickRow, dragTo, isColumnSelected, isRowSelected, none, projection, released, selectedCells, selectedRows, status, toTsv, type Modifiers, type Selection } from "./selection";

const ROW_HEIGHT = 26;
const COUNTER_WIDTH = 52;
const FRAME = { width: 1000, height: 400 };
const HEADERS_KEY = "pgclient.copyHeaders";
const COPIED_FOR_MS = 2000;
/** Enough rows to fit a column to, however long the result is. */
const FIT_SAMPLE = 200;

const modifiers = (event: MouseEvent): Modifiers => ({ toggle: event.metaKey || event.ctrlKey, range: event.shiftKey });
const noun = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** The clipboard the page is meant to use, and then the older way, which a webview that is strict about the first still allows. */
async function writeToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const holder = document.createElement("textarea");
    holder.value = text;
    holder.style.position = "fixed";
    holder.style.opacity = "0";
    document.body.append(holder);
    holder.select();
    try {
      return document.execCommand("copy");
    } finally {
      holder.remove();
    }
  }
}

/** Only the rows in view are drawn, so a result of a million rows scrolls as smoothly as one of ten. */
/** `onExport` saves what the query returned, not what has been edited since, and resolves with where it went, or null if the person backed out.
 * With a `catalog` and `onOpenQuery`, a column in a foreign key opens the rows that go with it, by a query handed to `onOpenQuery`.
 * `onShowGraph` switches to the rows as a graph, which a result read from one table can be, starting from the rows and columns selected. */
export function ResultsGrid({
  result,
  onSave,
  onExport,
  catalog,
  onOpenQuery,
  onShowGraph,
  magnify,
}: {
  result: ResultSet;
  onSave?: (pending: Pending) => Promise<void>;
  onExport?: (format: ExportFormat) => Promise<string | null>;
  catalog?: CatalogTable[] | null;
  onOpenQuery?: (sql: string) => void;
  onShowGraph?: (only: Projection) => void;
  magnify?: Magnify;
}) {
  const { token } = theme.useToken();
  const scroller = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<Selection>(none);
  const [hidden, setHidden] = useState<Hidden>(nothingHidden);
  const [widths, setWidths] = useState<Record<number, number>>({});
  const [withHeaders, setWithHeaders] = useState(() => localStorage.getItem(HEADERS_KEY) === "true");
  const [notice, setNotice] = useState<string | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(nothingPending);
  const [editing, setEditing] = useState<Editing | null>(null);
  /** The cell being typed into where it sits, which is any value that fits on a line and is not JSON. */
  const [inline, setInline] = useState<{ row: number; column: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  /** The text being looked for among the names of the columns, while the bar for it is open, and the column it has brought into view. */
  const [finding, setFinding] = useState<string | null>(null);
  const [found, setFound] = useState<number | null>(null);
  /** Where the menu of related rows was asked for: the point clicked, the column, and the row of a cell or none for a header. */
  const [menuAt, setMenuAt] = useState<{ x: number; y: number; column: number; row: number | null } | null>(null);
  /** Set while the button is down on a cell: what was selected before, to tell a click from the start of a drag. */
  const pressing = useRef<{ before: Selection } | null>(null);
  const readCount = result.rows.length;
  /** The rows shown are those that were read and then those waiting to be added, so a row at or past the first count is a new one. */
  const rowCount = readCount + pending.added.length;
  const isNew = (row: number) => row >= readCount;

  // Rows arriving for the same columns keep what was chosen and how wide it was made. A new result has other columns, and starts clean.
  useEffect(() => {
    setSelection(none);
    setWidths({});
    setPending(nothingPending);
    setEditing(null);
    setInline(null);
    setProblem(null);
    setFinding(null);
    setFound(null);
    setMenuAt(null);
    setHidden(nothingHidden);
  }, [result.columns]);
  useEffect(() => {
    function release() {
      if (!pressing.current) return;
      const { before } = pressing.current;
      pressing.current = null;
      setSelection((current) => released(before, current));
    }
    // Let go anywhere, even outside the grid, and the drag is over.
    window.addEventListener("mouseup", release);
    return () => window.removeEventListener("mouseup", release);
  }, []);
  useEffect(() => {
    if (notice === null) return;
    const timer = setTimeout(() => setNotice(null), COPIED_FOR_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  // Only the rows and columns in view are drawn; each drawn row is told by its place in the result.
  const shownRows = inView(rowCount, hidden.rows);
  const shownColumns = inView(result.columns.length, hidden.columns);
  const rows = useVirtualizer({
    count: shownRows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
    // Until the real size is measured, as in a test with no layout, draw as if it were this big.
    initialRect: FRAME,
  });
  const widthOf = (column: number) => widths[column] ?? DEFAULT_WIDTH;
  const total = COUNTER_WIDTH + shownColumns.reduce((sum, column) => sum + widthOf(column), 0);
  const line = `1px solid ${token.colorBorderSecondary}`;
  const allSelected = selection.kind === "rows" && selection.all;
  const source = editableSource(result);
  const readableDates = useReadableDates();
  const picked = selectedRows(selection, rowCount, hidden);
  const deleteHint = !onSave ? undefined : result.source === undefined ? "Checking whether these rows can be changed…" : result.source.state === "read_only" ? result.source.reason : picked.length === 0 ? "Select rows to delete" : undefined;
  const unsaved = isPending(pending);
  const marked = pending.deleted.size;
  const changedCells = editedCount(pending);
  const adding = pending.added.length;

  const matches = finding === null ? [] : matchingColumns(result.columns, finding).filter((column) => !hidden.columns.has(column));
  const relations = useMemo(() => (catalog && onOpenQuery ? result.columns.map((_, column) => relationsOf(catalog, result.source, column)) : []), [catalog, onOpenQuery, result.columns, result.source]);

  /** Opens the rows that go with the rows picked, or with every row read when none are. From a cell outside what is picked, only its own row is used.
   * Rows only pasted are not in the database yet, so they are left out. */
  function openRelated(relation: Relation, row: number | null) {
    if (!onOpenQuery) return;
    const chosen = selection.kind === "rows" ? picked : selection.kind === "cells" ? [...new Set(selectedCells(selection, hidden).map((cell) => cell.row))] : [];
    const scope = row === null || chosen.includes(row) ? chosen : [row];
    const rowsUsed = (scope.length > 0 ? scope : shownRows).filter((at) => !isNew(at)).map((at) => result.rows[at]);
    const keys = relatedKeys(relation, rowsUsed);
    if (keys.length === 0) return setNotice("There are no values to look for");
    if (keys.length > MAX_RELATED) return setNotice(`That is ${keys.length} values. Select rows to open at most ${MAX_RELATED}`);
    onOpenQuery(relatedQuery(relation, keys));
  }

  /** The graph starts from what is selected: rows still being added are not in the table yet, so they are left out. */
  function showGraph() {
    if (!onShowGraph) return;
    const { rows, columns } = projection(selection, rowCount, hidden);
    const read = rows?.filter((row) => !isNew(row)) ?? [];
    onShowGraph({ rows: read.length > 0 && read.length < readCount ? read : null, columns: columns?.map((column) => result.columns[column]) ?? null });
  }

  /** Right-clicking a header or a cell of a column with related rows opens their menu where it was clicked. Any other column keeps the usual menu. */
  function showRelated(event: MouseEvent, column: number, row: number | null) {
    if ((relations[column] ?? []).length === 0) return;
    event.preventDefault();
    setMenuAt({ x: event.clientX, y: event.clientY, column, row });
  }

  function relatedItems(column: number) {
    const linked = relations[column] ?? [];
    return (["references", "referenced_by"] as const)
      .map((direction) => ({ direction, entries: linked.map((relation, at) => ({ relation, at })).filter(({ relation }) => relation.direction === direction) }))
      .filter(({ entries }) => entries.length > 0)
      .map(({ direction, entries }) => ({
        type: "group" as const,
        key: direction,
        label: direction === "references" ? "Open what it points to" : "Open what points here",
        children: entries.map(({ relation, at }) => ({ key: String(at), label: relationLabel(relation, result.columns) })),
      }));
  }

  /** Brings a column into view, clear of the row numbers that stay at the left, and makes it the one the bar is on. */
  function showColumn(column: number | null) {
    setFound(column);
    const box = scroller.current;
    if (column === null || !box) return;
    const widthsNow = result.columns.map((_, index) => (hidden.columns.has(index) ? 0 : widthOf(index)));
    box.scrollTo({ left: scrollLeftFor(widthsNow, column, box.clientWidth, COUNTER_WIDTH, box.scrollLeft), behavior: "smooth" });
  }

  function find(text: string) {
    setFinding(text);
    showColumn(matchingColumns(result.columns, text).find((column) => !hidden.columns.has(column)) ?? null);
  }

  function step(direction: 1 | -1) {
    showColumn(stepMatch(matches, found, direction));
  }

  function closeFinder() {
    setFinding(null);
    setFound(null);
    scroller.current?.focus();
  }

  async function copy() {
    if (selection.kind === "none") return;
    const worked = await writeToClipboard(toTsv(result, selection, withHeaders, hidden));
    const what =
      selection.kind === "cells" ? noun(cellCount(selection, hidden), "cell") : selection.kind === "rows" ? noun(picked.length, "row") : noun([...selection.columns].filter((column) => !hidden.columns.has(column)).length, "column");
    setNotice(worked ? `Copied ${what}` : "Could not copy");
  }

  function onKeyDown(event: KeyboardEvent) {
    const command = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (command && key === "f") {
      event.preventDefault();
      setFinding((now) => now ?? "");
    } else if (command && key === "c" && selection.kind !== "none") {
      event.preventDefault();
      void copy();
    } else if (command && key === "a") {
      event.preventDefault();
      setSelection({ kind: "rows", rows: new Set(), all: true, anchor: null });
    } else if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault();
      remove();
    } else if (event.key === "Escape") {
      setSelection(none);
    } else if (key === "h" && !command && !event.altKey) {
      // H hides the picked rows or columns, unless it is being typed into a cell.
      const typing = event.target instanceof HTMLElement && (event.target.isContentEditable || ["INPUT", "TEXTAREA"].includes(event.target.tagName));
      if (typing) return;
      event.preventDefault();
      hide();
    }
  }

  /** Takes the picked rows or columns out of view, and lets go of them, since they cannot be seen. */
  function hide() {
    if (!canHide(selection)) return;
    setHidden((now) => hideSelected(now, selection, rowCount));
    setSelection(none);
  }

  /** Rows that were read are crossed out, to be deleted when saved. Rows that were only pasted have nothing in the database to delete, so they are just taken off. */
  function removeRows(rowsPicked: number[]) {
    const fresh = rowsPicked.filter(isNew).map((row) => row - readCount);
    const read = rowsPicked.filter((row) => !isNew(row));
    setPending((current) => {
      const next = fresh.length > 0 ? dropAdded(current, fresh) : current;
      return read.length > 0 ? toggleDeleted(next, read) : next;
    });
    if (fresh.length > 0) setSelection(none);
  }

  /** ⌘V puts the copied rows below the others, to be added when saved, which is also what the database checks them for. */
  function paste(event: ClipboardEvent) {
    // A cell being typed into takes what is pasted for its own text.
    if (inline !== null || !onSave) return;
    const text = event.clipboardData.getData("text/plain");
    if (text === "") return;
    event.preventDefault();
    if (result.source?.state === "read_only") return setNotice(`Rows cannot be added here: ${result.source.reason}`);
    if (!source) return setNotice("Still checking whether rows can be added here");
    const rowsPasted = pastedRows(text);
    if (rowsPasted.length === 0) return setNotice("There was nothing to add in what was copied");
    setPending((current) => addRows(current, source, rowsPasted));
    // The new rows are at the bottom, so the grid goes there to show them.
    setTimeout(() => rows.scrollToIndex(shownRows.length + rowsPasted.length - 1), 0);
  }

  /** Backspace crosses out the rows that are picked, and empties the cells that are to NULL: the same as Delete and Save would do, and as far from final. A column that may not be null can be emptied too, and is marked as needing a value, since saving it would be refused. A key that does nothing says why. */
  function remove() {
    if (!onSave || saving || (selection.kind !== "rows" && selection.kind !== "cells")) return;
    if (result.source?.state === "read_only") return setNotice(`These rows cannot be changed: ${result.source.reason}`);
    if (!source) return setNotice("Still checking whether these rows can be changed");
    if (selection.kind === "rows") {
      if (picked.length > 0) removeRows(picked);
      return;
    }
    const refused = new Set<string>();
    const next = selectedCells(selection, hidden).reduce((now, { row, column }) => {
      if (now.deleted.has(row)) return now;
      if (!source.columns[column]) {
        refused.add(`${result.columns[column]} is worked out by the query, so it cannot be changed`);
        return now;
      }
      return setCell(now, result, row, column, null);
    }, pending);
    setPending(next);
    if (refused.size > 0) setNotice([...refused].join(" · "));
  }

  /** Pressing on a cell selects it, and moving on with the button down stretches the selection to a block, in any direction. */
  function startOnCell(event: MouseEvent, row: number, column: number) {
    if (event.button !== 0) return;
    // No text is selected by the drag, and the grid takes the keyboard so command-C works at once.
    event.preventDefault();
    scroller.current?.focus();
    if (event.shiftKey && selection.kind === "cells") {
      setSelection(dragTo(selection, row, column));
      pressing.current = { before: none };
    } else {
      pressing.current = { before: selection };
      setSelection(cellsFrom(row, column));
    }
  }

  async function save() {
    if (!onSave) return;
    setSaving(true);
    setProblem(null);
    try {
      await onSave(pending);
      setPending(nothingPending);
      setSelection(none);
    } catch (failure) {
      setProblem(String(failure));
      // The message is about a row that may be one of those added, below the rows that were read, so the grid goes to them.
      if (pending.added.length > 0) setTimeout(() => rows.scrollToIndex(shownRows.length - 1, { align: "end" }), 0);
    } finally {
      setSaving(false);
    }
  }

  /** A cell of a result that can be changed is edited in place, or in a pop-up when it is JSON, runs over several lines, or is opened with Alt held, which is also where it can be made NULL. Any other cell that holds JSON opens the viewer. */
  function open(row: number, column: number, value: string | null, full: boolean) {
    const field = source?.columns[column];
    if (onSave && field && !pending.deleted.has(row)) {
      const current = shown(result, pending, row, column);
      if (full || isJsonValue(current, field.data_type) || current?.includes("\n")) setEditing({ row, column, value: current, source: field });
      else setInline({ row, column });
    } else if (value !== null && looksLikeJson(value)) {
      setOpened(value);
    }
  }

  function commitInline(row: number, column: number, text: string) {
    const original = shown(result, pending, row, column);
    // Leaving a NULL as it was is not an edit to an empty string.
    if (!(original === null && text === "")) setPending((current) => setCell(current, result, row, column, text));
    setInline(null);
  }

  async function exportAs(format: ExportFormat) {
    if (!onExport) return;
    setProblem(null);
    try {
      const path = await onExport(format);
      if (path !== null) setNotice(`Saved ${path}`);
    } catch (failure) {
      setProblem(String(failure));
    }
  }

  function toggleHeaders() {
    localStorage.setItem(HEADERS_KEY, String(!withHeaders));
    setWithHeaders(!withHeaders);
  }

  const headerCell = (selected: boolean) => ({
    position: "relative" as const,
    flex: "none",
    boxSizing: "border-box" as const,
    padding: "6px 12px",
    fontWeight: 500,
    fontSize: 11,
    fontFamily: "inherit",
    color: selected ? token.colorTextHeading : token.colorTextSecondary,
    background: selected ? "var(--pg-selected)" : token.colorBgContainer,
    boxShadow: selected ? `inset 0 -2px 0 ${token.colorPrimary}` : undefined,
    borderRight: line,
    cursor: "pointer",
    userSelect: "none" as const,
  });
  const ellipsis = { display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } as const;

  return (
    <Flex vertical style={{ height: "100%", minHeight: 0 }}>
      <Flex gap={4} align="center" style={{ padding: "3px 8px", borderBottom: line }}>
        <Button size="small" type="text" aria-label="Copy" icon={<CopyOutlined aria-hidden />} disabled={selection.kind === "none"} onClick={() => void copy()} />
        <Button size="small" type={withHeaders ? "default" : "text"} aria-pressed={withHeaders} icon={withHeaders ? <CheckOutlined aria-hidden /> : undefined} onClick={toggleHeaders}>
          Copy with headers
        </Button>
        {onExport && (
          <Dropdown
            trigger={["click"]}
            menu={{ items: [{ key: "csv", label: "CSV" }, { key: "json", label: "JSON" }], onClick: ({ key }) => void exportAs(key as ExportFormat) }}
          >
            <Button size="small" type="text" icon={<DownloadOutlined aria-hidden />} disabled={result.rowsAffected === null}>
              Export
            </Button>
          </Dropdown>
        )}
        {onSave && (
          <Button size="small" type="text" danger icon={<DeleteOutlined aria-hidden />} disabled={deleteHint !== undefined || saving} title={deleteHint} onClick={() => removeRows(picked)}>
            Delete
          </Button>
        )}
        {unsaved && (
          <>
            <Button size="small" type="primary" icon={<SaveOutlined aria-hidden />} loading={saving} onClick={() => void save()}>
              Save
            </Button>
            <Button size="small" type="text" icon={<UndoOutlined aria-hidden />} disabled={saving} onClick={() => setPending(nothingPending)}>
              Discard
            </Button>
          </>
        )}
        <Button
          size="small"
          type="text"
          aria-label="Hide"
          aria-keyshortcuts="H"
          title={canHide(selection) ? "Hide the picked rows or columns (H)" : "Pick rows or columns to hide"}
          icon={<EyeInvisibleOutlined aria-hidden />}
          disabled={!canHide(selection)}
          onClick={hide}
        >
          Hide
          <Kbd>H</Kbd>
        </Button>
        <Button
          size="small"
          type={readableDates.on ? "default" : "text"}
          aria-pressed={readableDates.on}
          title="Show dates and timestamps in a form that is easy to read. Editing still shows the value itself."
          icon={<ClockCircleOutlined aria-hidden />}
          onClick={readableDates.toggle}
        >
          Readable dates
        </Button>
        {hiddenSummary(hidden) && (
          <Button size="small" type="link" style={{ padding: 0, fontSize: 12 }} onClick={() => setHidden(nothingHidden)}>
            {hiddenSummary(hidden)} · Show
          </Button>
        )}
        {onShowGraph && (
          <Button
            size="small"
            type="text"
            aria-label="Show as a graph"
            title={result.source?.state === "editable" ? (selection.kind === "none" ? "Show the rows as a graph of what they link to" : "Show the selected rows and columns as a graph of what they link to") : result.source === undefined ? "Checking where these rows come from…" : `Only rows read from one table can be shown as a graph: ${result.source.reason}`}
            icon={<ApartmentOutlined aria-hidden />}
            disabled={result.source?.state !== "editable" || !catalog}
            onClick={showGraph}
          />
        )}
        <Button size="small" type={finding === null ? "text" : "default"} aria-label="Find a column" aria-pressed={finding !== null} title="Find a column (⌘F)" icon={<SearchOutlined aria-hidden />} onClick={() => (finding === null ? setFinding("") : closeFinder())} />
        <Typography.Text type="secondary" style={{ marginLeft: "auto", fontSize: 12 }}>
          {notice ?? (unsaved ? [adding > 0 && `${noun(adding, "row")} to add`, marked > 0 && `${noun(marked, "row")} to delete`, changedCells > 0 && `${noun(changedCells, "cell")} edited`, "not saved yet"].filter(Boolean).join(" · ") : status(selection, rowCount, hidden))}
        </Typography.Text>
        {magnify && <MagnifyButton magnify={magnify} />}
      </Flex>
      {finding !== null && <ColumnFinder text={finding} onText={find} count={matches.length} position={found === null ? 0 : matches.indexOf(found) + 1} onStep={step} onClose={closeFinder} />}
      {problem && <Alert type="error" showIcon closable={{ "aria-label": "Close" }} title={problem} style={{ margin: 8, whiteSpace: "pre-wrap" }} onClose={() => setProblem(null)} />}
      <div ref={scroller} role="table" tabIndex={0} onKeyDown={onKeyDown} onPaste={paste} style={{ flex: 1, minHeight: 0, overflow: "auto", outline: "none", fontFamily: "var(--pg-mono)", fontSize: 12 }}>
        <div style={{ minWidth: total }}>
          <div role="row" style={{ display: "flex", position: "sticky", top: 0, zIndex: 2, borderBottom: line }}>
            <div
              role="columnheader"
              aria-label="Select all rows"
              aria-selected={allSelected}
              title="Select all rows"
              onClick={() => setSelection(clickCorner)}
              style={{ ...headerCell(allSelected), width: COUNTER_WIDTH, position: "sticky", left: 0, zIndex: 3, background: token.colorBgLayout, boxShadow: allSelected ? `inset 0 0 0 1px ${token.colorPrimary}` : undefined }}
            />
            {shownColumns.map((index) => {
              const name = result.columns[index];
              const selected = isColumnSelected(selection, index);
              const matched = matches.includes(index);
              const current = found === index;
              const parts = matched && finding !== null ? splitMatch(name, finding) : null;
              const linked = relations[index] ?? [];
              const header = (
                <div
                  key={index}
                  role="columnheader"
                  aria-label={name}
                  aria-selected={selected}
                  data-found={current ? "current" : matched ? "match" : undefined}
                  onClick={(event) => setSelection((now) => clickColumn(now, index, modifiers(event)))}
                  onContextMenu={(event) => showRelated(event, index, null)}
                  style={{ ...headerCell(selected), display: "flex", alignItems: "center", gap: 4, width: widthOf(index), boxShadow: current ? `inset 0 -3px 0 ${token.colorPrimary}` : matched ? `inset 0 -2px 0 ${token.colorWarning}` : selected ? `inset 0 -2px 0 ${token.colorPrimary}` : undefined, background: current ? "var(--pg-selected)" : headerCell(selected).background }}
                >
                  {linked.length > 0 && (
                    <LinkOutlined aria-label={`${name} has related rows`} title="Right-click to open related rows in a new tab, for the rows selected or all of them" style={{ flex: "none", fontSize: 11, color: token.colorPrimary }} />
                  )}
                  <span style={{ ...ellipsis, flex: 1, minWidth: 0 }}>
                    {parts ? (
                      <>
                        {parts[0]}
                        <mark className="pg-colfind-mark">{parts[1]}</mark>
                        {parts[2]}
                      </>
                    ) : (
                      name
                    )}
                  </span>
                  <ResizeHandle
                    orientation="vertical"
                    label={`Resize ${name}`}
                    className="pg-grip"
                    focusable={false}
                    size={() => widthOf(index)}
                    min={MIN_WIDTH}
                    max={() => MAX_DRAG_WIDTH}
                    onResize={(pixels) => setWidths((current) => ({ ...current, [index]: pixels }))}
                    onReset={() => setWidths((current) => ({ ...current, [index]: fitWidth(name, result.rows.slice(0, FIT_SAMPLE).map((row) => row[index] ?? null)) }))}
                  />
                </div>
              );
              return header;
            })}
          </div>
          <div style={{ height: rows.getTotalSize(), position: "relative" }}>
            {rows.getVirtualItems().map((item) => {
              const row = shownRows[item.index];
              const rowSelected = isRowSelected(selection, row);
              const rowDeleted = pending.deleted.has(row);
              const rowIsNew = isNew(row);
              return (
                <div
                  key={row}
                  role="row"
                  className="pg-row"
                  data-new={rowIsNew || undefined}
                  style={{ display: "flex", position: "absolute", top: 0, left: 0, right: 0, height: ROW_HEIGHT, transform: `translateY(${item.start}px)`, background: rowDeleted ? token.colorErrorBg : rowIsNew ? token.colorSuccessBg : rowSelected ? "var(--pg-selected)" : undefined, textDecoration: rowDeleted ? "line-through" : undefined, color: rowDeleted ? token.colorTextTertiary : undefined }}
                  data-deleted={rowDeleted || undefined}
                >
                  <div
                    role="rowheader"
                    aria-selected={rowSelected}
                    onClick={(event) => setSelection((current) => clickRow(current, row, modifiers(event), rowCount))}
                    style={{ position: "sticky", left: 0, zIndex: 1, flex: "none", width: COUNTER_WIDTH, boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "flex-end", padding: "0 10px", background: rowSelected ? token.colorPrimary : token.colorBgLayout, color: rowSelected ? "#fff" : token.colorTextSecondary, borderRight: line, cursor: "pointer", userSelect: "none", fontSize: 11 }}
                  >
                    {rowIsNew ? <span title="A new row, not saved yet">+</span> : row + 1}
                  </div>
                  {shownColumns.map((column) => {
                    const value = shown(result, pending, row, column);
                    const dateColumn = readableDates.on && isDateType(source?.columns[column]?.data_type ?? "");
                    const cellEdited = !rowIsNew && value !== originalOf(result, row, column);
                    const typing = inline?.row === row && inline.column === column;
                    const required = source?.columns[column]?.nullable === false;
                    const edges = cellEdges(selection, row, column);
                    const cellSelected = edges !== null;
                    const ring = edges && [edges.top && `inset 0 1px 0 0 ${token.colorPrimary}`, edges.bottom && `inset 0 -1px 0 0 ${token.colorPrimary}`, edges.left && `inset 1px 0 0 0 ${token.colorPrimary}`, edges.right && `inset -1px 0 0 0 ${token.colorPrimary}`].filter(Boolean).join(", ");
                    return (
                      <div
                        key={column}
                        role="cell"
                        data-selected={isColumnSelected(selection, column) || rowSelected || cellSelected}
                        onMouseDown={(event) => !typing && startOnCell(event, row, column)}
                        data-edited={cellEdited || undefined}
                        title={onSave && source?.columns[column] && !rowDeleted ? "Double-click to edit, Alt-double-click for the full editor" : value !== null && looksLikeJson(value) ? "Double-click to view the JSON" : undefined}
                        onDoubleClick={(event) => open(row, column, value, event.altKey)}
                        onContextMenu={(event) => showRelated(event, column, row)}
                        onMouseEnter={() => pressing.current && setSelection((current) => dragTo(current, row, column))}
                        style={{ flex: "none", width: widthOf(column), boxSizing: "border-box", display: "flex", alignItems: "center", padding: "0 12px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", borderRight: line, cursor: "cell", background: cellEdited ? token.colorWarningBg : isColumnSelected(selection, column) || cellSelected ? "var(--pg-selected)" : undefined, boxShadow: typing ? `inset 0 0 0 1px ${token.colorPrimary}` : ring || undefined }}
                      >
                        {typing ? (
                          <InlineCellEditor value={value} onCommit={(text) => commitInline(row, column, text)} onCancel={() => setInline(null)} />
                        ) : value === null && required ? (
                          <span data-required="true" role="img" aria-label="A value is needed" title="This column may not be null, so it needs a value before it can be saved" style={{ color: token.colorPrimary, fontWeight: 700, fontSize: 14 }}>
                            *
                          </span>
                        ) : value === null ? <Typography.Text type="secondary" italic style={{ color: token.colorTextTertiary, fontSize: 11 }}>NULL</Typography.Text> : dateColumn ? readable(value) : value}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {menuAt && (
        <Dropdown
          open
          trigger={["click"]}
          onOpenChange={(open) => !open && setMenuAt(null)}
          menu={{
            items: relatedItems(menuAt.column),
            onClick: ({ key }) => {
              setMenuAt(null);
              openRelated(relations[menuAt.column][Number(key)], menuAt.row);
            },
          }}
        >
          <div style={{ position: "fixed", left: menuAt.x, top: menuAt.y, width: 1, height: 1 }} />
        </Dropdown>
      )}
      <JsonModal value={opened} onClose={() => setOpened(null)} />
      <CellEditor
        editing={editing}
        onClose={() => setEditing(null)}
        onSave={(value) => {
          if (editing) setPending((current) => setCell(current, result, editing.row, editing.column, value));
          setEditing(null);
        }}
      />
    </Flex>
  );
}
