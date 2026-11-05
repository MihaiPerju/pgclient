import type { Metrics } from "./gateway";

/** What the top bar shows, worked out from one snapshot of the database and the one before it. */
export interface Derived {
  database: string;
  connections: number;
  maxConnections: number;
  /** From 0 to 1. */
  connectionsShare: number;
  active: number;
  idle: number;
  idleInTransaction: number;
  longestActive: number | null;
  blocked: number;
  /** Null until there are two snapshots to take the change between. */
  tps: number | null;
  rollbackShare: number | null;
  /** A percentage, or null when too little has been read for it to mean anything. */
  cacheHit: number | null;
  /** Deadlocks since watching began, not since the statistics were last reset, which could be months ago. */
  newDeadlocks: number;
  fullView: boolean;
}

export type Tone = "ok" | "warn" | "bad" | "quiet";
export type Gauge = "connections" | "longest" | "blocked" | "cache" | "idleInTransaction" | "deadlocks";

/** Fewer blocks than this and a ratio of hits is just noise. */
const ENOUGH_READS = 1000;

export function derive(previous: Metrics | null, next: Metrics, first: Metrics): Derived {
  const seconds = previous ? next.sampled_at - previous.sampled_at : 0;
  const transactions = previous ? next.transactions - previous.transactions : 0;
  const rollbacks = previous ? next.rollbacks - previous.rollbacks : 0;
  const reads = next.blocks_hit + next.blocks_read;
  return {
    database: next.database,
    connections: next.connections,
    maxConnections: next.max_connections,
    connectionsShare: next.max_connections > 0 ? next.connections / next.max_connections : 0,
    active: next.active,
    idle: next.idle,
    idleInTransaction: next.idle_in_transaction,
    longestActive: next.longest_active_seconds,
    blocked: next.blocked,
    tps: previous && seconds > 0 && transactions >= 0 ? transactions / seconds : null,
    rollbackShare: previous && transactions > 0 && rollbacks >= 0 ? rollbacks / transactions : null,
    cacheHit: reads >= ENOUGH_READS ? (next.blocks_hit / reads) * 100 : null,
    newDeadlocks: Math.max(0, next.deadlocks - first.deadlocks),
    fullView: next.full_view,
  };
}

/** How worried to look. What the user is not allowed to see is "quiet", not "ok", since nothing is known about it. */
export function tone(gauge: Gauge, now: Derived): Tone {
  switch (gauge) {
    case "connections":
      return now.connectionsShare >= 0.95 ? "bad" : now.connectionsShare >= 0.8 ? "warn" : "ok";
    case "cache":
      return now.cacheHit === null ? "quiet" : now.cacheHit < 95 ? "bad" : now.cacheHit < 99 ? "warn" : "ok";
    case "deadlocks":
      return now.newDeadlocks >= 1 ? "warn" : "ok";
    case "longest":
      if (!now.fullView) return "quiet";
      return now.longestActive === null ? "ok" : now.longestActive >= 300 ? "bad" : now.longestActive >= 30 ? "warn" : "ok";
    case "blocked":
      if (!now.fullView) return "quiet";
      return now.blocked >= 5 ? "bad" : now.blocked >= 1 ? "warn" : "ok";
    case "idleInTransaction":
      if (!now.fullView) return "quiet";
      return now.idleInTransaction >= 10 ? "bad" : now.idleInTransaction >= 1 ? "warn" : "ok";
  }
}

export function formatDuration(seconds: number): string {
  if (seconds < 1) return "<1s";
  const whole = Math.floor(seconds);
  if (whole < 60) return `${whole}s`;
  if (whole < 3600) return `${Math.floor(whole / 60)}m ${whole % 60}s`;
  return `${Math.floor(whole / 3600)}h ${Math.floor((whole % 3600) / 60)}m`;
}

export function formatRate(perSecond: number): string {
  if (perSecond === 0) return "0";
  if (perSecond >= 1000) return `${(perSecond / 1000).toFixed(1)}k`;
  return perSecond < 10 ? perSecond.toFixed(1) : String(Math.round(perSecond));
}

export const formatCount = (count: number) => count.toLocaleString("en-US");

/** The newest `cap` values, for the little graphs. The list given is not changed. */
export const pushHistory = (history: number[], value: number, cap: number) => [...history, value].slice(-cap);
