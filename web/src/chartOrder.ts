const STORED = "pgclient.chartOrder";

/** The charts in the order remembered. A chart added since comes last, and one taken away is dropped. */
export function ordered(known: string[], stored: unknown): string[] {
  const kept = Array.isArray(stored) ? stored.filter((id): id is string => typeof id === "string" && known.includes(id)) : [];
  return [...new Set([...kept, ...known])];
}

/** Puts a chart in front of another, as when dropped on it. */
export function moveBefore(order: string[], id: string, target: string): string[] {
  if (id === target || !order.includes(id) || !order.includes(target)) return order;
  const rest = order.filter((one) => one !== id);
  rest.splice(rest.indexOf(target), 0, id);
  return rest;
}

/** Moves a chart `by` places, never past either end. */
export function moveBy(order: string[], id: string, by: number): string[] {
  const from = order.indexOf(id);
  const to = from + by;
  if (from < 0 || to < 0 || to >= order.length) return order;
  const next = order.filter((one) => one !== id);
  next.splice(to, 0, id);
  return next;
}

export function loadOrder(known: string[]): string[] {
  try {
    return ordered(known, JSON.parse(localStorage.getItem(STORED) ?? "null"));
  } catch {
    return known;
  }
}

export function saveOrder(order: string[]) {
  try {
    localStorage.setItem(STORED, JSON.stringify(order));
  } catch {
    // Not remembered, but still in this order until the page closes.
  }
}

/** Puts a chart at a place in the order. */
export function moveTo(order: string[], id: string, place: number): string[] {
  const from = order.indexOf(id);
  const to = Math.min(Math.max(place, 0), order.length - 1);
  if (from < 0 || from === to) return order;
  const next = order.filter((one) => one !== id);
  next.splice(to, 0, id);
  return next;
}

export interface Box {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The chart whose box a point is in, if any. */
export const chartAt = (boxes: Box[], x: number, y: number): string | null =>
  boxes.find((box) => x >= box.left && x < box.left + box.width && y >= box.top && y < box.top + box.height)?.id ?? null;
