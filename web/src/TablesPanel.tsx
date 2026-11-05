import { DownOutlined, EyeOutlined, KeyOutlined, ReloadOutlined, RightOutlined, TableOutlined } from "@ant-design/icons";
import { Alert, Button, Flex, Input, Spin, Typography } from "antd";
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";

import { CloseIcon } from "./CloseIcon";
import type { ColumnInfo, Gateway, TableInfo, TableKind } from "./gateway";
import { previewQuery } from "./sql";

interface Props {
  gateway: Gateway;
  serverId: string | null;
  database: string | null;
  /** Called with a query for the editor when a table is double-clicked. */
  onInsert: (sql: string) => void;
  /** Called when the tables are asked for again, so whatever else knows them can catch up. */
  onRefresh?: () => void;
}

const KINDS: { kind: TableKind; label: string }[] = [
  { kind: "table", label: "Tables" },
  { kind: "view", label: "Views" },
  { kind: "materialized_view", label: "Materialized views" },
  { kind: "foreign_table", label: "Foreign tables" },
];
const KIND_NAME: Record<TableKind, string> = { table: "table", view: "view", materialized_view: "materialized view", foreign_table: "foreign table" };

const INDENT = 16;
const CHEVRON = 14;

const tableId = (table: TableInfo) => `${table.schema}.${table.name}`;
const schemaId = (schema: string) => `schema:${schema}`;
const groupId = (schema: string, kind: TableKind) => `group:${schema}:${kind}`;

/** The public schema is the one that is usually wanted, so it comes first. */
const bySchema = (a: string, b: string) => (a === "public" ? -1 : b === "public" ? 1 : a.localeCompare(b));

/** A chevron that turns when its level is open, or an empty space of the same width where there is nothing to open. */
function Chevron({ open }: { open?: boolean }) {
  if (open === undefined) return <span style={{ width: CHEVRON, flexShrink: 0 }} />;
  return (
    <span data-chevron={open ? "open" : "closed"} aria-hidden style={{ width: CHEVRON, flexShrink: 0, fontSize: 9, color: "var(--pg-tertiary)", textAlign: "center" }}>
      {open ? <DownOutlined /> : <RightOutlined />}
    </span>
  );
}

const rowStyle = (depth: number, muted = false): CSSProperties => ({
  display: "flex",
  alignItems: "center",
  gap: 6,
  width: "calc(100% - 8px)",
  margin: "0 4px",
  padding: `3px 8px 3px ${8 + depth * INDENT}px`,
  border: 0,
  borderRadius: 5,
  background: "transparent",
  color: muted ? "var(--pg-secondary)" : "var(--pg-text)",
  font: "inherit",
  fontSize: 13,
  textAlign: "left",
  cursor: "pointer",
});

interface RowProps {
  depth: number;
  open: boolean;
  label: string;
  onToggle: () => void;
  onDoubleClick?: () => void;
  children: ReactNode;
}

/** One line of the tree that can be opened. The whole line is the button, as in pgAdmin, not just the chevron. */
function Row({ depth, open, label, onToggle, onDoubleClick, children }: RowProps) {
  return (
    <button type="button" aria-label={label} aria-expanded={open} className="pg-row-button pg-hover" style={rowStyle(depth)} onClick={onToggle} onDoubleClick={onDoubleClick}>
      <Chevron open={open} />
      {children}
    </button>
  );
}

