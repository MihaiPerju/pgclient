import { Alert, Flex, Spin, Typography, theme } from "antd";
import { useEffect, useMemo, useState } from "react";

import type { Pending } from "./changes";
import type { ExportFormat } from "./exportResult";
import type { CatalogTable } from "./gateway";
import type { Projection } from "./graph";
import { GraphView, type FetchRows } from "./GraphView";
import type { RowToDelete } from "./graphDeletes";
import { Magnified } from "./Magnified";
import { planIn } from "./plan";
import { PlanView } from "./PlanView";
import { ResultsGrid } from "./ResultsGrid";
import { rowCount, type ResultSet, type RunState } from "./results";

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

function summary(state: RunState, plan: boolean): string | null {
  if (state.status === "running") return null;
  // A plan is one row of JSON, which says nothing worth counting.
  if (plan) return state.elapsedMs === null ? "Plan" : `Plan · ${state.elapsedMs} ms`;
  const last = [...state.results].reverse().find((result) => result.columns.length > 0);
  const rows = last ? plural(rowCount(last), "row") : null;
  const time = state.elapsedMs === null ? null : `${state.elapsedMs} ms`;
  return [rows, time].filter(Boolean).join(" · ") || null;
}

type Export = (result: ResultSet, format: ExportFormat) => Promise<string | null>;

interface Related {
  catalog?: CatalogTable[] | null;
  onOpenQuery?: (sql: string) => void;
  /** Reads rows without showing them, for the graph to follow links with. */
  fetchRows?: FetchRows;
  /** Deletes the rows of cards in the graph, which may be of any table it reached. */
  onDeleteRows?: (rows: RowToDelete[]) => Promise<void>;
}

function Result({ result, onSave, onExport, catalog, onOpenQuery, fetchRows, onDeleteRows }: { result: ResultSet; onSave?: (pending: Pending) => Promise<void>; onExport?: Export } & Related) {
  // The graph starts from what was selected when it was asked for.
  const [view, setView] = useState<{ kind: "table" } | { kind: "graph"; only: Projection }>({ kind: "table" });
  // Another result has other rows, and starts as a table.
  useEffect(() => setView({ kind: "table" }), [result.columns]);
  if (result.columns.length === 0) {
    return <Typography.Text style={{ padding: 8 }}>{plural(result.rowsAffected ?? 0, "row")} affected</Typography.Text>;
  }
  // Table or graph, a pinch grows the result over the window, and it stays big when switched between them.
  return (
    <Magnified label="Results">
      {(magnify) =>
        view.kind === "graph" && catalog && fetchRows ? (
          <GraphView result={result} only={view.only} catalog={catalog} fetchRows={fetchRows} onBack={() => setView({ kind: "table" })} magnify={magnify} onDeleteRows={onDeleteRows} />
        ) : (
          <ResultsGrid
            result={result}
            onSave={onSave}
            onExport={onExport && ((format) => onExport(result, format))}
            catalog={catalog}
            onOpenQuery={onOpenQuery}
            onShowGraph={fetchRows ? (only) => setView({ kind: "graph", only }) : undefined}
            magnify={magnify}
          />
        )
      }
    </Magnified>
  );
}

/** `onSave` writes the deletions and edits of the one result of a statement; a script of several has none, as rows cannot be told apart across them. */
export function ResultsPanel({ state, onSave, onExport, catalog, onOpenQuery, fetchRows, onDeleteRows }: { state: RunState; onSave?: (pending: Pending) => Promise<void>; onExport?: Export } & Related) {
  const { token } = theme.useToken();
  // An explained statement gives its plan, with the transaction's own results around it when it was really run.
  const plan = useMemo(() => (state.status === "done" ? planIn(state.results) : null), [state.status, state.results]);
  const line = summary(state, plan !== null);
  return (
    <Flex vertical style={{ height: "100%", minHeight: 0 }}>
      {state.error && <Alert type="error" showIcon title={state.error} style={{ margin: 8, whiteSpace: "pre-wrap" }} />}
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        {state.status === "idle" && <Typography.Text type="secondary" style={{ padding: 12 }}>Write a query above and press Run, or ⌘↵.</Typography.Text>}
        {plan && (
          <div style={{ flex: 1, minHeight: 0 }}>
            <Magnified label="Plan">{(magnify) => <PlanView plan={plan} magnify={magnify} />}</Magnified>
          </div>
        )}
        {!plan && state.results.map((result, index) => (
          <div key={index} style={{ flex: 1, minHeight: 0 }}>
            <Result result={result} onSave={state.results.length === 1 ? onSave : undefined} onExport={onExport} catalog={catalog} onOpenQuery={onOpenQuery} fetchRows={fetchRows} onDeleteRows={state.results.length === 1 ? onDeleteRows : undefined} />
          </div>
        ))}
      </div>
      <Flex justify="space-between" style={{ padding: "3px 12px", fontSize: 12, borderTop: `1px solid ${token.colorBorderSecondary}` }}>
        {state.status === "running" ? <Spin size="small" /> : <Typography.Text type="secondary" style={{ fontSize: 12 }}>{line}</Typography.Text>}
      </Flex>
    </Flex>
  );
}
