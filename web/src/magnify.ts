import { useEffect, useReducer, useRef, useState, type CSSProperties, type RefObject } from "react";
import { flushSync } from "react-dom";

/** Pinched below `least` it goes back, spread past `full` it fills the window, and the fingers spread `range` for the whole way. */
export const HOLD = { least: 0.1, full: 0.92, range: 0.8 };
const MOTION_MS = 220;
/** How far from the window's edges the surface stops when full. */
const INSET = 24;
/** How long after the last ctrl-wheel step a pinch counts as stopped. */
const WHEEL_END_MS = 180;

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const clamp = (value: number) => Math.min(1, Math.max(0, value));

export const between = (from: Rect, to: Rect, at: number): Rect => ({
  left: from.left + (to.left - from.left) * at,
  top: from.top + (to.top - from.top) * at,
  width: from.width + (to.width - from.width) * at,
  height: from.height + (to.height - from.height) * at,
});

/** How far a pinch that began at `start` has grown the surface, from its own place (0) to the window (1). */
export const levelAt = (start: number, scale: number) => clamp(start + (scale - 1) / HOLD.range);

/** Where a pinch settles once the fingers stop: back when barely grown, the whole window when nearly so, else where it was left. */
export const settleLevel = (level: number) => (level < HOLD.least ? 0 : level > HOLD.full ? 1 : level);

/** A surface enlarged over the window, as in the metrics app: a pinch grows it from its place as the fingers spread, it stays the size it is left at, and Esc or the backdrop puts it back. */
export function useMagnify(place: RefObject<HTMLElement | null>) {
  const [lifted, setLifted] = useState(false);
  const [level, setLevel] = useState(0);
  // While following the fingers it moves with them, not after them.
  const [following, setFollowing] = useState(false);
  const [, redraw] = useReducer((count: number) => count + 1, 0);
  const now = useRef({ lifted: false, level: 0 });
  const pinch = useRef<{ start: number } | null>(null);
  const putting = useRef<number | undefined>(undefined);

  const moveTo = (next: number) => {
    now.current.level = next;
    setLevel(next);
  };

  /** Lifts the surface off the layout exactly where it is, so growing starts from there. */
  function lift() {
    window.clearTimeout(putting.current);
    if (now.current.lifted) return;
    now.current.lifted = true;
    flushSync(() => {
      setFollowing(true);
      moveTo(0);
      setLifted(true);
    });
    void place.current?.offsetWidth;
  }

  function open() {
    lift();
    setFollowing(false);
    moveTo(1);
  }

  function close() {
    if (!now.current.lifted) return;
    pinch.current = null;
    setFollowing(false);
    moveTo(0);
    window.clearTimeout(putting.current);
    putting.current = window.setTimeout(() => {
      now.current.lifted = false;
      setLifted(false);
    }, MOTION_MS + 20);
  }

  const handlers = useRef({ lift, close });
  handlers.current = { lift, close };

  useEffect(() => {
    const inside = (target: EventTarget | null) => target instanceof Node && !!place.current?.contains(target);
    const start = () => {
      if (pinch.current) return;
      const from = now.current.lifted ? now.current.level : 0;
      handlers.current.lift();
      pinch.current = { start: from };
      setFollowing(true);
    };
    const move = (scale: number) => pinch.current && moveTo(levelAt(pinch.current.start, scale));
    const end = () => {
      if (!pinch.current) return;
      pinch.current = null;
      setFollowing(false);
      const to = settleLevel(now.current.level);
      if (to === 0) handlers.current.close();
      else moveTo(to);
    };

    // Safari's webview, which Tauri uses on macOS, sends a pinch as gesture events.
    const gesture = (event: Event) => {
      if (event.type === "gesturestart" ? !inside(event.target) : !pinch.current) return;
      event.preventDefault();
      if (event.type === "gesturestart") start();
      else if (event.type === "gesturechange") move((event as Event & { scale: number }).scale);
      else end();
    };
    // Other browsers send it as a wheel with the control key down.
    let wheelScale = 1;
    let wheelEnd: number | undefined;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey || (!pinch.current && !inside(event.target))) return;
      event.preventDefault();
      if (!pinch.current) {
        wheelScale = 1;
        start();
      }
      wheelScale *= Math.exp(-event.deltaY * 0.012);
      move(wheelScale);
      window.clearTimeout(wheelEnd);
      wheelEnd = window.setTimeout(end, WHEEL_END_MS);
    };
    // Escape puts it back, unless it was typed in a field or already used, as to stop editing a cell.
    const key = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLElement && (event.target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName));
      if (event.key === "Escape" && now.current.lifted && !typing && !event.defaultPrevented) handlers.current.close();
    };

    const gestures = ["gesturestart", "gesturechange", "gestureend"];
    for (const name of gestures) document.addEventListener(name, gesture);
    document.addEventListener("wheel", wheel, { passive: false });
    window.addEventListener("keydown", key);
    window.addEventListener("resize", redraw);
    return () => {
      for (const name of gestures) document.removeEventListener(name, gesture);
      document.removeEventListener("wheel", wheel);
      window.removeEventListener("keydown", key);
      window.removeEventListener("resize", redraw);
      window.clearTimeout(wheelEnd);
      window.clearTimeout(putting.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const still = following || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const transition = (...properties: string[]) => (still ? "none" : properties.map((property) => `${property} ${MOTION_MS}ms ease`).join(", "));

  let rect: Rect | null = null;
  if (lifted && place.current) {
    const own = place.current.getBoundingClientRect();
    const full = { left: INSET, top: INSET, width: window.innerWidth - INSET * 2, height: window.innerHeight - INSET * 2 };
    rect = between({ left: own.left, top: own.top, width: own.width, height: own.height }, full, level);
  }

  // Beneath the dialogs and menus opened from what is in it, which start at 1000.
  const surface: CSSProperties | null = rect && { position: "fixed", ...rect, zIndex: 991, transition: transition("left", "top", "width", "height") };
  const backdrop: CSSProperties = { position: "fixed", inset: 0, zIndex: 990, opacity: level, transition: transition("opacity") };

  return { lifted, full: lifted && level === 1, open, close, surface, backdrop };
}
