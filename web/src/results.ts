import type { Cell, QueryEvent, ResultSource } from "./gateway";

export interface ResultSet {
  columns: string[];
  rows: Cell[][];
  /** Null while the statement is still sending rows. */
  rowsAffected: number | null;
  /** Where the rows came from, once the database has said. Without it the rows cannot be changed. */
  source?: ResultSource;
}

export interface RunState {
  status: "idle" | "running" | "done" | "failed";
  results: ResultSet[];
  error: string | null;
  elapsedMs: number | null;
  /** The statement that gave these results, so it can be run again, as after rows have been added to the table it read from. */
  sql?: string;
}

export const idle: RunState = { status: "idle", results: [], error: null, elapsedMs: null };
export const starting: RunState = { ...idle, status: "running" };

export const rowCount = (result: ResultSet) => result.rows.length;

const open = (results: ResultSet[]) => (results.at(-1)?.rowsAffected === null ? results.at(-1) : undefined);

/** Folds what the database sends into what the screen shows, one event at a time. */
export function applyEvent(state: RunState, event: QueryEvent): RunState {
  switch (event.type) {
    case "result_started":
      return { ...state, results: [...state.results, { columns: event.columns, rows: [], rowsAffected: null }] };
    case "rows": {
      const current = open(state.results);
      if (!current) return state;
      return { ...state, results: [...state.results.slice(0, -1), { ...current, rows: [...current.rows, ...event.rows] }] };
    }
    case "result_finished": {
      const current = open(state.results);
      if (!current) return { ...state, results: [...state.results, { columns: [], rows: [], rowsAffected: event.rows_affected }] };
      return { ...state, results: [...state.results.slice(0, -1), { ...current, rowsAffected: event.rows_affected }] };
    }
    case "failed":
      return { ...state, status: "failed", error: event.message };
    case "finished":
      return { ...state, status: "done", elapsedMs: event.elapsed_ms };
  }
}
