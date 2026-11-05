import { addRelated, cardHeight, cardsBetween, cardsIn, collapse, edgePath, layout, NODE_WIDTH, nodeId, relationKey, startGraph, type Graph, type GraphNode } from "./graph";
import type { Relation } from "./related";

const toPets: Relation = { direction: "referenced_by", schema: "public", table: "pets", from: [0], to: ["owner_id"] };
const toPeople: Relation = { direction: "references", schema: "public", table: "people", from: [1], to: ["id"] };
const HEIGHT = cardHeight(2);
const placed = (graph: Graph, heightOf: (node: GraphNode) => number = () => HEIGHT) => {
  const boxes = layout(graph, heightOf);
  return graph.nodes.map((node) => boxes.get(node.id)!);
};

test("the rows a graph starts with are one column, one under another, and a repeated row is drawn once", () => {
  const graph = startGraph("public", "people", ["id", "name"], [["1", "ada"], ["2", "grace"], ["1", "ada"]]);

  expect(graph.nodes.map((node) => [node.row[0], node.depth])).toEqual([["1", 0], ["2", 0]]);
  const [ada, grace] = placed(graph);
  expect([ada.x, grace.x]).toEqual([0, 0]);
  expect(grace.y).toBeGreaterThanOrEqual(ada.y + HEIGHT);
});

test("what a node links to goes in the next column, level with it, joined by an edge named for the columns that pair up", () => {
  const start = startGraph("public", "people", ["id", "name"], [["1", "ada"], ["2", "grace"]]);
  const grace = start.nodes[1];

  const graph = addRelated(start, grace.id, [{ relation: toPets, columns: ["id", "owner_id"], rows: [["10", "2"], ["11", "2"]] }]);

  const boxes = layout(graph, () => HEIGHT);
  const graceBox = boxes.get(grace.id)!;
  const pets = graph.nodes.filter((node) => node.table === "pets");
  const [first, second] = pets.map((pet) => boxes.get(pet.id)!);
  expect(pets.map((pet) => pet.depth)).toEqual([1, 1]);
  expect(first.x).toBeGreaterThan(graceBox.x);
  expect(first.y).toBe(graceBox.y);
  expect(second.y).toBeGreaterThanOrEqual(first.y + HEIGHT);
  expect(graph.edges.map((edge) => [edge.from, edge.to, edge.label])).toEqual(pets.map((pet) => [grace.id, pet.id, "owner_id → id"]));
  expect(graph.nodes.find((node) => node.id === grace.id)?.opened).toEqual([relationKey(toPets)]);
});

test("a row reached a second time is linked to, not drawn again, and what was drawn before does not move", () => {
  const start = startGraph("public", "people", ["id", "name"], [["2", "grace"]]);
  const withPet = addRelated(start, start.nodes[0].id, [{ relation: toPets, columns: ["id", "owner_id"], rows: [["10", "2"]] }]);
  const pet = withPet.nodes[1];

  const back = addRelated(withPet, pet.id, [{ relation: toPeople, columns: ["id", "name"], rows: [["2", "grace"]] }]);

  expect(back.nodes).toHaveLength(2);
  expect(placed(back)).toEqual(placed(withPet));
  expect(back.edges.map((edge) => [edge.from, edge.to, edge.label])).toEqual([
    [start.nodes[0].id, pet.id, "owner_id → id"],
    [pet.id, nodeId("public", "people", ["2", "grace"]), "owner_id → id"],
  ]);
});

test("a second node opened in the same column starts below what is already there", () => {
  const start = startGraph("public", "people", ["id", "name"], [["1", "ada"], ["2", "grace"]]);
  const first = addRelated(start, start.nodes[1].id, [{ relation: toPets, columns: ["id", "owner_id"], rows: [["10", "2"], ["11", "2"], ["12", "2"]] }]);

  const both = addRelated(first, start.nodes[0].id, [{ relation: toPets, columns: ["id", "owner_id"], rows: [["13", "1"]] }]);

  const boxes = placed(both);
  const lowest = Math.max(...both.nodes.flatMap((node, at) => (node.depth === 1 && node.row[0] !== "13" ? [boxes[at].y] : [])));
  expect(boxes.at(-1)!.y).toBeGreaterThan(lowest);
});

test("a card that grows pushes down the cards under it in its column, and those beside it follow the cards they came from", () => {
  const start = startGraph("public", "people", ["id", "name"], [["1", "ada"], ["2", "grace"]]);
  const graph = addRelated(start, start.nodes[1].id, [{ relation: toPets, columns: ["id", "owner_id"], rows: [["10", "2"]] }]);

  const small = placed(graph);
  const big = placed(graph, (node) => (node.table === "people" ? cardHeight(10) : HEIGHT));

  expect(big[1].y - small[1].y).toBe(cardHeight(10) - HEIGHT);
  expect(big[2].y).toBe(big[1].y);
  expect(big[1].height).toBe(cardHeight(10));
});

