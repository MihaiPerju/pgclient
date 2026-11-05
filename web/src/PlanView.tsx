import { WarningFilled } from "@ant-design/icons";
import { Alert, Button, Flex, Typography, theme } from "antd";
import { useMemo, useRef, useState } from "react";

import { MagnifyButton, type Magnify } from "./Magnified";
import { icicle, notable, type Plan, type PlanStep } from "./plan";
import { ResizeHandle, usePaneSize } from "./resize";

const ROW = 26;
const DETAILS_WIDTH = 300;
const MIN_DETAILS_WIDTH = 220;
const MIN_CHART_WIDTH = 240;
/** What a step says that is shown above its details already. */
const SHOWN = new Set(["Node Type", "Relation Name", "Alias", "Index Name", "Parallel Aware", "Plan Rows", "Actual Rows", "Actual Loops", "Total Cost", "Actual Total Time"]);

const ms = (value: number) => `${value < 10 ? value.toFixed(2) : value < 100 ? value.toFixed(1) : Math.round(value).toLocaleString("en-US")} ms`;
const count = (value: number) => Math.round(value).toLocaleString("en-US");
const allSteps = (step: PlanStep): PlanStep[] => [step, ...step.children.flatMap(allSteps)];
const plural = (amount: number, noun: string) => `${amount} ${noun}${amount === 1 ? "" : "s"}`;

