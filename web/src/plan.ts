import type { Cell } from "./gateway";
import { blanked } from "./suggest";

/** Something in a step that is often why a statement is slow. */
export interface Problem {
  kind: "filter" | "estimate" | "seq-scan" | "disk";
  text: string;
}

/** One thing Postgres does to run a statement, with the steps whose rows it uses under it. */
export interface PlanStep {
  id: string;
  /** What Postgres calls it, such as "Hash Join". */
  kind: string;
  /** What it does and on what, such as "Index Scan using jobs_pkey on jobs c". */
  label: string;
  /** What the planner expected each run to give. */
  estimatedRows: number;
  /** What each run gave, once really run. */
  actualRows: number | null;
  loops: number;
  /** The planner's guess of the cost of it and all under it, and of it alone. */
  cost: number;
  ownCost: number;
  /** Milliseconds over all its runs, with what is under it and alone, once really run. */
  time: number | null;
  ownTime: number | null;
  /** The rest of what Postgres says about it, as it says it. */
  details: [string, string][];
  problems: Problem[];
  children: PlanStep[];
}

export interface Plan {
  root: PlanStep;
  /** Whether the statement was run, and so times and rows are real and not guesses. */
  analyzed: boolean;
  planningMs: number | null;
  executionMs: number | null;
}

/** A step of the icicle: how deep it sits, and where it starts and how wide it is, as shares of the whole width. */
export interface Bar {
  step: PlanStep;
  depth: number;
  start: number;
  width: number;
}

type Node = Record<string, unknown>;

/** Reading this many rows one by one is worth a look. */
const BIG_TABLE = 10_000;
/** A guess this many times off, either way, is a bad one. */
const ESTIMATE_OFF = 10;
/** Smaller numbers than this are too few to be off by much that matters. */
const ESTIMATE_FLOOR = 100;
/** A filter keeping this share or less of what it read threw most of it away. */
const FILTER_KEEPS = 0.1;

const count = (value: number) => Math.round(value).toLocaleString("en-US");
const number = (value: unknown) => (typeof value === "number" ? value : 0);

/** The statement that asks Postgres how it runs `sql`. With `analyze` it is really run, inside a transaction that is rolled back so what it changes is undone. */
export function explainQuery(sql: string, analyze: boolean): { sql: string } | { problem: string } {
  const statement = sql.replace(/[\s;]+$/, "").trim();
  if (statement === "") return { problem: "Write a statement to explain." };
  // The text is sent as it is, so the statements after the first would really run.
  if (blanked(statement).includes(";")) return { problem: "Explain takes one statement. Select the one to explain." };
  if (!analyze) return { sql: `explain (format json) ${statement}` };
  return { sql: `begin;\nexplain (analyze, buffers, format json) ${statement};\nrollback;` };
}

/** The plan among a run's results: the one with a QUERY PLAN column. */
export function planIn(results: { columns: string[]; rows: Cell[][] }[]): Plan | null {
  const found = results.find((result) => result.columns.length === 1 && result.columns[0] === "QUERY PLAN");
  const text = found?.rows[0]?.[0];
  if (!text) return null;
  try {
    return readPlan(text);
  } catch {
    return null;
  }
}

/** Reads the plan Postgres gives with `format json`. */
export function readPlan(text: string): Plan {
  const parsed = JSON.parse(text);
  const top = Array.isArray(parsed) ? parsed[0] : null;
  if (!top || typeof top.Plan !== "object") throw new Error("This is not a plan.");
  const analyzed = "Actual Loops" in top.Plan;
  return {
    root: stepOf(top.Plan, "0", analyzed),
    analyzed,
    planningMs: typeof top["Planning Time"] === "number" ? top["Planning Time"] : null,
    executionMs: typeof top["Execution Time"] === "number" ? top["Execution Time"] : null,
  };
}

function labelOf(node: Node): string {
  const kind = `${node["Parallel Aware"] === true ? "Parallel " : ""}${node["Node Type"]}`;
  const index = node["Index Name"] ? ` using ${node["Index Name"]}` : "";
  const relation = node["Relation Name"] as string | undefined;
  const alias = node.Alias as string | undefined;
  const target = relation
    ? ` on ${relation}${alias && alias !== relation ? ` ${alias}` : ""}`
    : node["CTE Name"]
      ? ` on ${node["CTE Name"]}`
      : node["Function Name"]
        ? ` on ${node["Function Name"]}()`
        : "";
  return `${kind}${index}${target}`;
}

