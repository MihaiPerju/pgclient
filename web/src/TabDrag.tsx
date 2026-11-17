import { theme } from "antd";
import { createContext, useContext, useEffect, useRef, useState, type MutableRefObject, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

import { ASIDE_SHARE, dropAt, insertionX, startsDrag, type Box, type PaneBoxes, type Point } from "./tabDrop";
import type { Drop } from "./tabs";

/** How long after a drag ends the click that follows it is still taken for part of it. */
const CLICK_AFTER_DRAG_MS = 100;

const boxOf = (element: Element): Box => {
  const { left, top, right, bottom } = element.getBoundingClientRect();
  return { left, top, right, bottom };
};

/** What each pane takes up on the screen now, in the order of the panes: the pane, the strip of tabs along its top, and each tab in it. */
export function measurePanes(): PaneBoxes[] {
  const panes = [...document.querySelectorAll<HTMLElement>("[data-column]")].sort((a, b) => Number(a.dataset.column) - Number(b.dataset.column));
  return panes.map((pane) => ({
    pane: boxOf(pane),
    strip: boxOf(pane.querySelector("[data-tabstrip]") ?? pane),
    tabs: [...pane.querySelectorAll("[data-tab]")].map(boxOf),
  }));
}

/** What the screen shows while a tab is being dragged. */
interface Dragging {
  id: string;
  label: string;
  point: Point;
  drop: Drop | null;
  boxes: PaneBoxes[];
}

interface Held {
  id: string;
  pane: number;
  pointerId: number;
  start: Point;
  dragging: boolean;
  last: Dragging | null;
}

interface Latest {
  onDrop: (id: string, drop: Drop) => void;
  labelOf: (id: string) => string;
}

/** Follows a tab from the press to where it is let go, across every pane, on the window and not on the tab, which is not under the pointer for long. */
function createSession(show: (state: Dragging | null) => void, latest: MutableRefObject<Latest>, swallow: MutableRefObject<boolean>) {
  let held: Held | null = null;
  let timer: number | undefined;

  function end() {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", cancel);
    window.removeEventListener("keydown", key);
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
    held = null;
    show(null);
  }

  function move(event: PointerEvent) {
    if (!held || event.pointerId !== held.pointerId) return;
    const point = { x: event.clientX, y: event.clientY };
    if (!held.dragging) {
      if (!startsDrag(held.start, point)) return;
      held.dragging = true;
      document.body.style.userSelect = "none";
      document.body.style.cursor = "grabbing";
    }
    const boxes = measurePanes();
    held.last = { id: held.id, label: latest.current.labelOf(held.id), point, drop: dropAt(point, boxes, held.pane), boxes };
    show(held.last);
  }

  function up(event: PointerEvent) {
    if (!held || event.pointerId !== held.pointerId) return;
    const { id, dragging, last } = held;
    end();
    if (!dragging) return;
    swallow.current = true;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => (swallow.current = false), CLICK_AFTER_DRAG_MS);
    if (last?.drop) latest.current.onDrop(id, last.drop);
  }

  function cancel(event: PointerEvent) {
    if (held && event.pointerId === held.pointerId) end();
  }

  function key(event: KeyboardEvent) {
    if (event.key === "Escape") end();
  }

  return {
    press(id: string, pane: number, event: ReactPointerEvent) {
      if (event.button !== 0 || held || (event.target as Element).closest("button")) return;
      held = { id, pane, pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, dragging: false, last: null };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", cancel);
      window.addEventListener("keydown", key);
    },
    stop: () => end(),
  };
}

interface TabDragApi {
  press: (id: string, pane: number, event: ReactPointerEvent) => void;
  /** The tab being dragged, if one is. */
  draggingId: string | null;
  /** Whether a click is the end of a drag, which is then not a click on the tab. Says so once. */
  swallowClick: () => boolean;
  nudge: (id: string, step: 1 | -1) => void;
}

const TabDragContext = createContext<TabDragApi | null>(null);

/** What a tab bar needs to be dragged from: nothing, where there is no provider above it. */
export const useTabDrag = () => useContext(TabDragContext);

interface Props {
  labelOf: (id: string) => string;
  /** Asked when a tab is let go somewhere it can go. */
  onDrop: (id: string, drop: Drop) => void;
  /** Asked when a tab is moved a place along its pane with the keyboard. */
  onNudge: (id: string, step: 1 | -1) => void;
  children: ReactNode;
}

/** Lets the tabs inside be dragged between the panes, and draws what a drag shows: the tab that is held, the gap it would go in, and the edge it would open a pane at. */
export function TabDragProvider({ labelOf, onDrop, onNudge, children }: Props) {
  const { token } = theme.useToken();
  const [drag, setDrag] = useState<Dragging | null>(null);
  const latest = useRef<Latest>({ onDrop, labelOf });
  latest.current = { onDrop, labelOf };
  const swallow = useRef(false);
  const session = useRef<ReturnType<typeof createSession> | null>(null);
  session.current ??= createSession(setDrag, latest, swallow);
  useEffect(() => () => session.current?.stop(), []);

  const api: TabDragApi = {
    press: (id, pane, event) => session.current!.press(id, pane, event),
    draggingId: drag?.id ?? null,
    swallowClick: () => {
      const was = swallow.current;
      swallow.current = false;
      return was;
    },
    nudge: onNudge,
  };

  const drop = drag?.drop ?? null;
  const target = drop && drag ? drag.boxes[drop.kind === "between" ? drop.pane : 0] : null;
  return (
    <TabDragContext.Provider value={api}>
      {children}
      {drag && (
        <div
          aria-hidden
          data-testid="tab-ghost"
          style={{
            position: "fixed",
            left: drag.point.x,
            top: drag.point.y,
            transform: "translate(10px, 10px)",
            pointerEvents: "none",
            zIndex: 1100,
            padding: "4px 12px",
            borderRadius: 6,
            background: token.colorBgElevated,
            border: `1px solid ${token.colorPrimary}`,
            boxShadow: token.boxShadowSecondary,
            color: token.colorText,
            fontSize: 13,
            whiteSpace: "nowrap",
          }}
        >
          {drag.label}
        </div>
      )}
      {drop?.kind === "between" && target && (
        <div
          aria-hidden
          data-testid="tab-drop-line"
          style={{
            position: "fixed",
            left: insertionX(target, drop.at),
            top: target.strip.top + 4,
            width: 2,
            height: target.strip.bottom - target.strip.top - 8,
            transform: "translateX(-1px)",
            borderRadius: 1,
            background: token.colorPrimary,
            pointerEvents: "none",
            zIndex: 1100,
          }}
        />
      )}
      {drop?.kind === "aside" && target && (
        <div
          aria-hidden
          data-testid="tab-aside-zone"
          style={{
            position: "fixed",
            left: target.pane.left + (target.pane.right - target.pane.left) * (1 - ASIDE_SHARE),
            top: target.strip.bottom,
            right: window.innerWidth - target.pane.right,
            bottom: window.innerHeight - target.pane.bottom,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: `2px dashed ${token.colorPrimary}`,
            background: token.colorPrimaryBg,
            color: token.colorPrimary,
            opacity: 0.9,
            pointerEvents: "none",
            zIndex: 1050,
          }}
        >
          Open beside
        </div>
      )}
    </TabDragContext.Provider>
  );
}
