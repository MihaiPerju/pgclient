import { describe, expect, it } from "vitest";

import { explainQuery, icicle, notable, planIn, readPlan, type PlanStep } from "./plan";
import analyzed from "./samples/analyzedPlan.json?raw";
import plain from "./samples/plan.json?raw";

/** A plan as Postgres writes it, from steps given as their JSON. */
const planOf = (root: object, extra: object = {}) => JSON.stringify([{ Plan: root, ...extra }]);
const steps = (step: PlanStep): PlanStep[] => [step, ...step.children.flatMap(steps)];

describe("asking for a plan", () => {
  it("asks for the plan as JSON, without running the statement", () => {
    expect(explainQuery("select * from jobs", false)).toEqual({ sql: "explain (format json) select * from jobs" });
  });

  it("drops the semicolon and blank lines at the end", () => {
    expect(explainQuery("  select 1;  \n\n", false)).toEqual({ sql: "explain (format json) select 1" });
  });

  it("with Analyze runs it inside a transaction that is rolled back, so a change it makes is undone", () => {
    expect(explainQuery("delete from jobs", true)).toEqual({ sql: "begin;\nexplain (analyze, buffers, format json) delete from jobs;\nrollback;" });
  });

  it("refuses more than one statement, as the ones after the first would really run", () => {
    expect(explainQuery("select 1; delete from jobs", false)).toEqual({ problem: "Explain takes one statement. Select the one to explain." });
  });

  it("is not fooled by a semicolon in a string or a comment", () => {
    expect(explainQuery("select ';' -- done;\nfrom t", false)).toEqual({ sql: "explain (format json) select ';' -- done;\nfrom t" });
  });

  it("has nothing to explain in an empty editor", () => {
    expect(explainQuery(" ; ", false)).toEqual({ problem: "Write a statement to explain." });
  });
});

describe("finding the plan among the results", () => {
  it("is the one result with a QUERY PLAN column, after the transaction's own results", () => {
    const results = [
      { columns: [], rows: [] },
      { columns: ["QUERY PLAN"], rows: [[plain]] },
      { columns: [], rows: [] },
    ];
    expect(planIn(results)?.root.kind).toBe("Sort");
  });

  it("is nothing when no result is a plan", () => {
    expect(planIn([{ columns: ["id"], rows: [["1"]] }])).toBeNull();
  });
});

describe("reading a plan", () => {
  it("reads the steps as a tree, each named by what it does and on what", () => {
    const plan = readPlan(plain);
    expect(steps(plan.root).map((step) => step.label)).toEqual(["Sort", "Aggregate", "Hash Join", "Seq Scan on job_runs r", "Hash", "Seq Scan on jobs c"]);
    expect(plan.analyzed).toBe(false);
  });

  it("names an index scan by its index, and leaves out an alias that is just the name", () => {
    const plan = readPlan(planOf({ "Node Type": "Index Scan", "Index Name": "job_runs_pkey", "Relation Name": "job_runs", Alias: "job_runs", "Total Cost": 8, "Plan Rows": 1 }));
    expect(plan.root.label).toBe("Index Scan using job_runs_pkey on job_runs");
  });

  it("without Analyze weighs a step by its estimated cost, less what the steps under it cost", () => {
    const join = steps(readPlan(plain).root).find((step) => step.kind === "Hash Join")!;
    expect(join.cost).toBe(952.29);
    expect(join.ownCost).toBeCloseTo(952.29 - 944 - 3);
    expect(join.time).toBeNull();
  });

  it("with Analyze knows the real time, rows and the totals of the run", () => {
    const plan = readPlan(analyzed);
    const scan = steps(plan.root).find((step) => step.label === "Seq Scan on job_runs r")!;
    expect(plan.analyzed).toBe(true);
    expect(plan.executionMs).toBeGreaterThan(0);
    expect(plan.planningMs).toBeGreaterThan(0);
    expect(scan.actualRows).toBe(1000);
    expect(scan.time).toBe(1.565);
  });

  it("counts the time of a step run many times over all its runs, as Postgres gives it per run", () => {
    const plan = readPlan(
      planOf({
        "Node Type": "Nested Loop",
        "Total Cost": 100,
        "Plan Rows": 10,
        "Actual Total Time": 50,
        "Actual Rows": 10,
        "Actual Loops": 1,
        Plans: [{ "Node Type": "Index Scan", "Index Name": "i", "Relation Name": "t", "Total Cost": 1, "Plan Rows": 1, "Actual Total Time": 0.4, "Actual Rows": 1, "Actual Loops": 100 }],
      }),
    );
    const [inner] = plan.root.children;
    expect(inner.time).toBeCloseTo(40);
    expect(plan.root.ownTime).toBeCloseTo(10);
  });

  it("never gives a step less than nothing of its own, which parallel workers can make it look like", () => {
    const plan = readPlan(planOf({ "Node Type": "Gather", "Total Cost": 10, "Plan Rows": 1, Plans: [{ "Node Type": "Seq Scan", "Relation Name": "t", "Total Cost": 12, "Plan Rows": 1 }] }));
    expect(plan.root.ownCost).toBe(0);
  });

  it("keeps the rest of what Postgres says about a step, to show beside it", () => {
    const join = steps(readPlan(plain).root).find((step) => step.kind === "Hash Join")!;
    expect(join.details).toContainEqual(["Hash Cond", "(r.job_id = c.id)"]);
    expect(join.details.map(([key]) => key)).not.toContain("Plans");
  });

  it("refuses text that is not a plan", () => {
    expect(() => readPlan("[]")).toThrow("not a plan");
    expect(() => readPlan("nope")).toThrow();
  });
});

