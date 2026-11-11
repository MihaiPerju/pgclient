import type { Metrics } from "./gateway";

/** How long the charts look back. The samples are five seconds apart, so this is about half an hour. */
export const KEPT = 360;

/** One point on every chart: when it was taken by the server's clock, and each thing worked out from it and the sample before. A rate is null for the first sample, which has nothing to take the change from. */
export interface Point {
  at: number;
  commits: number | null;
  rollbacks: number | null;
  active: number;
  idle: number;
  idleInTransaction: number;
  longestTransaction: number | null;
  maxConnections: number;
  inserted: number | null;
  updated: number | null;
  deleted: number | null;
  fetched: number | null;
  returned: number | null;
  blocksHit: number | null;
  blocksRead: number | null;
  walRecords: number | null;
}

/** The change in a counter a second, or nothing if it went down, as it does when the server restarts or its statistics are reset. */
const rate = (before: number, after: number, seconds: number) => (seconds > 0 && after >= before ? (after - before) / seconds : null);

export function point(previous: Metrics | null, next: Metrics): Point {
  const seconds = previous ? next.sampled_at - previous.sampled_at : 0;
  const per = (key: keyof Metrics) => (previous ? rate(previous[key] as number, next[key] as number, seconds) : null);
  const walRecords = previous?.wal_records != null && next.wal_records !== null ? rate(previous.wal_records, next.wal_records, seconds) : null;
  return {
    at: next.sampled_at,
    commits: per("commits"),
    rollbacks: per("database_rollbacks"),
    active: next.active,
    idle: next.idle,
    idleInTransaction: next.idle_in_transaction,
    longestTransaction: next.longest_transaction_seconds,
    maxConnections: next.max_connections,
    inserted: per("tuples_inserted"),
    updated: per("tuples_updated"),
    deleted: per("tuples_deleted"),
    fetched: per("tuples_fetched"),
    returned: per("tuples_returned"),
    blocksHit: per("blocks_hit"),
    blocksRead: per("blocks_read"),
    walRecords,
  };
}

/** The newest points, and no more than the charts look back over. */
export function keep(points: Point[], next: Point, limit = KEPT): Point[] {
  const all = [...points, next];
  return all.length > limit ? all.slice(all.length - limit) : all;
}

export interface Line {
  key: string;
  label: string;
  values: (number | null)[];
}

/** The most a chart's lines reach, so its scale starts at nothing and ends a little above them, on a round number. */
export function ceiling(lines: Line[], floor = 1): number {
  const top = Math.max(floor, ...lines.flatMap((line) => line.values.filter((value): value is number => value !== null)));
  const magnitude = 10 ** Math.floor(Math.log10(top));
  const step = [1, 2, 2.5, 5, 10].find((candidate) => candidate * magnitude >= top) ?? 10;
  return step * magnitude;
}

/** The share of block reads that were found in memory, for a moment, or nothing when there were too few reads for it to mean anything. */
export function cacheShare(point: Point, enough = 10): number | null {
  if (point.blocksHit === null || point.blocksRead === null) return null;
  const all = point.blocksHit + point.blocksRead;
  return all >= enough ? (point.blocksHit / all) * 100 : null;
}
