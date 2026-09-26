import { describe, expect, it } from "vitest";
import { appendPath, boardColorCounts, coveredSegment, dominoCells, edgeKey, figureFromVertices, graphDegree, gridGraph, gridRouteCounts, initialMatches, matchEndpoints, placeDomino, rectangleVertices, sceneGraph, snapMatch, triangleGraph } from "../src/features/tools/plane-patterns/model";

describe("teacher-controlled counting and path materials", () => {
  it("highlights long segments only when the entire line is present", () => {
    const graph = sceneGraph("segments");
    expect(coveredSegment(graph.points[0], graph.points[5], graph)).toBe(true);
    expect(coveredSegment(graph.points[0], graph.points[5], { ...graph, edges: graph.edges.slice(1) })).toBe(false);
    expect(figureFromVertices(graph, ["A", "F"], false)?.id).toBe("A|F");
  });
  it("recognizes composite triangles without inventing diagonals", () => {
    const graph = triangleGraph();
    expect(figureFromVertices(graph, ["0,0", "0,3", "3,3"])).not.toBeNull();
    expect(figureFromVertices(graph, ["0,0", "1,2", "3,3"])).toBeNull();
    expect(figureFromVertices(graph, ["0,3", "1,3", "3,3"])).toBeNull();
  });
  it("selects a rectangle by opposite corners, and notices a missing boundary", () => {
    const graph = gridGraph(), vertices = rectangleVertices(graph, "0,0", "3,2")!;
    expect(figureFromVertices(graph, vertices)).not.toBeNull();
    expect(figureFromVertices({ ...graph, edges: graph.edges.filter((edge) => edgeKey(edge.a, edge.b) !== edgeKey("0,0", "1,0")) }, vertices)).toBeNull();
  });
  it("records teacher strokes, lifts and repeated-edge choices without scoring", () => {
    const graph = sceneGraph("oneStroke");
    let strokes = appendPath(graph, [[]], "A", false);
    strokes = appendPath(graph, strokes, "B", false);
    expect(strokes).toEqual([["A", "B"]]);
    expect(appendPath(graph, strokes, "A", false)).toEqual(strokes);
    expect(appendPath(graph, strokes, "A", true)).toEqual([["A", "B", "A"]]);
    expect(appendPath(graph, [...strokes, []], "E", false)).toEqual([["A", "B"], ["E"]]);
    expect(graphDegree(graph, "A")).toBe(3);
  });
  it("counts each monotone route from predecessors, respecting closed edges and required points", () => {
    expect(gridRouteCounts(4, 3)["4,3"]).toBe(35);
    expect(gridRouteCounts(2, 2, [edgeKey("0,0", "1,0")])["2,2"]).toBe(3);
    expect(gridRouteCounts(2, 2, [], "1,1")["2,2"]).toBe(4);
    expect(appendPath(gridGraph(), [["1,1"]], "0,1", true, [], true)).toEqual([["1,1"]]);
  });
  it("keeps match length while moving or snapping endpoints", () => {
    const matches = initialMatches(), moving = { ...matches[0], center: { x: matches[0].center.x + 3, y: matches[0].center.y } };
    const snapped = snapMatch(moving, matches.slice(1));
    const [a, b] = matchEndpoints(snapped);
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(100);
    expect(snapped.center.x).toBeCloseTo(matches[0].center.x);
  });
  it("places dominoes in adjacent cells and exposes color counts without a solvability verdict", () => {
    const domino = { id: "d", column: 1, row: 2, vertical: false };
    expect(dominoCells(domino)).toEqual(["1,2", "2,2"]);
    expect(placeDomino(domino, [], [])).toBe(true);
    expect(placeDomino(domino, [], ["2,2"])).toBe(false);
    expect(placeDomino({ ...domino, column: 5 }, [], [])).toBe(false);
    expect(boardColorCounts([], [domino])).toEqual({ dark: 17, light: 17 });
    expect(boardColorCounts(["0,0", "5,5"])).toEqual({ dark: 18, light: 16 });
  });
});
