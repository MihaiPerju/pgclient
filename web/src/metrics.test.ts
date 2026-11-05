import { derive, formatCount, formatDuration, formatRate, pushHistory, tone } from "./metrics";
import { metricsSnapshot } from "./test/fakeGateway";

const first = metricsSnapshot();

describe("working out how the database is doing from its snapshots", () => {
  test("connections are counted against the most allowed, as a share", () => {
    const now = derive(null, metricsSnapshot({ connections: 42, max_connections: 100 }), first);

    expect(now).toMatchObject({ connections: 42, maxConnections: 100, connectionsShare: 0.42 });
  });

  test("the first sample has no rate yet, since a rate is a change between two", () => {
    expect(derive(null, first, first).tps).toBeNull();
  });

  test("transactions a second is the change in the count over the time between, by the server's clock", () => {
    const next = metricsSnapshot({ transactions: first.transactions + 600, sampled_at: first.sampled_at + 5 });

    expect(derive(first, next, first).tps).toBe(120);
  });

  test("a count that went down, as after the server restarted, is no rate at all", () => {
    const next = metricsSnapshot({ transactions: 5, sampled_at: first.sampled_at + 5 });

    expect(derive(first, next, first).tps).toBeNull();
  });

  test("two samples of the same instant give no rate rather than a division by nothing", () => {
    expect(derive(first, metricsSnapshot({ transactions: first.transactions + 10 }), first).tps).toBeNull();
  });

  test("the share of rollbacks is of the transactions in the same stretch", () => {
    const next = metricsSnapshot({ transactions: first.transactions + 1000, rollbacks: first.rollbacks + 50, sampled_at: first.sampled_at + 5 });

    expect(derive(first, next, first).rollbackShare).toBeCloseTo(0.05);
  });

  test("the cache hit ratio is how much was found in memory, as a percentage", () => {
    const now = derive(null, metricsSnapshot({ blocks_hit: 9_950_000, blocks_read: 50_000 }), first);

    expect(now.cacheHit).toBeCloseTo(99.5);
  });

  test("a database that has hardly been read from has no ratio worth showing", () => {
    expect(derive(null, metricsSnapshot({ blocks_hit: 10, blocks_read: 90 }), first).cacheHit).toBeNull();
  });

  test("deadlocks are only those since watching began, since the count goes back to when the statistics were last reset", () => {
    const began = metricsSnapshot({ deadlocks: 4 });

    expect(derive(null, metricsSnapshot({ deadlocks: 4 }), began).newDeadlocks).toBe(0);
    expect(derive(null, metricsSnapshot({ deadlocks: 6 }), began).newDeadlocks).toBe(2);
  });

  test("the oldest running query, what is idle and what is waiting are passed on as they are", () => {
    const now = derive(null, metricsSnapshot({ active: 3, idle: 7, idle_in_transaction: 2, blocked: 1, longest_active_seconds: 42 }), first);

    expect(now).toMatchObject({ active: 3, idle: 7, idleInTransaction: 2, blocked: 1, longestActive: 42 });
  });

  test("whether the whole server could be seen is passed on too", () => {
    expect(derive(null, metricsSnapshot({ full_view: false }), first).fullView).toBe(false);
  });
});

describe("how worried to look", () => {
  const read = (overrides = {}) => derive(null, metricsSnapshot(overrides), first);

  test("plenty of room for connections is fine, and it gets worse as they run out", () => {
    expect(tone("connections", read({ connections: 40 }))).toBe("ok");
    expect(tone("connections", read({ connections: 80 }))).toBe("warn");
    expect(tone("connections", read({ connections: 95 }))).toBe("bad");
  });

  test("a query that has been running for a while is a warning, and for minutes is bad", () => {
    expect(tone("longest", read({ longest_active_seconds: 5 }))).toBe("ok");
    expect(tone("longest", read({ longest_active_seconds: 45 }))).toBe("warn");
    expect(tone("longest", read({ longest_active_seconds: 400 }))).toBe("bad");
    expect(tone("longest", read({ longest_active_seconds: null }))).toBe("ok");
  });

  test("nothing blocked is fine, and anything waiting on a lock is not", () => {
    expect(tone("blocked", read({ blocked: 0 }))).toBe("ok");
    expect(tone("blocked", read({ blocked: 1 }))).toBe("warn");
    expect(tone("blocked", read({ blocked: 6 }))).toBe("bad");
  });

  test("a cache that is mostly hits is fine, and one that goes to disk a lot is not", () => {
    expect(tone("cache", read({ blocks_hit: 9_990_000, blocks_read: 10_000 }))).toBe("ok");
    expect(tone("cache", read({ blocks_hit: 9_800_000, blocks_read: 200_000 }))).toBe("warn");
    expect(tone("cache", read({ blocks_hit: 8_000_000, blocks_read: 2_000_000 }))).toBe("bad");
    expect(tone("cache", read({ blocks_hit: 1, blocks_read: 5 }))).toBe("quiet");
  });

  test("transactions open and doing nothing are a warning, since they hold locks", () => {
    expect(tone("idleInTransaction", read({ idle_in_transaction: 0 }))).toBe("ok");
    expect(tone("idleInTransaction", read({ idle_in_transaction: 2 }))).toBe("warn");
    expect(tone("idleInTransaction", read({ idle_in_transaction: 12 }))).toBe("bad");
  });

  test("a deadlock while watching is a warning", () => {
    expect(tone("deadlocks", derive(null, metricsSnapshot({ deadlocks: 3 }), metricsSnapshot({ deadlocks: 1 })))).toBe("warn");
    expect(tone("deadlocks", read())).toBe("ok");
  });

  test("what cannot be seen is not called fine: with a limited view the tone is quiet, not ok", () => {
    const limited = read({ full_view: false, blocked: 0, longest_active_seconds: null, idle_in_transaction: 0 });

    expect(tone("blocked", limited)).toBe("quiet");
    expect(tone("longest", limited)).toBe("quiet");
    expect(tone("idleInTransaction", limited)).toBe("quiet");
    expect(tone("connections", limited)).toBe("ok");
  });
});

describe("how it reads", () => {
  test("a duration is in the largest unit that makes sense", () => {
    expect(formatDuration(0.4)).toBe("<1s");
    expect(formatDuration(12.6)).toBe("12s");
    expect(formatDuration(184)).toBe("3m 4s");
    expect(formatDuration(3720)).toBe("1h 2m");
  });

  test("a rate keeps a decimal while it is small, and is rounded once it is large", () => {
    expect(formatRate(0)).toBe("0");
    expect(formatRate(3.64)).toBe("3.6");
    expect(formatRate(120.4)).toBe("120");
    expect(formatRate(1234)).toBe("1.2k");
  });

  test("a count is written out in full", () => {
    expect(formatCount(42)).toBe("42");
    expect(formatCount(1234567)).toBe("1,234,567");
  });
});

describe("keeping a short history for the little graphs", () => {
  test("a value is added at the end, and the oldest goes once there are too many", () => {
    expect(pushHistory([1, 2], 3, 5)).toEqual([1, 2, 3]);
    expect(pushHistory([1, 2, 3], 4, 3)).toEqual([2, 3, 4]);
  });

  test("the list that was given is left as it was", () => {
    const before = [1, 2];
    pushHistory(before, 3, 5);

    expect(before).toEqual([1, 2]);
  });
});
