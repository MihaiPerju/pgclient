import { useEffect, useState } from "react";

import type { Gateway, Metrics } from "./gateway";
import { derive, pushHistory, type Derived } from "./metrics";
import { keep, point, type Point } from "./series";

/** Often enough to see a problem start, and seldom enough that watching a database is not itself work for it. */
export const INTERVAL_MS = 5000;
const HISTORY = 30;

export interface MetricsState {
  now: Derived | null;
  history: { connections: number[]; tps: number[] };
  /** Every sample since watching began, up to about half an hour, for the page of charts. */
  points: Point[];
  /** What went wrong with the latest look, while what was last known is still shown. */
  error: string | null;
}

const nothing: MetricsState = { now: null, history: { connections: [], tps: [] }, points: [], error: null };

/** Watches the database that is chosen: looks at once, then every few seconds, but not while the window is hidden. */
export function useMetrics(gateway: Gateway, serverId: string | null, database: string | null): MetricsState {
  const [state, setState] = useState<MetricsState>(nothing);

  useEffect(() => {
    setState(nothing);
    if (serverId === null || database === null) return;
    let current = true;
    let busy = false;
    let previous: Metrics | null = null;
    let first: Metrics | null = null;

    async function look() {
      // A slow look is waited for, and a hidden window is not worth looking for.
      if (busy || document.hidden) return;
      busy = true;
      try {
        const next = await gateway.metrics(serverId!, database!);
        if (!current) return;
        first ??= next;
        const now = derive(previous, next, first);
        const before_ = previous;
        previous = next;
        const taken = point(before_, next);
        setState((before) => ({
          now,
          error: null,
          points: keep(before.points, taken),
          history: {
            connections: pushHistory(before.history.connections, now.connections, HISTORY),
            tps: now.tps === null ? before.history.tps : pushHistory(before.history.tps, now.tps, HISTORY),
          },
        }));
      } catch (failure) {
        if (current) setState((before) => ({ ...before, error: String(failure) }));
      } finally {
        busy = false;
      }
    }

    void look();
    const timer = setInterval(look, INTERVAL_MS);
    const comeBack = () => {
      if (!document.hidden) void look();
    };
    document.addEventListener("visibilitychange", comeBack);
    return () => {
      current = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", comeBack);
    };
  }, [gateway, serverId, database]);

  return state;
}
