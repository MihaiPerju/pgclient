import type { Drop } from "./tabs";

export interface Point {
  x: number;
  y: number;
}

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** What a pane takes up on screen, as measured: all of it, the strip of tabs along its top, and each tab in the strip, left to right. */
export interface PaneBoxes {
  pane: Box;
  strip: Box;
  tabs: Box[];
}

/** How far a press must move before it is a drag and not a click. */
export const DRAG_DISTANCE = 5;

/** How much of a lone pane, at its right edge, is where a tab is let go to open a pane of its own. */
export const ASIDE_SHARE = 0.25;

export const startsDrag = (from: Point, to: Point): boolean => Math.hypot(to.x - from.x, to.y - from.y) >= DRAG_DISTANCE;

const within = (point: Point, box: Box) => point.x >= box.left && point.x <= box.right && point.y >= box.top && point.y <= box.bottom;

/** What letting go of a dragged tab at a point would do: among a pane's tabs, off to the side, or nothing. `from` is the pane the tab came from. */
export function dropAt(point: Point, panes: PaneBoxes[], from: number): Drop | null {
  const found = panes.findIndex((one) => within(point, one.pane));
  if (found < 0) return null;
  const { strip, tabs, pane } = panes[found];
  if (within(point, strip)) {
    const at = tabs.filter((tab) => (tab.left + tab.right) / 2 < point.x).length;
    return { kind: "between", pane: found, at };
  }
  if (found !== from) return { kind: "between", pane: found, at: tabs.length };
  const lone = panes.length === 1;
  return lone && point.x > pane.left + (pane.right - pane.left) * (1 - ASIDE_SHARE) ? { kind: "aside" } : null;
}

/** The column the line that shows a gap is drawn at: the left edge of the tab after it, or the right edge of the last tab. */
export function insertionX({ strip, tabs }: PaneBoxes, at: number): number {
  if (tabs.length === 0) return strip.left;
  if (at <= 0) return tabs[0].left;
  return at >= tabs.length ? tabs[tabs.length - 1].right : tabs[at].left;
}