describe("what may be wrong with a step", () => {
  const scan = (fields: object) => readPlan(planOf({ "Node Type": "Seq Scan", "Relation Name": "job_runs", "Total Cost": 1, ...fields })).root.problems.map((problem) => problem.kind);

  it("a filter that throws away most of what it reads may want an index", () => {
    const run = steps(readPlan(analyzed).root).find((step) => step.label === "Seq Scan on job_runs r")!;
    expect(run.problems).toEqual([{ kind: "filter", text: "Read 50,000 rows to keep 1,000 (2%). An index on what it filters by may help." }]);
  });

  it("a guess far from what came, either way, means the statistics may be stale", () => {
    expect(scan({ "Plan Rows": 10, "Actual Rows": 5000, "Actual Loops": 1 })).toContain("estimate");
    expect(scan({ "Plan Rows": 5000, "Actual Rows": 10, "Actual Loops": 1 })).toContain("estimate");
    expect(scan({ "Plan Rows": 10, "Actual Rows": 90, "Actual Loops": 1 })).not.toContain("estimate");
  });

  it("an empty result guessed as a handful is no surprise", () => {
    expect(scan({ "Plan Rows": 1, "Actual Rows": 0, "Actual Loops": 1 })).toEqual([]);
  });

  it("reading every row of a big table is pointed out, though a small one is not", () => {
    expect(scan({ "Plan Rows": 50000 })).toEqual(["seq-scan"]);
    expect(scan({ "Plan Rows": 200 })).toEqual([]);
  });

  it("a sort or hash that ran out of memory went to disk", () => {
    const sorted = readPlan(planOf({ "Node Type": "Sort", "Total Cost": 1, "Plan Rows": 1, "Actual Rows": 1, "Actual Loops": 1, "Sort Space Type": "Disk" }));
    const hashed = readPlan(planOf({ "Node Type": "Hash", "Total Cost": 1, "Plan Rows": 1, "Actual Rows": 1, "Actual Loops": 1, "Hash Batches": 4 }));
    expect(sorted.root.problems.map((problem) => problem.kind)).toEqual(["disk"]);
    expect(hashed.root.problems.map((problem) => problem.kind)).toEqual(["disk"]);
  });
});

describe("drawing a plan as an icicle", () => {
  it("puts each step under the one that uses its rows, as wide as its share of the whole", () => {
    const bars = icicle(readPlan(plain));
    const at = (label: string) => bars.find((bar) => bar.step.label === label)!;
    expect(at("Sort")).toMatchObject({ depth: 0, start: 0, width: 1 });
    expect(at("Hash Join").depth).toBe(2);
    expect(at("Seq Scan on job_runs r").width).toBeCloseTo(944 / 967.65);
    expect(at("Hash").start).toBeCloseTo(944 / 967.65);
  });

  it("goes by time once the statement has really run", () => {
    const bars = icicle(readPlan(analyzed));
    expect(bars.find((bar) => bar.step.label === "Hash Join")!.width).toBeCloseTo(1.691 / 1.807);
  });

  it("squeezes steps that add up to more than the one above into its width", () => {
    const bars = icicle(readPlan(planOf({ "Node Type": "Gather", "Total Cost": 10, "Plan Rows": 1, Plans: [{ "Node Type": "Seq Scan", "Relation Name": "t", "Total Cost": 12, "Plan Rows": 1 }] })));
    expect(bars[1]).toMatchObject({ start: 0, width: 1 });
  });
});

describe("what is worth reading about a step", () => {
  it("leaves out counters that stayed at nothing and switches that are off, which are most of them", () => {
    const details: [string, string][] = [["Index Cond", "(id = 1)"], ["Shared Hit Blocks", "2"], ["Shared Read Blocks", "0"], ["Async Capable", "false"], ["Inner Unique", "true"]];

    expect(notable(details)).toEqual({ shown: [["Index Cond", "(id = 1)"], ["Shared Hit Blocks", "2"], ["Inner Unique", "true"]], quiet: [["Shared Read Blocks", "0"], ["Async Capable", "false"]] });
  });
});