test("closing a node takes away what it drew and what those drew, but keeps rows it only linked to", () => {
  const start = startGraph("public", "people", ["id", "name"], [["2", "grace"]]);
  const grace = start.nodes[0];
  const withPet = addRelated(start, grace.id, [{ relation: toPets, columns: ["id", "owner_id"], rows: [["10", "2"]] }]);
  const pet = withPet.nodes[1];
  const deeper = addRelated(withPet, pet.id, [{ relation: toPeople, columns: ["id", "name"], rows: [["2", "grace"], ["3", "linus"]] }]);

  const closedPet = collapse(deeper, pet.id);
  expect(closedPet.nodes.map((node) => node.id)).toEqual([grace.id, pet.id]);
  expect(closedPet.edges.map((edge) => [edge.from, edge.to])).toEqual([[grace.id, pet.id]]);
  expect(closedPet.nodes[1].opened).toEqual([]);

  const closedGrace = collapse(deeper, grace.id);
  expect(closedGrace.nodes.map((node) => node.id)).toEqual([grace.id]);
  expect(closedGrace.edges).toEqual([]);
  expect(closedGrace.nodes[0].opened).toEqual([]);
});

test("each link of a node opens and closes on its own", () => {
  const toToys: Relation = { direction: "referenced_by", schema: "public", table: "toys", from: [0], to: ["owner_id"] };
  const start = startGraph("public", "people", ["id", "name"], [["2", "grace"]]);
  const grace = start.nodes[0];
  const withPets = addRelated(start, grace.id, [{ relation: toPets, columns: ["id", "owner_id"], rows: [["10", "2"]] }]);
  const both = addRelated(withPets, grace.id, [{ relation: toToys, columns: ["id", "owner_id"], rows: [["7", "2"]] }]);
  expect(both.nodes[0].opened).toEqual([relationKey(toPets), relationKey(toToys)]);

  const toysOnly = collapse(both, grace.id, relationKey(toPets));

  expect(toysOnly.nodes.map((node) => node.table)).toEqual(["people", "toys"]);
  expect(toysOnly.edges.map((edge) => edge.via)).toEqual([relationKey(toToys)]);
  expect(toysOnly.nodes[0].opened).toEqual([relationKey(toToys)]);
});

test("an edge runs from the middle of the right of one card to the middle of the left of the next", () => {
  const from = { x: 0, y: 0, height: 100 };
  const to = { x: 316, y: 40, height: 200 };

  const { d } = edgePath(from, to);

  expect(d.startsWith(`M ${NODE_WIDTH} 50`)).toBe(true);
  expect(d.endsWith("316 140")).toBe(true);
});

test("a box dragged across the graph picks every card it touches, however little", () => {
  const boxes = new Map([
    ["a", { x: 0, y: 0, height: 100 }],
    ["b", { x: 0, y: 120, height: 100 }],
    ["c", { x: 316, y: 0, height: 100 }],
  ]);

  expect(cardsIn(boxes, { left: 10, top: 90, right: 20, bottom: 130 })).toEqual(["a", "b"]);
  expect(cardsIn(boxes, { left: NODE_WIDTH + 1, top: 0, right: 300, bottom: 300 })).toEqual([]);
});

test("a card dragged somewhere is drawn there, keeps its place in its column, and what is opened from it goes beside it", () => {
  const start = startGraph("public", "people", ["id", "name"], [["1", "ada"], ["2", "grace"]]);
  const [ada, grace] = start.nodes;
  const graph = addRelated(start, ada.id, [{ relation: toPets, columns: ["id", "owner_id"], rows: [["10", "1"], ["11", "1"]] }]);
  const before = layout(graph, () => HEIGHT);

  const after = layout(graph, () => HEIGHT, new Map([[ada.id, { x: 900, y: 500 }]]));

  expect(after.get(ada.id)).toEqual({ x: 900, y: 500, height: HEIGHT });
  expect(after.get(grace.id)).toEqual(before.get(grace.id));
  const pets = graph.nodes.filter((node) => node.table === "pets").map((node) => after.get(node.id)!);
  expect(pets.map((pet) => pet.x)).toEqual([900 + NODE_WIDTH + 96, 900 + NODE_WIDTH + 96]);
  expect(pets[0].y).toBe(500);
  expect(pets[1].y).toBeGreaterThanOrEqual(500 + HEIGHT);
});

test("the cards between two are those in the box they span: a run down one column, or the rectangle across columns", () => {
  const boxes = new Map([
    ["a", { x: 0, y: 0, height: 100 }],
    ["b", { x: 0, y: 120, height: 100 }],
    ["c", { x: 0, y: 240, height: 100 }],
    ["d", { x: 0, y: 360, height: 100 }],
    ["e", { x: 316, y: 120, height: 100 }],
  ]);

  expect(cardsBetween(boxes, "a", "c")).toEqual(["a", "b", "c"]);
  expect(cardsBetween(boxes, "c", "a")).toEqual(["a", "b", "c"]);
  expect(cardsBetween(boxes, "b", "e")).toEqual(["b", "e"]);
  expect(cardsBetween(boxes, "gone", "c")).toEqual(["c"]);
});