function detailsOf(node: Node): [string, string][] {
  return Object.entries(node)
    .filter(([key]) => key !== "Plans")
    .map(([key, value]) => [key, Array.isArray(value) ? value.join(", ") : String(value)]);
}

function problemsOf(node: Node, analyzed: boolean): Problem[] {
  const problems: Problem[] = [];
  const loops = number(node["Actual Loops"]);
  const estimated = number(node["Plan Rows"]);
  const relation = node["Relation Name"] as string | undefined;

  if (analyzed && loops > 0) {
    const actual = number(node["Actual Rows"]);
    const removed = number(node["Rows Removed by Filter"]);
    const read = (actual + removed) * loops;
    if (removed > 0 && read >= BIG_TABLE && actual * loops <= read * FILTER_KEEPS) {
      const share = Math.round(((actual * loops) / read) * 100);
      problems.push({ kind: "filter", text: `Read ${count(read)} rows to keep ${count(actual * loops)} (${share}%). An index on what it filters by may help.` });
    } else if (node["Node Type"] === "Seq Scan" && read >= BIG_TABLE) {
      problems.push({ kind: "seq-scan", text: `Reads every row of ${relation}, ${count(read)} of them.` });
    }
    const [low, high] = actual < estimated ? [actual, estimated] : [estimated, actual];
    if (high >= ESTIMATE_FLOOR && high / Math.max(low, 1) >= ESTIMATE_OFF) {
      const stale = relation ? ` The statistics may be stale: try analyze ${relation}.` : " The statistics may be stale.";
      problems.push({ kind: "estimate", text: `Expected ${count(estimated)} rows a run, got ${count(actual)}.${stale}` });
    }
  } else if (!analyzed && node["Node Type"] === "Seq Scan" && estimated >= BIG_TABLE) {
    problems.push({ kind: "seq-scan", text: `Reads every row of ${relation}, about ${count(estimated)} of them.` });
  }

  if (node["Sort Space Type"] === "Disk" || number(node["Hash Batches"]) > 1) {
    problems.push({ kind: "disk", text: "Ran out of work_mem and used the disk." });
  }
  return problems;
}

function stepOf(node: Node, id: string, analyzed: boolean): PlanStep {
  const children = ((node.Plans as Node[] | undefined) ?? []).map((child, at) => stepOf(child, `${id}.${at}`, analyzed));
  const loops = number(node["Actual Loops"]);
  const cost = number(node["Total Cost"]);
  // Postgres gives a step's time for one run of it.
  const time = analyzed ? number(node["Actual Total Time"]) * loops : null;
  const sum = (of: (step: PlanStep) => number) => children.reduce((total, child) => total + of(child), 0);
  return {
    id,
    kind: String(node["Node Type"]),
    label: labelOf(node),
    estimatedRows: number(node["Plan Rows"]),
    actualRows: analyzed ? number(node["Actual Rows"]) : null,
    loops,
    cost,
    // Parallel workers can make what is under a step add up to more than it.
    ownCost: Math.max(0, cost - sum((child) => child.cost)),
    time,
    ownTime: time === null ? null : Math.max(0, time - sum((child) => child.time ?? 0)),
    details: detailsOf(node),
    problems: problemsOf(node, analyzed),
    children,
  };
}

/** What is worth reading about a step, and what is quiet: counters that stayed at nothing and switches that are off, which are most of them. */
export function notable(details: [string, string][]): { shown: [string, string][]; quiet: [string, string][] } {
  const isQuiet = ([, value]: [string, string]) => value === "0" || value === "false";
  return { shown: details.filter((detail) => !isQuiet(detail)), quiet: details.filter(isQuiet) };
}

/** Each step under the one that uses its rows, as wide as its share of the time, or of the cost when the statement was not run. */
export function icicle(plan: Plan): Bar[] {
  const weight = (step: PlanStep) => (plan.analyzed ? (step.time ?? 0) : step.cost);
  const bars: Bar[] = [];
  const place = (step: PlanStep, depth: number, start: number, width: number) => {
    bars.push({ step, depth, start, width });
    const total = step.children.reduce((sum, child) => sum + weight(child), 0);
    // What is under a step never spills out of it, even when it adds up to more.
    const whole = Math.max(weight(step), total);
    const scale = whole > 0 ? width / whole : 0;
    let at = start;
    for (const child of step.children) {
      place(child, depth + 1, at, weight(child) * scale);
      at += weight(child) * scale;
    }
  };
  place(plan.root, 0, 0, 1);
  return bars;
}
