import { cacheShare, ceiling, keep, point } from "./series";
import { metricsSnapshot } from "./test/fakeGateway";

const first = metricsSnapshot();
const later = (over: Partial<typeof first>) => metricsSnapshot({ sampled_at: first.sampled_at + 5, ...over });

describe("a point on the charts", () => {
  test("the first has no rates, only what is known at once", () => {
    const now = point(null, metricsSnapshot({ active: 3, idle: 9, idle_in_transaction: 1, max_connections: 100 }));

    expect(now).toMatchObject({ active: 3, idle: 9, idleInTransaction: 1, maxConnections: 100, commits: null, inserted: null, blocksHit: null });
  });

  test("a rate is the change in the count over the time between the two by the server's clock", () => {
    const now = point(first, later({ commits: first.commits + 500, database_rollbacks: first.database_rollbacks + 10, tuples_inserted: first.tuples_inserted + 50 }));

    expect(now).toMatchObject({ commits: 100, rollbacks: 2, inserted: 10, updated: 0, deleted: 0 });
  });

  test("the oldest open transaction is known at once, and is nothing when none is open", () => {
    expect(point(null, metricsSnapshot({ longest_transaction_seconds: 42 })).longestTransaction).toBe(42);
    expect(point(null, metricsSnapshot({ longest_transaction_seconds: null })).longestTransaction).toBeNull();
  });

  test("wal records a second are the change in the server's count of them", () => {
    const now = point(first, later({ wal_records: (first.wal_records ?? 0) + 2500 }));

    expect(now.walRecords).toBe(500);
  });

  test("a server that does not count wal records, as before Postgres 14, gives no rate for them", () => {
    expect(point({ ...first, wal_records: null }, later({ wal_records: null })).walRecords).toBeNull();
  });

  test("a count that went down, as after a restart, is no rate rather than a negative one", () => {
    expect(point(first, later({ commits: 3 })).commits).toBeNull();
  });

  test("two samples of the same instant give no rate rather than a division by nothing", () => {
    expect(point(first, metricsSnapshot({ commits: first.commits + 9 })).commits).toBeNull();
  });

  test("block reads are told apart as found in memory and read from disk", () => {
    const now = point(first, later({ blocks_hit: first.blocks_hit + 5000, blocks_read: first.blocks_read + 50 }));

    expect(now).toMatchObject({ blocksHit: 1000, blocksRead: 10 });
  });
});

describe("what the charts keep", () => {
  const at = (n: number) => ({ ...point(null, metricsSnapshot({ sampled_at: n })) });

  test("the newest points, up to the limit, the oldest going first", () => {
    let points = [at(1), at(2), at(3)];

    points = keep(points, at(4), 3);

    expect(points.map((one) => one.at)).toEqual([2, 3, 4]);
  });

  test("fewer than the limit are all kept", () => {
    expect(keep([at(1)], at(2), 5)).toHaveLength(2);
  });
});

describe("the top of a chart's scale", () => {
  const line = (...values: (number | null)[]) => ({ key: "k", label: "k", values });

  test("it is a round number a little above the highest value", () => {
    expect(ceiling([line(0, 3, 47)])).toBe(50);
    expect(ceiling([line(0, 120)])).toBe(200);
    expect(ceiling([line(0, 0.4)])).toBe(1);
    expect(ceiling([line(2300)])).toBe(2500);
  });

  test("it looks at every line, and passes over a gap", () => {
    expect(ceiling([line(1, null, 4), line(90)])).toBe(100);
  });

  test("a chart with nothing in it still has a scale", () => {
    expect(ceiling([line(null, null)])).toBe(1);
    expect(ceiling([])).toBe(1);
  });
});

describe("the share found in memory", () => {
  test("it is of all the reads in the moment, as a percentage", () => {
    expect(cacheShare({ ...point(null, first), blocksHit: 990, blocksRead: 10 })).toBeCloseTo(99);
  });

  test("a moment with hardly any reads has none worth showing, and one with no rates has none at all", () => {
    expect(cacheShare({ ...point(null, first), blocksHit: 2, blocksRead: 1 })).toBeNull();
    expect(cacheShare(point(null, first))).toBeNull();
  });
});
