import { act, renderHook } from "@testing-library/react";
import { vi } from "vitest";

import type { Metrics } from "./gateway";
import { INTERVAL_MS, useMetrics } from "./useMetrics";
import { fakeGateway, metricsSnapshot } from "./test/fakeGateway";

let hidden = false;
const setHidden = (value: boolean) => {
  hidden = value;
  document.dispatchEvent(new Event("visibilitychange"));
};

beforeEach(() => {
  vi.useFakeTimers();
  hidden = false;
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
});
afterEach(() => vi.useRealTimers());

/** Lets time pass, and whatever that sets off finish. */
const wait = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

function watch(server: string | null = "s1", database: string | null = "app", fake = fakeGateway()) {
  const view = renderHook(({ s, d }) => useMetrics(fake.gateway, s, d), { initialProps: { s: server, d: database } });
  return { fake, ...view };
}

test("with no database chosen nothing is asked", async () => {
  const { fake, result } = watch("s1", null);

  await wait(INTERVAL_MS * 3);

  expect(fake.gateway.metrics).not.toHaveBeenCalled();
  expect(result.current.now).toBeNull();
});

test("the first look is at once, not after the first wait", async () => {
  const { fake, result } = watch();

  await wait(10);

  expect(fake.gateway.metrics).toHaveBeenCalledWith("s1", "app");
  expect(result.current.now?.connections).toBe(12);
});

test("it looks again every few seconds", async () => {
  const { fake } = watch();

  await wait(INTERVAL_MS * 3 + 10);

  expect(fake.gateway.metrics).toHaveBeenCalledTimes(4);
});

test("a rate appears once there are two looks to take the change between", async () => {
  const { result } = watch();
  await wait(10);
  expect(result.current.now?.tps).toBeNull();

  await wait(INTERVAL_MS);

  expect(result.current.now?.tps).toBe(120);
});

test("it keeps a history for the little graphs, which stops growing at a limit", async () => {
  const { result } = watch();

  await wait(INTERVAL_MS * 40);

  expect(result.current.history.connections.length).toBe(30);
  expect(result.current.history.tps.length).toBeLessThanOrEqual(30);
  expect(result.current.history.tps.length).toBeGreaterThan(5);
});

test("a look that is slow is waited for, not piled on with another", async () => {
  const fake = fakeGateway();
  let finish: (metrics: Metrics) => void = () => {};
  fake.gateway.metrics.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
  watch("s1", "app", fake);

  await wait(INTERVAL_MS * 3);

  expect(fake.gateway.metrics).toHaveBeenCalledTimes(1);
  finish(metricsSnapshot());
});

test("while the window is hidden nothing is asked", async () => {
  const { fake } = watch();
  await wait(10);
  setHidden(true);
  fake.gateway.metrics.mockClear();

  await wait(INTERVAL_MS * 4);

  expect(fake.gateway.metrics).not.toHaveBeenCalled();
});

test("when the window comes back it looks at once, so what is shown is not old", async () => {
  const { fake } = watch();
  await wait(10);
  setHidden(true);
  await wait(INTERVAL_MS * 4);
  fake.gateway.metrics.mockClear();

  setHidden(false);
  await wait(10);

  expect(fake.gateway.metrics).toHaveBeenCalledTimes(1);
});

test("choosing another database starts again, with nothing of the old one left", async () => {
  const { fake, result, rerender } = watch();
  await wait(INTERVAL_MS + 10);
  expect(result.current.history.connections.length).toBe(2);

  rerender({ s: "s1", d: "other" });
  await wait(10);

  expect(fake.gateway.metrics).toHaveBeenLastCalledWith("s1", "other");
  expect(result.current.history.connections.length).toBe(1);
  expect(result.current.now?.tps).toBeNull();
});

test("a reply that arrives late for the database that was left is ignored", async () => {
  const fake = fakeGateway();
  let late: (metrics: Metrics) => void = () => {};
  fake.gateway.metrics.mockImplementationOnce(() => new Promise((resolve) => (late = resolve)));
  const { result, rerender } = watch("s1", "old", fake);

  rerender({ s: "s1", d: "new" });
  await wait(10);
  late(metricsSnapshot({ database: "old", connections: 99 }));
  await wait(10);

  expect(result.current.now?.database).toBe("app");
  expect(result.current.now?.connections).toBe(12);
});

test("a failed look is shown as a problem, and what was last known is kept", async () => {
  const { fake, result } = watch();
  await wait(10);
  fake.gateway.metrics.mockRejectedValueOnce("FATAL: terminating connection");

  await wait(INTERVAL_MS);

  expect(result.current.error).toContain("terminating connection");
  expect(result.current.now?.connections).toBe(12);
});

test("the next look that works clears the problem", async () => {
  const { fake, result } = watch();
  await wait(10);
  fake.gateway.metrics.mockRejectedValueOnce("boom");
  await wait(INTERVAL_MS);
  expect(result.current.error).not.toBeNull();

  await wait(INTERVAL_MS);

  expect(result.current.error).toBeNull();
});

test("it stops asking when it is no longer wanted", async () => {
  const { fake, unmount } = watch();
  await wait(10);
  unmount();
  fake.gateway.metrics.mockClear();

  await wait(INTERVAL_MS * 3);

  expect(fake.gateway.metrics).not.toHaveBeenCalled();
});

test("every look is kept as a point for the charts, the first with no rates and the rest with them", async () => {
  const { result } = watch();

  await wait(10);
  expect(result.current.points).toHaveLength(1);
  expect(result.current.points[0].commits).toBeNull();

  await wait(INTERVAL_MS * 2);
  expect(result.current.points).toHaveLength(3);
  expect(result.current.points[2].commits).not.toBeNull();
  expect(result.current.points.map((one) => one.at)).toEqual([...result.current.points.map((one) => one.at)].sort((a, b) => a - b));
});

test("what the charts keep starts again when another database is watched", async () => {
  const { result, rerender } = watch();
  await wait(INTERVAL_MS * 2 + 10);
  expect(result.current.points.length).toBeGreaterThan(1);

  rerender({ s: "s1", d: "postgres" });

  expect(result.current.points).toHaveLength(0);
});