export function TablesPanel({ gateway, serverId, database, onInsert, onRefresh }: Props) {
  const [tables, setTables] = useState<TableInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [columns, setColumns] = useState<Record<string, ColumnInfo[]>>({});
  const [reload, setReload] = useState(0);

  useEffect(() => {
    setTables(null);
    setError(null);
    setOpen(new Set());
    setColumns({});
    if (serverId === null || database === null) return;
    let current = true;
    gateway
      .listTables(serverId, database)
      .then((found) => current && setTables(found))
      .catch((failure) => current && setError(String(failure)));
    return () => {
      current = false;
    };
  }, [gateway, serverId, database, reload]);

  const needle = query.trim().toLowerCase();
  const schemas = useMemo(() => {
    const shown = (tables ?? []).filter((table) => table.name.toLowerCase().includes(needle));
    const names = [...new Set(shown.map((table) => table.schema))].sort(bySchema);
    return names.map((schema) => ({
      schema,
      groups: KINDS.map(({ kind, label }) => ({ kind, label, tables: shown.filter((table) => table.schema === schema && table.kind === kind) })).filter((group) => group.tables.length > 0),
    }));
  }, [tables, needle]);

  const toggle = (set: "folded" | "open", id: string) => (set === "folded" ? setFolded : setOpen)((previous) => {
    const next = new Set(previous);
    if (!next.delete(id)) next.add(id);
    return next;
  });

  function toggleTable(table: TableInfo) {
    const id = tableId(table);
    toggle("open", id);
    if (columns[id] === undefined && serverId !== null && database !== null) {
      gateway
        .listColumns(serverId, database, table.schema, table.name)
        .then((found) => setColumns((previous) => ({ ...previous, [id]: found })))
        .catch((failure) => setError(String(failure)));
    }
  }

  if (database === null) {
    return <Typography.Text type="secondary" style={{ padding: 12, display: "block" }}>Choose a database to see its tables.</Typography.Text>;
  }

  // While searching, what matches is shown wherever it is, even inside a level that was folded.
  const isOpen = (id: string) => needle !== "" || !folded.has(id);

  return (
    <nav aria-label="Tables" style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <Flex gap={4} align="center" style={{ padding: 8 }}>
        <Input.Search aria-label="Search tables" type="search" placeholder="Search tables" allowClear={{ clearIcon: <CloseIcon size={10} /> }} size="small" value={query} onChange={(event) => setQuery(event.target.value)} />
        <Button size="small" type="text" aria-label="Refresh tables" icon={<ReloadOutlined aria-hidden />} onClick={() => {
          setReload((count) => count + 1);
          onRefresh?.();
        }} />
      </Flex>
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", paddingBottom: 8 }}>
        {error && <Alert type="error" showIcon title={error} style={{ margin: "0 8px 8px" }} />}
        {tables === null && !error && <Spin size="small" style={{ display: "block", margin: 12 }} />}
        {tables !== null && tables.length === 0 && <Typography.Text type="secondary" style={{ padding: 12, display: "block" }}>No tables</Typography.Text>}
        {tables !== null && tables.length > 0 && schemas.length === 0 && (
          <Typography.Text type="secondary" style={{ padding: 12, display: "block" }}>No tables match</Typography.Text>
        )}
        {schemas.map(({ schema, groups }) => (
          <div key={schema}>
            <Row depth={0} label={schema} open={isOpen(schemaId(schema))} onToggle={() => toggle("folded", schemaId(schema))}>
              <span aria-hidden style={{ fontWeight: 500 }}>{schema}</span>
            </Row>
            {isOpen(schemaId(schema)) &&
              groups.map(({ kind, label, tables: inGroup }) => (
                <div key={kind}>
                  <Row depth={1} label={`${label} (${inGroup.length})`} open={isOpen(groupId(schema, kind))} onToggle={() => toggle("folded", groupId(schema, kind))}>
                    <span aria-hidden>
                      {label} <span style={{ color: "var(--pg-secondary)" }}>({inGroup.length})</span>
                    </span>
                  </Row>
                  {isOpen(groupId(schema, kind)) &&
                    inGroup.map((table) => {
                      const id = tableId(table);
                      const Icon = kind === "table" || kind === "foreign_table" ? TableOutlined : EyeOutlined;
                      return (
                        <div key={id}>
                          <Row depth={2} label={table.name} open={open.has(id)} onToggle={() => toggleTable(table)} onDoubleClick={() => onInsert(previewQuery(table.schema, table.name))}>
                            <Icon aria-label={`${KIND_NAME[kind]} ${table.name}`} style={{ fontSize: 13, color: "var(--pg-secondary)" }} />
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{table.name}</span>
                          </Row>
                          {open.has(id) &&
                            (columns[id] ?? []).map((column) => (
                              <Flex key={column.name} data-level={3} gap={6} align="center" style={{ padding: `1px 12px 1px ${8 + 3 * INDENT}px`, fontSize: 12, minWidth: 0 }}>
                                <Chevron />
                                <span style={{ width: 12, flexShrink: 0, textAlign: "center" }}>
                                  {column.primary_key && <KeyOutlined aria-label="primary key" style={{ fontSize: 11, color: "var(--pg-secondary)" }} />}
                                </span>
                                <span style={{ flexShrink: 0 }}>{column.name}</span>
                                <Typography.Text type="secondary" ellipsis={{ tooltip: column.data_type }} style={{ fontSize: 11, fontFamily: "var(--pg-mono)", minWidth: 0, flex: 1 }}>
                                  {column.data_type}
                                </Typography.Text>
                              </Flex>
                            ))}
                        </div>
                      );
                    })}
                </div>
              ))}
          </div>
        ))}
      </div>
    </nav>
  );
}