/** How a statement is run, as an icicle: each step under the one that uses its rows, as wide as its share of the time, and hotter the more of it is its own. */
export function PlanView({ plan, magnify }: { plan: Plan; magnify?: Magnify }) {
  const { token } = theme.useToken();
  const bars = useMemo(() => icicle(plan), [plan]);
  const steps = useMemo(() => allSteps(plan.root), [plan]);
  const own = (step: PlanStep) => (plan.analyzed ? (step.ownTime ?? 0) : step.ownCost);
  const whole = Math.max(plan.analyzed ? (plan.root.time ?? 0) : plan.root.cost, Number.EPSILON);
  // The step that costs most by itself is usually the one to look at first, and a new plan starts there again.
  const [picked, setPicked] = useState<{ plan: Plan; id: string } | null>(null);
  const busiest = steps.reduce((most, step) => (own(step) > own(most) ? step : most));
  const selected = (picked?.plan === plan && steps.find((step) => step.id === picked.id)) || busiest;
  const setSelectedId = (id: string) => setPicked({ plan, id });
  const flagged = steps.flatMap((step) => step.problems.map((problem) => ({ step, problem })));
  const details = usePaneSize("pgclient.planDetailsWidth");
  const row = useRef<HTMLDivElement>(null);
  const depth = Math.max(...bars.map((bar) => bar.depth)) + 1;
  const [showQuiet, setShowQuiet] = useState(false);
  const { shown, quiet } = notable(selected.details.filter(([key]) => !SHOWN.has(key)));

  const figure = (step: PlanStep) => (plan.analyzed ? ms(step.time ?? 0) : `cost ${count(step.cost)}`);

  return (
    <Flex vertical style={{ height: "100%", minHeight: 0 }}>
      <Flex align="center" gap={8} style={{ padding: "4px 8px", borderBottom: `1px solid ${token.colorBorderSecondary}`, fontSize: 12 }}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {plan.analyzed
            ? `Ran in ${ms(plan.executionMs ?? plan.root.time ?? 0)}${plan.planningMs === null ? "" : ` · planned in ${ms(plan.planningMs)}`} · the statement was rolled back`
            : "Not run: costs are the planner's estimates, in its own units. Explain Analyze runs it for real times."}
        </Typography.Text>
        {magnify && <MagnifyButton magnify={magnify} style={{ marginLeft: "auto" }} />}
      </Flex>
      <div ref={row} style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <section aria-label="Plan" style={{ flex: 1, minWidth: 0, overflow: "auto", padding: 8 }}>
          {flagged.length > 0 && (
            <ul aria-label="Worth a look" style={{ listStyle: "none", margin: "0 0 8px", padding: 0, fontSize: 12 }}>
              {flagged.map(({ step, problem }) => (
                <li key={`${step.id}-${problem.kind}`}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(step.id)}
                    style={{ all: "unset", cursor: "pointer", display: "flex", gap: 6, padding: "2px 0", color: token.colorText }}
                  >
                    <WarningFilled aria-hidden style={{ color: token.colorWarning, marginTop: 3 }} />
                    <span>
                      <strong>{step.label}</strong>: {problem.text}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div role="group" aria-label="Steps" style={{ position: "relative", height: depth * ROW }}>
            {bars.map(({ step, depth: level, start, width }) => {
              const heat = Math.min(1, own(step) / whole);
              const pressed = step.id === selected.id;
              const worth = step.problems.length > 0 ? `, ${plural(step.problems.length, "thing")} worth a look` : "";
              return (
                <button
                  key={step.id}
                  type="button"
                  aria-pressed={pressed}
                  aria-label={`${step.label}${worth}, ${figure(step)}`}
                  title={`${step.label} · ${figure(step)}`}
                  onClick={() => setSelectedId(step.id)}
                  style={{
                    position: "absolute",
                    left: `${start * 100}%`,
                    width: `${width * 100}%`,
                    minWidth: 2,
                    top: level * ROW,
                    height: ROW - 2,
                    boxSizing: "border-box",
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "0 6px",
                    overflow: "hidden",
                    whiteSpace: "nowrap",
                    textAlign: "left",
                    cursor: "pointer",
                    font: "inherit",
                    fontSize: 12,
                    color: token.colorText,
                    // Soft enough at its hottest for the text on it to stay easy to read.
                    background: `color-mix(in srgb, hsl(24 80% 55%) ${Math.round(8 + heat * 32)}%, ${token.colorBgContainer})`,
                    border: `1px solid ${pressed ? token.colorPrimary : token.colorBorderSecondary}`,
                    boxShadow: pressed ? `inset 0 0 0 1px ${token.colorPrimary}` : undefined,
                    borderRadius: 4,
                  }}
                >
                  {step.problems.length > 0 && <WarningFilled aria-hidden style={{ color: token.colorWarning, fontSize: 11 }} />}
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{step.label}</span>
                  <span style={{ color: token.colorText, opacity: 0.75, marginLeft: "auto", paddingLeft: 6, fontVariantNumeric: "tabular-nums" }}>{figure(step)}</span>
                </button>
              );
            })}
          </div>
        </section>
        <ResizeHandle
          orientation="vertical"
          label="Resize step details"
          after
          size={() => details.size ?? DETAILS_WIDTH}
          min={MIN_DETAILS_WIDTH}
          max={() => Math.max(MIN_DETAILS_WIDTH, (row.current?.clientWidth ?? 0) - MIN_CHART_WIDTH)}
          onResize={details.setSize}
          onReset={details.reset}
        />
        <aside aria-label="Step" style={{ width: details.size ?? DETAILS_WIDTH, flex: "none", overflow: "auto", padding: "8px 12px", fontSize: 12 }}>
          <Typography.Text strong>{selected.label}</Typography.Text>
          {selected.problems.map((problem) => (
            <Alert key={problem.kind} type="warning" showIcon title={problem.text} style={{ marginTop: 8, fontSize: 12 }} />
          ))}
          <dl style={{ margin: "8px 0 0", display: "grid", gridTemplateColumns: "auto 1fr", gap: "2px 12px" }}>
            {plan.analyzed ? (
              <>
                <Fact name="Time" value={`${ms(selected.ownTime ?? 0)} itself · ${ms(selected.time ?? 0)} with what is under it`} />
                <Fact name="Rows" value={`${count(selected.actualRows ?? 0)} a run · ${count(selected.estimatedRows)} expected`} />
                <Fact name="Runs" value={count(selected.loops)} />
              </>
            ) : (
              <>
                <Fact name="Cost" value={`${count(selected.ownCost)} itself · ${count(selected.cost)} with what is under it`} />
                <Fact name="Rows" value={`${count(selected.estimatedRows)} expected`} />
              </>
            )}
          </dl>
          <dl style={{ margin: "12px 0 0", display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", fontSize: 12 }}>
            {(showQuiet ? [...shown, ...quiet] : shown).map(([key, value]) => (
              <Fact key={key} name={key} value={value} code />
            ))}
          </dl>
          {quiet.length > 0 && (
            <Button size="small" type="link" style={{ padding: 0, marginTop: 6, fontSize: 12 }} onClick={() => setShowQuiet((open) => !open)}>
              {showQuiet ? "Hide those that are 0 or off" : `Show ${quiet.length} that are 0 or off`}
            </Button>
          )}
        </aside>
      </div>
    </Flex>
  );
}

function Fact({ name, value, code = false }: { name: string; value: string; code?: boolean }) {
  return (
    <>
      <dt>
        <Typography.Text type="secondary" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
          {name}
        </Typography.Text>
      </dt>
      <dd style={{ margin: 0, minWidth: 0, overflowWrap: "anywhere", fontFamily: code ? "var(--pg-mono)" : undefined }}>{value}</dd>
    </>
  );
}
