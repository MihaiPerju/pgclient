import type { Line } from "./series";

export interface Frame {
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface Scale {
  x: (at: number) => number;
  y: (value: number) => number;
  from: number;
  to: number;
  top: number;
}

/** Where the time and the values go on the plot: the oldest point at the left edge and the newest at the right, and nothing at the bottom with the round number above the highest value at the top. */
export function scaleFor(frame: Frame, times: number[], top: number): Scale {
  const from = times.length ? times[0] : 0;
  const to = times.length > 1 ? times[times.length - 1] : from + 1;
  const plotWidth = frame.width - frame.left - frame.right;
  const plotHeight = frame.height - frame.top - frame.bottom;
  return {
    from,
    to,
    top,
    x: (at) => frame.left + ((at - from) / (to - from)) * plotWidth,
    y: (value) => frame.top + plotHeight - (Math.min(value, top) / top) * plotHeight,
  };
}

/** A line through the points, broken where a value is missing, so a gap is a gap and not a line to nothing. */
export function linePath(times: number[], values: (number | null)[], scale: Scale): string {
  let path = "";
  let pen = false;
  values.forEach((value, index) => {
    if (value === null) {
      pen = false;
      return;
    }
    path += `${pen ? "L" : "M"}${scale.x(times[index]).toFixed(1)},${scale.y(value).toFixed(1)}`;
    pen = true;
  });
  return path;
}

/** The lines stacked on one another: each is as high as everything below it and itself. A gap counts as nothing, so a stack never has a hole in it. */
export function stack(lines: Line[]): (number | null)[][] {
  const count = lines[0]?.values.length ?? 0;
  const running = Array<number>(count).fill(0);
  const known = Array<boolean>(count).fill(false);
  return lines.map((line) =>
    line.values.map((value, index) => {
      if (value !== null) known[index] = true;
      running[index] += value ?? 0;
      return known[index] ? running[index] : null;
    }),
  );
}

/** The band between one stacked line and the one below it, as a shape to fill. Runs of points with a value are bands, and a gap ends one. */
export function bandPath(times: number[], upper: (number | null)[], lower: (number | null)[] | null, scale: Scale): string {
  let path = "";
  let start = 0;
  const close = (end: number) => {
    if (end <= start) return;
    const run = Array.from({ length: end - start }, (_, i) => start + i);
    const top = run.map((i) => `${scale.x(times[i]).toFixed(1)},${scale.y(upper[i]!).toFixed(1)}`);
    const bottom = [...run].reverse().map((i) => `${scale.x(times[i]).toFixed(1)},${scale.y(lower?.[i] ?? 0).toFixed(1)}`);
    path += `M${top.join("L")}L${bottom.join("L")}Z`;
  };
  upper.forEach((value, index) => {
    if (value === null) {
      close(index);
      start = index + 1;
    }
  });
  close(upper.length);
  return path;
}

/** The index of the point nearest in time to where the pointer is, so a reader aims at a moment and not at a thin line. */
export function nearest(times: number[], scale: Scale, x: number): number {
  let best = 0;
  let distance = Infinity;
  times.forEach((at, index) => {
    const away = Math.abs(scale.x(at) - x);
    if (away < distance) {
      distance = away;
      best = index;
    }
  });
  return best;
}

/** Clock times to put under the axis, evenly spaced, as many as fit. */
export function ticks(from: number, to: number, count: number): number[] {
  if (count < 2 || to <= from) return [from];
  return Array.from({ length: count }, (_, i) => from + ((to - from) * i) / (count - 1));
}

/** How a span of seconds is said on the axis: how long ago, since the newest point is now. */
export function ago(seconds: number): string {
  const whole = Math.round(seconds);
  if (whole <= 0) return "now";
  if (whole < 60) return `${whole}s ago`;
  if (whole < 600) return `${Math.floor(whole / 60)}m ${String(whole % 60).padStart(2, "0")}s ago`;
  if (whole < 3600) return `${Math.round(whole / 60)}m ago`;
  return `${(whole / 3600).toFixed(1)}h ago`;
}
