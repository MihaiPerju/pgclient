import type { QueryEvent } from "./gateway";
import { applyEvent, idle, rowCount, starting, type RunState } from "./results";

const play = (...events: QueryEvent[]): RunState => events.reduce(applyEvent, starting);

test("nothing has run until something is started", () => {
  expect(idle).toEqual({ status: "idle", results: [], error: null, elapsedMs: null });
  expect(starting.status).toBe("running");
});

test("a result opens with its columns and fills with rows as they arrive", () => {
  const state = play(
    { type: "result_started", columns: ["id", "name"] },
    { type: "rows", rows: [["1", "ada"]] },
    { type: "rows", rows: [["2", null]] },
  );

  expect(state.status).toBe("running");
  expect(state.results).toEqual([{ columns: ["id", "name"], rows: [["1", "ada"], ["2", null]], rowsAffected: null }]);
});

test("a result is closed with the number of rows it touched", () => {
  const state = play({ type: "result_started", columns: ["id"] }, { type: "rows", rows: [["1"]] }, { type: "result_finished", rows_affected: 1 });

  expect(state.results[0].rowsAffected).toBe(1);
});

test("a statement that returns no rows still gets a result of its own", () => {
  const state = play({ type: "result_finished", rows_affected: 3 });

  expect(state.results).toEqual([{ columns: [], rows: [], rowsAffected: 3 }]);
});

test("several statements make several results, each taking its own rows", () => {
  const state = play(
    { type: "result_started", columns: ["a"] },
    { type: "rows", rows: [["1"]] },
    { type: "result_finished", rows_affected: 1 },
    { type: "result_started", columns: ["b"] },
    { type: "rows", rows: [["2"]] },
    { type: "result_finished", rows_affected: 1 },
  );

  expect(state.results.map((r) => [r.columns, r.rows])).toEqual([[["a"], [["1"]]], [["b"], [["2"]]]]);
});

test("finishing records how long it took", () => {
  const state = play({ type: "finished", elapsed_ms: 42 });

  expect(state).toMatchObject({ status: "done", elapsedMs: 42 });
});

test("a failure keeps what had arrived and says what went wrong", () => {
  const state = play({ type: "result_started", columns: ["ok"] }, { type: "rows", rows: [["1"]] }, { type: "failed", message: 'ERROR: relation "x" does not exist' });

  expect(state).toMatchObject({ status: "failed", error: 'ERROR: relation "x" does not exist' });
  expect(state.results[0].rows).toEqual([["1"]]);
});

test("rows are counted across what has arrived", () => {
  const state = play({ type: "result_started", columns: ["a"] }, { type: "rows", rows: [["1"], ["2"]] });

  expect(rowCount(state.results[0])).toBe(2);
});
