import { useCallback, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

const STEP = 16;
const BIG_STEP = 64;

/** The size a person dragged a pane to, kept for next time. Null means they have not, and the pane keeps its default. */
export function usePaneSize(key: string) {
  const [size, setState] = useState<number | null>(() => {
    const stored = Number(localStorage.getItem(key));
    return Number.isFinite(stored) && stored > 0 ? stored : null;
  });
  const setSize = useCallback(
    (pixels: number) => {
      const rounded = Math.round(pixels);
      localStorage.setItem(key, String(rounded));
      setState(rounded);
    },
    [key],
  );
  const reset = useCallback(() => {
    localStorage.removeItem(key);
    setState(null);
  }, [key]);
  return { size, setSize, reset };
}

interface Props {
  /** The way the line itself runs: a vertical line is dragged left and right, a horizontal one up and down. */
  orientation: "vertical" | "horizontal";
  label: string;
  /** How big the pane before the line is now, in pixels. */
  size: () => number;
  min: number;
  /** Asked when a drag starts, since the window can have changed size since the last one. */
  max: () => number;
  onResize: (pixels: number) => void;
  onReset?: () => void;
  /** Replaces the look of a line between two panes, for a handle that is something else, such as the edge of a column. */
  className?: string;
  /** Left out of the tab order where there would be dozens of them, such as one to a column. */
  focusable?: boolean;
  /** The pane sized is the one after the line, such as a panel on the right, so it grows as the line moves back. */
  after?: boolean;
}

interface Drag {
  from: number;
  startSize: number;
  max: number;
}

/** The line between two panes. It can be dragged, moved with the arrow keys, and double-clicked to put it back. */
export function ResizeHandle({ orientation, label, size, min, max, onResize, onReset, className, focusable = true, after = false }: Props) {
  const drag = useRef<Drag | null>(null);
  const [active, setActive] = useState(false);
  const across = orientation === "vertical";
  const position = (event: { clientX: number; clientY: number }) => (across ? event.clientX : event.clientY);
  const clamp = (pixels: number, largest: number) => Math.min(largest, Math.max(min, pixels));

  function start(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { from: position(event), startSize: size(), max: max() };
    document.body.style.userSelect = "none";
    setActive(true);
  }

  function move(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    const { from, startSize, max: largest } = drag.current;
    onResize(clamp(startSize + (position(event) - from) * (after ? -1 : 1), largest));
  }

  function end() {
    if (!drag.current) return;
    drag.current = null;
    document.body.style.userSelect = "";
    setActive(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const forward = across ? "ArrowRight" : "ArrowDown";
    const back = across ? "ArrowLeft" : "ArrowUp";
    const [grow, shrink] = after ? [back, forward] : [forward, back];
    const step = event.shiftKey ? BIG_STEP : STEP;
    const largest = max();
    const next = event.key === grow ? size() + step : event.key === shrink ? size() - step : event.key === "Home" ? min : event.key === "End" ? largest : null;
    if (next === null) return;
    event.preventDefault();
    onResize(clamp(next, largest));
  }

  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation={orientation}
      aria-valuenow={Math.round(size())}
      aria-valuemin={min}
      aria-valuemax={Math.round(max())}
      tabIndex={focusable ? 0 : -1}
      data-active={active}
      className={className ?? `pg-handle pg-handle-${orientation}`}
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={onKeyDown}
      onDoubleClick={onReset}
      // A drag ends in a click on the handle, which must not reach what is under it, such as the header it sits in.
      onClick={(event) => event.stopPropagation()}
    />
  );
}

export interface Box {
  width: number;
  height: number;
}

/** The width and height a person dragged a box to, kept for next time. Null means they have not, and the box keeps its default. */
export function useBoxSize(key: string) {
  const [box, setState] = useState<Box | null>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(key) ?? "null");
      return Number.isFinite(stored?.width) && Number.isFinite(stored?.height) ? { width: stored.width, height: stored.height } : null;
    } catch {
      return null;
    }
  });
  const setBox = useCallback(
    (next: Box) => {
      const rounded = { width: Math.round(next.width), height: Math.round(next.height) };
      localStorage.setItem(key, JSON.stringify(rounded));
      setState(rounded);
    },
    [key],
  );
  const reset = useCallback(() => {
    localStorage.removeItem(key);
    setState(null);
  }, [key]);
  return { box, setBox, reset };
}

interface GripProps {
  label: string;
  /** How big the box is now. */
  size: () => Box;
  min: Box;
  /** Asked when a drag starts, since the window can have changed size since the last one. */
  max: () => Box;
  onResize: (size: Box) => void;
  onReset?: () => void;
  /** How much wider the box gets for each pixel the pointer moves sideways: two for a pop-up centred on the page, whose edge then keeps up with the pointer. */
  widthPerPixel?: number;
}

/** A handle in the corner of a box that is dragged to change both its width and its height, or moved with the arrow keys, and double-clicked to put back. */
export function CornerGrip({ label, size, min, max, onResize, onReset, widthPerPixel = 1 }: GripProps) {
  const drag = useRef<{ x: number; y: number; start: Box; max: Box } | null>(null);
  const [active, setActive] = useState(false);
  const clamp = (box: Box, largest: Box): Box => ({ width: Math.min(largest.width, Math.max(min.width, box.width)), height: Math.min(largest.height, Math.max(min.height, box.height)) });

  function start(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, start: size(), max: max() };
    document.body.style.userSelect = "none";
    setActive(true);
  }

  function move(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    const { x, y, start: from, max: largest } = drag.current;
    onResize(clamp({ width: from.width + (event.clientX - x) * widthPerPixel, height: from.height + event.clientY - y }, largest));
  }

  function end() {
    if (!drag.current) return;
    drag.current = null;
    document.body.style.userSelect = "";
    setActive(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? BIG_STEP : STEP;
    const now = size();
    const next: Box | null =
      event.key === "ArrowRight" ? { ...now, width: now.width + step * widthPerPixel }
      : event.key === "ArrowLeft" ? { ...now, width: now.width - step * widthPerPixel }
      : event.key === "ArrowDown" ? { ...now, height: now.height + step }
      : event.key === "ArrowUp" ? { ...now, height: now.height - step }
      : null;
    if (next === null) return;
    event.preventDefault();
    onResize(clamp(next, max()));
  }

  return (
    <div
      role="separator"
      aria-label={label}
      tabIndex={0}
      data-active={active}
      className="pg-grip-corner"
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={onKeyDown}
      onDoubleClick={onReset}
      onClick={(event) => event.stopPropagation()}
    />
  );
}
