import type { Cell } from "./gateway";
import { pairing, type Relation } from "./related";

export const NODE_WIDTH = 220;
/** The height of a card's header, its padding and borders, and of each field it shows, so a card's size is known without measuring it. */
export const CARD_CHROME = 37;
export const FIELD_HEIGHT = 18;
const COLUMN_GAP = 96;
const ROW_GAP = 16;

export const cardHeight = (fields: number) => CARD_CHROME + fields * FIELD_HEIGHT;

/** A row of a table, drawn as a card. Rows reached twice are one card, told apart by their table and every value. */
export interface GraphNode {
  id: string;
  schema: string;
  table: string;
  columns: string[];
  row: Cell[];
  /** How many links from the rows the graph started with, which is the column it is drawn in. */
  depth: number;
  /** The links, by `relationKey`, whose rows have been read and drawn. */
  opened: string[];
  /** The node whose opening drew it, and by which link; the rows the graph started with have neither. */
  parent?: string;
  via?: string;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  /** The link it was drawn for, by `relationKey`. */
  via: string;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** What of a result a graph starts from: the indexes of its rows and the names of its columns, null for all of them. */
export interface Projection {
  rows: number[] | null;
  columns: string[] | null;
}

/** The rows found by following one relation from a node. */
export interface Found {
  relation: Relation;
  columns: string[];
  rows: Cell[][];
}

export const nodeId = (schema: string, table: string, row: Cell[]) => `${schema}.${table}\u0000${JSON.stringify(row)}`;

/** Tells a table's links apart, two to the same table by different columns included. */
export const relationKey = (relation: Relation) => `${relation.direction} ${relation.schema}.${relation.table} ${relation.from.join(",")}:${relation.to.join(",")}`;

/** The rows of a result, one under another, as the first column of the graph. */
export function startGraph(schema: string, table: string, columns: string[], rows: Cell[][]): Graph {
  const nodes: GraphNode[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const id = nodeId(schema, table, row);
    if (seen.has(id)) continue;
    seen.add(id);
    nodes.push({ id, schema, table, columns, row, depth: 0, opened: [] });
  }
  return { nodes, edges: [] };
}

/** Adds what a node links to, in the column after it. A row already in the graph is not added again, only linked to. */
export function addRelated(graph: Graph, fromId: string, found: Found[]): Graph {
  const parent = graph.nodes.find((node) => node.id === fromId);
  if (!parent) return graph;
  const keys = found.map(({ relation }) => relationKey(relation));
  const nodes = graph.nodes.map((node) => (node.id === fromId ? { ...node, opened: [...new Set([...node.opened, ...keys])] } : node));
  const edges = [...graph.edges];
  const known = new Set(nodes.map((node) => node.id));
  const edgeIds = new Set(edges.map((edge) => edge.id));
  const depth = parent.depth + 1;
  for (const { relation, columns, rows } of found) {
    const label = pairing(relation, parent.columns);
    const via = relationKey(relation);
    for (const row of rows) {
      const id = nodeId(relation.schema, relation.table, row);
      if (!known.has(id)) {
        known.add(id);
        nodes.push({ id, schema: relation.schema, table: relation.table, columns, row, depth, opened: [], parent: fromId, via });
      }
      const edgeId = `${fromId}\u0001${id}\u0001${via}`;
      if (edgeIds.has(edgeId)) continue;
      edgeIds.add(edgeId);
      edges.push({ id: edgeId, from: fromId, to: id, label, via });
    }
  }
  return { nodes, edges };
}

/** Takes back what opening a node's link drew, or all its links when none is named: the nodes it drew, what they drew in turn, and their edges.
 * Nodes it only linked to stay. */
export function collapse(graph: Graph, id: string, key?: string): Graph {
  const drawnHere = (node: GraphNode | GraphEdge) => (key === undefined || node.via === key);
  const gone = new Set<string>();
  let found = true;
  while (found) {
    found = false;
    for (const node of graph.nodes) {
      if (node.parent && !gone.has(node.id) && ((node.parent === id && drawnHere(node)) || gone.has(node.parent))) {
        gone.add(node.id);
        found = true;
      }
    }
  }
  return {
    nodes: graph.nodes.filter((node) => !gone.has(node.id)).map((node) => (node.id === id ? { ...node, opened: key === undefined ? [] : node.opened.filter((one) => one !== key) } : node)),
    edges: graph.edges.filter((edge) => !(edge.from === id && drawnHere(edge)) && !gone.has(edge.from) && !gone.has(edge.to)),
  };
}

/** Where a card is drawn. */
export interface Box {
  x: number;
  y: number;
  height: number;
}

/** Places the cards in the order they were added: each in the column of its depth, level with the card it was opened from and below whatever is
 * already in that column. Placed afresh from the cards' heights, so a card that grows pushes down those under it.
 * A card dragged somewhere (`placed`) is drawn there but keeps its place in its column, so nothing around it moves, and what was opened from it is
 * drawn beside it, wherever it went. */
export function layout(graph: Graph, heightOf: (node: GraphNode) => number, placed: ReadonlyMap<string, { x: number; y: number }> = new Map()): Map<string, Box> {
  const boxes = new Map<string, Box>();
  const bottoms: number[] = [];
  // Cards drawn off the columns, and where the next card opened from each goes.
  const loose = new Set<string>();
  const beside = new Map<string, number>();
  for (const node of graph.nodes) {
    const height = heightOf(node);
    const parent = node.parent ? boxes.get(node.parent) : undefined;
    const own = placed.get(node.id);
    if (parent && node.parent && loose.has(node.parent)) {
      const y = Math.max(parent.y, beside.get(node.parent) ?? parent.y);
      beside.set(node.parent, y + height + ROW_GAP);
      boxes.set(node.id, { x: own?.x ?? parent.x + NODE_WIDTH + COLUMN_GAP, y: own?.y ?? y, height });
      loose.add(node.id);
      continue;
    }
    const y = Math.max(parent?.y ?? 0, bottoms[node.depth] ?? 0);
    bottoms[node.depth] = y + height + ROW_GAP;
    boxes.set(node.id, { x: own?.x ?? node.depth * (NODE_WIDTH + COLUMN_GAP), y: own?.y ?? y, height });
    if (own) loose.add(node.id);
  }
  return boxes;
}

/** The cards an area touches, as a box dragged across the graph picks them. */
export function cardsIn(boxes: Map<string, Box>, area: { left: number; top: number; right: number; bottom: number }): string[] {
  return [...boxes].filter(([, box]) => box.x < area.right && box.x + NODE_WIDTH > area.left && box.y < area.bottom && box.y + box.height > area.top).map(([id]) => id);
}

/** The cards from one to another, as a shift-click picks them: those in the box the two span, a run down one column or a rectangle across
 * columns. Without the first, which may have been hidden or closed, it is only the second. */
export function cardsBetween(boxes: Map<string, Box>, from: string, to: string): string[] {
  const one = boxes.get(from);
  const other = boxes.get(to);
  if (!one || !other) return [to];
  return cardsIn(boxes, {
    left: Math.min(one.x, other.x),
    right: Math.max(one.x, other.x) + NODE_WIDTH,
    top: Math.min(one.y, other.y),
    bottom: Math.max(one.y + one.height, other.y + other.height),
  });
}

/** How big the drawing is, with room around it. */
export function extent(boxes: Iterable<Box>, margin = 24): { width: number; height: number } {
  const all = [...boxes];
  const width = Math.max(0, ...all.map((box) => box.x + NODE_WIDTH)) + margin * 2;
  const height = Math.max(0, ...all.map((box) => box.y + box.height)) + margin * 2;
  return { width, height };
}

/** A curve from the right of one card to the left of another, and the point halfway along it, where its label goes. */
export function edgePath(from: Box, to: Box): { d: string; mid: { x: number; y: number } } {
  const x1 = from.x + NODE_WIDTH;
  const y1 = from.y + from.height / 2;
  const x2 = to.x;
  const y2 = to.y + to.height / 2;
  const bend = Math.max(40, Math.abs(x2 - x1) / 2);
  return { d: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`, mid: { x: (x1 + x2) / 2, y: (y1 + y2) / 2 } };
}
