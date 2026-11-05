import { render, screen } from "@testing-library/react";

import { MetricsBar } from "./MetricsBar";
import { derive } from "./metrics";
import type { MetricsState } from "./useMetrics";
import { metricsSnapshot } from "./test/fakeGateway";

const first = metricsSnapshot();

/** A database as the bar is given it, with the look before it so that rates can be worked out. */
function show(overrides: Parameters<typeof metricsSnapshot>[0] = {}, rest: Partial<MetricsState> = {}, steady = true) {
  const next = metricsSnapshot({ transactions: first.transactions + 600, sampled_at: first.sampled_at + 5, ...overrides });
  const state: MetricsState = {
    now: derive(steady ? first : null, next, first),
    history: { connections: [10, 11, 12], tps: [100, 110, 120] },
    points: [],
    error: null,
    ...rest,
  };
  return render(<MetricsBar state={state} />);
}

const gauge = (name: RegExp | string) => screen.getByLabelText(name);

describe("what it shows", () => {
  test("connections, as many as there are of the most allowed", () => {
    show({ connections: 42, max_connections: 100 });

    expect(gauge("Connections: 42 of 100")).toHaveTextContent("42/100");
  });

  test("the queries that are running, and how long the oldest has been", () => {
    show({ active: 3, longest_active_seconds: 12.4 });

    expect(gauge(/Active queries: 3/)).toHaveTextContent("3");
    expect(gauge(/Active queries: 3/)).toHaveTextContent("12s");
  });

  test("with nothing running there is no time to show", () => {
    show({ active: 0, longest_active_seconds: null });

    expect(gauge(/Active queries: 0/)).not.toHaveTextContent(/\ds/);
  });

  test("the sessions that are waiting for a lock", () => {
    show({ blocked: 2 });

    expect(gauge("Blocked sessions: 2")).toHaveTextContent("2");
  });

  test("how much of what was read was in memory", () => {
    show({ blocks_hit: 9_950_000, blocks_read: 50_000 });

    expect(gauge("Cache hit ratio: 99.5%")).toHaveTextContent("99.5%");
  });

  test("transactions a second, once there are two looks to tell it from", () => {
    show();

    expect(gauge("Transactions per second: 120")).toHaveTextContent("120");
  });

  test("with only one look there is no rate yet, and it says so with a dash", () => {
    show({}, {}, false);

    expect(gauge("Transactions per second: not known yet")).toHaveTextContent("—");
  });
});

describe("how worried it looks", () => {
  test("each gauge carries its tone, so the colour is not the only way to tell", () => {
    show({ connections: 85, max_connections: 100, blocked: 0 });

    expect(gauge(/Connections/)).toHaveAttribute("data-tone", "warn");
    expect(gauge(/Blocked/)).toHaveAttribute("data-tone", "ok");
  });

  test("a problem is bad, not just a warning, when it is bad", () => {
    show({ connections: 98, max_connections: 100, blocked: 7 });

    expect(gauge(/Connections/)).toHaveAttribute("data-tone", "bad");
    expect(gauge(/Blocked/)).toHaveAttribute("data-tone", "bad");
  });
});

describe("what it adds only when there is something to say", () => {
  test("transactions that are open and doing nothing", () => {
    show({ idle_in_transaction: 3 });

    expect(gauge("Idle in transaction: 3")).toHaveAttribute("data-tone", "warn");
  });

  test("none of that, and there is no badge for it", () => {
    show({ idle_in_transaction: 0 });

    expect(screen.queryByLabelText(/Idle in transaction/)).not.toBeInTheDocument();
  });

  test("deadlocks that happened while watching", () => {
    const next = metricsSnapshot({ deadlocks: 2, transactions: first.transactions + 600, sampled_at: first.sampled_at + 5 });
    render(<MetricsBar state={{ now: derive(first, next, first), history: { connections: [], tps: [] }, points: [], error: null }} />);

    expect(screen.getByLabelText("New deadlocks: 2")).toHaveAttribute("data-tone", "warn");
  });

  test("no deadlocks, no badge", () => {
    show();

    expect(screen.queryByLabelText(/deadlocks/i)).not.toBeInTheDocument();
  });
});

describe("a limited view", () => {
  test("it says that it cannot see what other people's sessions are doing, and what that leaves out", () => {
    show({ full_view: false });

    const notice = screen.getByLabelText("Limited view");
    expect(notice).toBeInTheDocument();
    expect(notice).toHaveAttribute("title", expect.stringMatching(/other people/i));
  });

  test("what it cannot see is shown in a quiet tone rather than as fine", () => {
    show({ full_view: false, blocked: 0 });

    expect(gauge(/Blocked/)).toHaveAttribute("data-tone", "quiet");
    expect(gauge(/Connections/)).toHaveAttribute("data-tone", "ok");
  });

  test("with a full view there is no such notice", () => {
    show({ full_view: true });

    expect(screen.queryByLabelText("Limited view")).not.toBeInTheDocument();
  });
});

describe("before and when things go wrong", () => {
  test("while the first look is being taken the gauges are there, with dashes, and marked as busy", () => {
    render(<MetricsBar state={{ now: null, history: { connections: [], tps: [] }, points: [], error: null }} />);

    expect(screen.getByRole("group", { name: "Database metrics" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getAllByText("—").length).toBeGreaterThan(2);
  });

  test("if the very first look fails it says the metrics are unavailable, and why", () => {
    render(<MetricsBar state={{ now: null, history: { connections: [], tps: [] }, points: [], error: "permission denied for view pg_stat_activity" }} />);

    const notice = screen.getByLabelText("Metrics unavailable");
    expect(notice).toHaveAttribute("title", expect.stringContaining("permission denied"));
  });

  test("if a later look fails the last numbers stay, with a note that they are not fresh", () => {
    show({ connections: 42 }, { error: "connection lost" });

    expect(gauge(/Connections: 42/)).toBeInTheDocument();
    expect(screen.getByLabelText("Metrics could not be refreshed")).toHaveAttribute("title", expect.stringContaining("connection lost"));
  });

  test("when it is all fine there is no note", () => {
    show();

    expect(screen.queryByLabelText(/could not be refreshed|unavailable/)).not.toBeInTheDocument();
  });
});

describe("the little graphs", () => {
  test("connections and transactions have one each once there is a history to draw", () => {
    show();

    expect(gauge(/Connections/).querySelector("svg polyline")).not.toBeNull();
    expect(gauge(/Transactions per second/).querySelector("svg polyline")).not.toBeNull();
  });

  test("with fewer than two points there is nothing to draw", () => {
    show({}, { history: { connections: [12], tps: [] } });

    expect(gauge(/Connections/).querySelector("svg")).toBeNull();
  });

  test("a graph of values that do not change is a flat line, not an error", () => {
    show({}, { history: { connections: [5, 5, 5], tps: [] } });

    const points = gauge(/Connections/).querySelector("polyline")!.getAttribute("points")!;
    expect(points).not.toContain("NaN");
  });
});
