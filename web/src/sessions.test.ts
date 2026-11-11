import { describe, expect, it } from "vitest";

import { arrange, flagsOf, howLong } from "./sessions";
import { sessionOf } from "./test/fakeGateway";

const session = sessionOf;

describe("how long, read at a glance", () => {
  it("says seconds, minutes, hours and days, to the two biggest", () => {
    expect(howLong(0.42)).toBe("0.4 s");
    expect(howLong(12.3)).toBe("12 s");
    expect(howLong(185)).toBe("3 min 5 s");
    expect(howLong(3900)).toBe("1 h 5 min");
    expect(howLong(2 * 86400 + 3 * 3600 + 60)).toBe("2 d 3 h");
  });
});

describe("what is worth pointing out about a session", () => {
  it("one holding a lock others wait for says how many", () => {
    const all = [session(1, { state: "idle in transaction" }), session(2, { blocked_by: [1] }), session(3, { blocked_by: [1] })];
    expect(flagsOf(all[0], all)).toContainEqual({ kind: "blocking", text: "Blocking 2 sessions" });
  });

  it("one waiting says on whom", () => {
    const all = [session(1), session(2, { state: "active", blocked_by: [1], wait_event_type: "Lock" })];
    expect(flagsOf(all[1], all)).toEqual([{ kind: "blocked", text: "Waiting for a lock held by 1" }]);
  });

  it("one left idle in a transaction for a minute or more is keeping its locks and holding vacuum back", () => {
    const stuck = session(1, { state: "idle in transaction", state_seconds: 300, transaction_seconds: 400 });
    expect(flagsOf(stuck, [stuck])).toEqual([{ kind: "idle-in-transaction", text: "Idle in a transaction for 5 min, keeping its locks" }]);
    const brief = session(2, { state: "idle in transaction", state_seconds: 2 });
    expect(flagsOf(brief, [brief])).toEqual([]);
  });

  it("a query running for a minute or more is long", () => {
    const slow = session(1, { state: "active", query_seconds: 125 });
    expect(flagsOf(slow, [slow])).toEqual([{ kind: "long", text: "Running for 2 min 5 s" }]);
  });

  it("a transaction open for a minute or more is long, however quick the query it is running now", () => {
    const busy = session(1, { state: "active", query_seconds: 0.2, transaction_seconds: 600 });
    expect(flagsOf(busy, [busy])).toEqual([{ kind: "long-transaction", text: "In a transaction open for 10 min" }]);
  });

  it("a slow query that is its whole transaction is said once, as a slow query", () => {
    const slow = session(1, { state: "active", query_seconds: 125, transaction_seconds: 125.3 });
    expect(flagsOf(slow, [slow]).map((flag) => flag.kind)).toEqual(["long"]);
  });

  it("a transaction open for long that keeps going idle briefly is long too", () => {
    const sipping = session(1, { state: "idle in transaction", state_seconds: 3, transaction_seconds: 185 });
    expect(flagsOf(sipping, [sipping])).toEqual([{ kind: "long-transaction", text: "In a transaction open for 3 min 5 s" }]);
  });
});

describe("the order they are listed in", () => {
  const all = [
    session(1, { state: "idle", state_seconds: 5 }),
    session(2, { state: "active", query_seconds: 3 }),
    session(3, { state: "active", query_seconds: 40 }),
    session(4, { state: "active", blocked_by: [5], query_seconds: 9 }),
    session(5, { state: "idle in transaction", transaction_seconds: 20, state_seconds: 10 }),
    session(6, { state: "idle", state_seconds: 1 }),
  ];

  it("puts the ones holding others up first, then those waiting, then the longest running, and hides the idle", () => {
    const { shown, idle } = arrange(all, false);
    expect(shown.map((one) => one.pid)).toEqual([5, 4, 3, 2]);
    expect(idle).toBe(2);
  });

  it("puts the running ones in order of how long their transaction has been open, else their query", () => {
    const running = [session(1, { state: "active", query_seconds: 40 }), session(2, { state: "active", query_seconds: 1, transaction_seconds: 900 })];
    expect(arrange(running, false).shown.map((one) => one.pid)).toEqual([2, 1]);
  });

  it("can show the idle too, at the end", () => {
    expect(arrange(all, true).shown.map((one) => one.pid)).toEqual([5, 4, 3, 2, 6, 1]);
  });
});
