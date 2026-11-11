import { HolderOutlined } from "@ant-design/icons";
import { Flex, Typography } from "antd";
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";

import { chartAt, loadOrder, moveBy, moveTo, saveOrder } from "./chartOrder";
import { Magnified, type Magnify } from "./Magnified";
import { formatDuration, formatRate } from "./metrics";
import { cacheShare, type Point } from "./series";
import { TimeChart, type Series } from "./TimeChart";
import type { MetricsState } from "./useMetrics";

const series = (points: Point[], pick: (point: Point) => number | null) => points.map(pick);
const whole = (value: number) => String(Math.round(value));

/** Everything the top bar has no room for: how the database has been doing over the last half hour, chart by chart. Charts are dragged by their grip into the order wanted, and grown over the window by a pinch. */
export function MetricsPage({ state, database }: { state: MetricsState; database: string }) {
  const { now } = state;
  // The first reading has nothing to take a rate from, so the charts begin at the second and the axis does not start on empty space.
  const points = state.points.length > 1 ? state.points.slice(1) : state.points;
  const times = points.map((point) => point.at);
  const lines = (...rows: [string, string, Series["hue"], (point: Point) => number | null][]): Series[] =>
    rows.map(([key, label, hue, pick]) => ({ key, label, hue, values: series(points, pick) }));
  const max = points.at(-1)?.maxConnections ?? now?.maxConnections ?? 0;

  const charts: Record<string, (handle: ReactNode, magnify: Magnify) => ReactNode> = {
    transactions: (handle, magnify) => (
      <TimeChart
        title="Transactions per second"
        caption="in this database"
        kind="line"
        times={times}
        format={formatRate}
        handle={handle}
        magnify={magnify}
        series={lines(
          ["commits", "Commits", "blue", (point) => point.commits],
          ["rollbacks", "Rollbacks", "orange", (point) => point.rollbacks],
        )}
        extra={(index) => {
          const commits = points[index].commits;
          const rolled = points[index].rollbacks;
          return commits === null || rolled === null || commits + rolled === 0 ? null : `${((rolled / (commits + rolled)) * 100).toFixed(1)}% rolled back`;
        }}
      />
    ),
    connections: (handle, magnify) => (
      <TimeChart
        title="Connections"
        caption="by what they are doing"
        kind="line"
        times={times}
        format={whole}
        handle={handle}
        magnify={magnify}
        limit={max > 0 ? { value: max, label: `${max} allowed` } : undefined}
        series={lines(
          ["active", "Active", "blue", (point) => point.active],
          ["idleInTransaction", "Idle in transaction", "orange", (point) => point.idleInTransaction],
          ["idle", "Idle", "aqua", (point) => point.idle],
        )}
      />
    ),
    longestTransaction: (handle, magnify) => (
      <TimeChart
        title="Longest open transaction"
        caption="how long the oldest has been open, running or idle"
        kind="line"
        times={times}
        format={formatDuration}
        handle={handle}
        magnify={magnify}
        series={lines(["longestTransaction", "Open for", "orange", (point) => point.longestTransaction])}
      />
    ),
    tuplesIn: (handle, magnify) => (
      <TimeChart
        title="Tuples in"
        caption="rows written a second"
        kind="line"
        times={times}
        format={formatRate}
        handle={handle}
        magnify={magnify}
        series={lines(
          ["inserted", "Inserted", "blue", (point) => point.inserted],
          ["updated", "Updated", "orange", (point) => point.updated],
          ["deleted", "Deleted", "aqua", (point) => point.deleted],
        )}
      />
    ),
    tuplesOut: (handle, magnify) => (
      <TimeChart
        title="Tuples out"
        caption="rows read a second"
        kind="line"
        times={times}
        format={formatRate}
        handle={handle}
        magnify={magnify}
        series={lines(
          ["returned", "Returned", "blue", (point) => point.returned],
          ["fetched", "Fetched", "orange", (point) => point.fetched],
        )}
      />
    ),
    wal: (handle, magnify) => (
      <TimeChart
        title="WAL records"
        caption="written to the log a second, by the whole server"
        kind="line"
        times={times}
        format={formatRate}
        handle={handle}
        magnify={magnify}
        series={lines(["walRecords", "Records", "blue", (point) => point.walRecords])}
      />
    ),
    blocks: (handle, magnify) => (
      <TimeChart
        title="Block I/O"
        caption="blocks a second"
        kind="line"
        times={times}
        format={formatRate}
        handle={handle}
        magnify={magnify}
        series={lines(
          ["blocksHit", "Found in memory", "blue", (point) => point.blocksHit],
          ["blocksRead", "Read from disk", "orange", (point) => point.blocksRead],
        )}
        extra={(index) => {
          const share = cacheShare(points[index]);
          return share === null ? null : `${share.toFixed(1)}% found in memory`;
        }}
      />
    ),
  };
  const titles: Record<string, string> = { transactions: "Transactions per second", connections: "Connections", longestTransaction: "Longest open transaction", tuplesIn: "Tuples in", tuplesOut: "Tuples out", wal: "WAL records", blocks: "Block I/O" };

  const [order, setOrder] = useState(() => loadOrder(Object.keys(charts)));
  const [dragged, setDragged] = useState<string | null>(null);
  const tiles = useRef(new Map<string, HTMLDivElement>());
  // Where each chart sat in the grid at the last draw, so the ones that were moved can glide from there to where they are now.
  const before = useRef(new Map<string, { x: number; y: number }>());
  // The chart being dragged, the pointer, and where in the chart it took hold.
  const drag = useRef<{ id: string; x: number; y: number; grabX: number; grabY: number; lastMove: number } | null>(null);
  const place = (next: string[]) => {
    setOrder(next);
    saveOrder(next);
  };

  /** Keeps the dragged chart under the pointer, wherever the grid has put its place. */
  function follow() {
    const now = drag.current;
    const tile = now && tiles.current.get(now.id);
    if (!now || !tile) return;
    tile.style.transform = "";
    const home = tile.getBoundingClientRect();
    tile.style.transform = `translate(${now.x - now.grabX - home.left}px, ${now.y - now.grabY - home.top}px)`;
  }

  useLayoutEffect(() => {
    for (const [id, tile] of tiles.current) {
      const was = before.current.get(id);
      const at = { x: tile.offsetLeft, y: tile.offsetTop };
      before.current.set(id, at);
      if (id === drag.current?.id || !was || (was.x === at.x && was.y === at.y)) continue;
      tile.style.transition = "none";
      tile.style.transform = `translate(${was.x - at.x}px, ${was.y - at.y}px)`;
      void tile.offsetWidth;
      tile.style.transition = "transform 200ms ease";
      tile.style.transform = "";
    }
    follow();
  }, [order]);

  function startDrag(event: PointerEvent<HTMLButtonElement>, id: string) {
    const tile = tiles.current.get(id);
    if (event.button !== 0 || !tile) return;
    const own = tile.getBoundingClientRect();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { id, x: event.clientX, y: event.clientY, grabX: event.clientX - own.left, grabY: event.clientY - own.top, lastMove: 0 };
    tile.style.transition = "none";
    setDragged(id);
  }

  function dragTo(event: PointerEvent<HTMLButtonElement>) {
    const now = drag.current;
    if (!now) return;
    now.x = event.clientX;
    now.y = event.clientY;
    follow();
    // Charts that are still gliding are not read for a moment, or the one dragged over would be swapped back and forth.
    if (performance.now() - now.lastMove < 220) return;
    const boxes = order.filter((id) => id !== now.id).map((id) => {
      const rect = tiles.current.get(id)!.getBoundingClientRect();
      return { id, left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    });
    const over = chartAt(boxes, now.x, now.y);
    if (over === null) return;
    now.lastMove = performance.now();
    place(moveTo(order, now.id, order.indexOf(over)));
  }

  function endDrag() {
    const now = drag.current;
    if (!now) return;
    drag.current = null;
    const tile = tiles.current.get(now.id);
    if (tile) {
      tile.style.transition = "transform 200ms ease";
      tile.style.transform = "";
    }
    setDragged(null);
  }

  function grip(id: string) {
    const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
      const by = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : 0;
      if (by === 0) return;
      event.preventDefault();
      place(moveBy(order, id, by));
    };
    return (
      <button
        type="button"
        className="pg-link"
        aria-label={`Move ${titles[id]}`}
        title="Drag to move, or use the arrow keys"
        style={{ cursor: dragged === id ? "grabbing" : "grab", padding: 0, display: "inline-flex", alignItems: "center", touchAction: "none" }}
        onKeyDown={onKeyDown}
        onPointerDown={(event) => startDrag(event, id)}
        onPointerMove={dragTo}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <HolderOutlined aria-hidden />
      </button>
    );
  }

  return (
    <Flex vertical gap={12} role="region" aria-label={`Metrics of ${database}`} style={{ padding: "14px 16px", overflow: "auto", height: "100%" }}>
      {points.length === 0 && state.error === null && <Typography.Text type="secondary">Looking at the database…</Typography.Text>}
      {state.error !== null && points.length === 0 && <Typography.Text type="danger">{state.error}</Typography.Text>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", gap: 12 }}>
        {order.map((id) => (
          <div
            key={id}
            data-chart={id}
            ref={(tile) => void (tile ? tiles.current.set(id, tile) : tiles.current.delete(id))}
            style={{ position: "relative", minWidth: 0, ...(dragged === id ? { zIndex: 5, boxShadow: "0 12px 32px rgba(0, 0, 0, 0.35)", borderRadius: 8, userSelect: "none" } : {}) }}
          >
            <Magnified label={titles[id]}>
              {(magnify) => (
                <div style={magnify.lifted ? { padding: 16, height: "100%", overflow: "auto" } : undefined}>
                  {charts[id](grip(id), magnify)}
                </div>
              )}
            </Magnified>
          </div>
        ))}
      </div>
      {now && !now.fullView && (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Limited view: this user can only see its own sessions, so the connection counts leave out other people's.
        </Typography.Text>
      )}
    </Flex>
  );
}
